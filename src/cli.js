#!/usr/bin/env node

import { Command } from 'commander';
import readline from 'node:readline';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startHookServer } from './hook-server.js';
import {
  appendEvent,
  ensureProject,
  getClient,
  getSession,
  getSessionEvents,
  listSessionEvents,
  listActiveSessions,
  listSessions,
  startSession,
  validateConnection
} from './supabase.js';
import { getConfigPath, mergeConfig, readConfig, writeConfig } from './config.js';
import { releaseResumeOperation, reserveResumeOperation } from './idempotency.js';
import { computeKpis, computeWeeklyTrend, formatSignedDelta } from './metrics.js';
import { startViewerServer } from './viewer.js';

const program = new Command();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCHEMA_SQL_PATH = path.resolve(__dirname, '../sql/schema.sql');
const PACKAGE_JSON_PATH = path.resolve(__dirname, '../package.json');

let packageMetadata = {
  name: '@online5880/opensession',
  version: '0.0.0'
};

try {
  const raw = readFileSync(PACKAGE_JSON_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  packageMetadata = {
    name: typeof parsed.name === 'string' ? parsed.name : packageMetadata.name,
    version: typeof parsed.version === 'string' ? parsed.version : packageMetadata.version
  };
} catch {
  // Fall back to defaults when package metadata is unavailable.
}

function formatError(error) {
  if (error instanceof Error) {
    return error.message;
  }
  if (error && typeof error === 'object') {
    const message = error.message;
    const details = error.details;
    const hint = error.hint;
    const code = error.code;
    const parts = [message, details, hint, code].filter(Boolean);
    if (parts.length > 0) {
      return parts.join(' | ');
    }
    try {
      return JSON.stringify(error);
    } catch {
      return 'Unknown object error';
    }
  }
  return String(error);
}

function maskSecret(value, { keepStart = 4, keepEnd = 4 } = {}) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) {
    return '(empty)';
  }
  if (text.length <= keepStart + keepEnd) {
    return '*'.repeat(text.length);
  }
  const start = text.slice(0, keepStart);
  const end = text.slice(-keepEnd);
  return `${start}${'*'.repeat(text.length - keepStart - keepEnd)}${end}`;
}

async function readInitWizardInputs(current, options) {
  if (input.isTTY) {
    const rl = createInterface({ input, output });
    const existingProjectKey = typeof current?.defaultProjectKey === 'string' ? current.defaultProjectKey.trim() : '';
    const existingActor = typeof current?.actor === 'string' ? current.actor.trim() : '';

    const url = (await rl.question('Supabase URL을 입력하세요: ')).trim();
    const anonKey = (await rl.question('Supabase ANON KEY를 입력하세요: ')).trim();

    let projectKey = typeof options.projectKey === 'string' ? options.projectKey.trim() : '';
    if (!projectKey) {
      const defaultProjectLabel = existingProjectKey ? ` (기본 ${existingProjectKey})` : '';
      const projectAnswer = (await rl.question(`기본 project key (선택사항)${defaultProjectLabel}: `)).trim();
      projectKey = projectAnswer || existingProjectKey;
    }

    let actor = typeof options.actor === 'string' ? options.actor.trim() : '';
    if (!actor) {
      const defaultActorLabel = existingActor ? ` (기본 ${existingActor})` : '';
      const actorAnswer = (await rl.question(`기본 actor (선택사항)${defaultActorLabel}: `)).trim();
      actor = actorAnswer || existingActor;
    }

    rl.close();
    return { url, anonKey, projectKey, actor };
  }

  const raw = await readFile('/dev/stdin', 'utf8');
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return {
    url: lines[0] ?? '',
    anonKey: lines[1] ?? '',
    projectKey: typeof options.projectKey === 'string' ? options.projectKey.trim() : '',
    actor: typeof options.actor === 'string' ? options.actor.trim() : ''
  };
}

function inferProjectRefFromSupabaseUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname ?? '';
    if (!host.endsWith('.supabase.co')) {
      return null;
    }
    const [ref] = host.split('.');
    return ref?.trim() ? ref : null;
  } catch {
    return null;
  }
}

function isSchemaMissingError(error) {
  if (!error) {
    return false;
  }
  const code = String(error.code ?? '').toUpperCase();
  const message = String(error.message ?? '').toLowerCase();
  const details = String(error.details ?? '').toLowerCase();
  const hint = String(error.hint ?? '').toLowerCase();
  const serialized = formatError(error).toLowerCase();
  if (code === 'PGRST205') {
    return true;
  }
  const haystack = `${message} ${details} ${hint} ${serialized}`;
  if (haystack.includes('pgrst205')) {
    return true;
  }
  if (haystack.includes("could not find the table 'public.projects' in the schema cache")) {
    return true;
  }
  return haystack.includes('relation') && haystack.includes('projects');
}

async function applySchemaWithManagementApi({ token, projectRef }) {
  const sql = await readFile(SCHEMA_SQL_PATH, 'utf8');
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query: sql })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Management API request failed (${response.status}): ${body.slice(0, 400)}`);
  }
}

async function handleSchemaBootstrapFlow(url, anonKey, validationError) {
  const message = formatError(validationError);
  console.log(`연결 검증: 실패 (${message})`);
  console.log('원인: Supabase 테이블이 아직 생성되지 않았습니다 (PGRST205 감지).');
  console.log('Bootstrap 옵션을 선택하세요:');
  console.log('  [A] Supabase Management API로 schema.sql 자동 적용');
  console.log('  [B] 수동 적용 명령 출력 후 재검증');

  const inferredRef = inferProjectRefFromSupabaseUrl(url);
  if (!input.isTTY) {
    const tokenFromEnv = process.env.SUPABASE_MANAGEMENT_TOKEN?.trim();
    const projectRefFromEnv = process.env.SUPABASE_PROJECT_REF?.trim();
    const projectRef = projectRefFromEnv || inferredRef;

    if (tokenFromEnv && projectRef) {
      console.log(`비대화형 자동 bootstrap 실행 중... projectRef=${projectRef}`);
      try {
        await applySchemaWithManagementApi({ token: tokenFromEnv, projectRef });
      } catch (applyError) {
        const applyMessage = formatError(applyError);
        console.log(`자동 bootstrap: 실패 (${applyMessage})`);
        console.log(`schema.sql 경로: ${SCHEMA_SQL_PATH}`);
        return false;
      }

      try {
        await validateConnection(url, anonKey);
        console.log('연결 재검증: 성공');
        return true;
      } catch (retryError) {
        const retryMessage = formatError(retryError);
        console.log(`연결 재검증: 실패 (${retryMessage})`);
        return false;
      }
    }

    console.log('비대화형 모드에서는 SUPABASE_MANAGEMENT_TOKEN/SUPABASE_PROJECT_REF 설정 시 자동 bootstrap을 시도합니다.');
    console.log(`schema.sql 경로: ${SCHEMA_SQL_PATH}`);
    if (inferredRef) {
      console.log(
        `one-step command: psql \"postgresql://postgres:<DB_PASSWORD>@db.${inferredRef}.supabase.co:5432/postgres\" -f \"${SCHEMA_SQL_PATH}\"`
      );
    }
    return false;
  }

  const rl = createInterface({ input, output });
  try {
    const rawChoice = (await rl.question('선택 (A/B, 기본 B): ')).trim().toUpperCase();
    const choice = rawChoice === 'A' ? 'A' : 'B';

    if (choice === 'A') {
      const token = (await rl.question('Supabase Management API token (sbp_...): ')).trim();
      const defaultRef = inferredRef ?? '';
      const refPrompt = defaultRef
        ? `Project ref (기본 ${defaultRef}): `
        : 'Project ref (예: abcdefghijklmno): ';
      const projectRefInput = (await rl.question(refPrompt)).trim();
      const projectRef = projectRefInput || defaultRef;

      if (!token || !projectRef) {
        throw new Error('Option A requires both Management API token and project ref.');
      }

      console.log(`자동 bootstrap 실행 중... projectRef=${projectRef}`);
      await applySchemaWithManagementApi({ token, projectRef });
      console.log('자동 bootstrap: 성공');
    } else {
      const refLabel = inferredRef ? inferredRef : '<PROJECT_REF>';
      console.log(`schema.sql 경로: ${SCHEMA_SQL_PATH}`);
      console.log(
        `one-step command: psql \"postgresql://postgres:<DB_PASSWORD>@db.${refLabel}.supabase.co:5432/postgres\" -f \"${SCHEMA_SQL_PATH}\"`
      );
      await rl.question('수동 적용 완료 후 Enter를 누르면 재검증합니다: ');
    }
  } finally {
    rl.close();
  }

  try {
    await validateConnection(url, anonKey);
    console.log('연결 재검증: 성공');
    return true;
  } catch (retryError) {
    const retryMessage = formatError(retryError);
    console.log(`연결 재검증: 실패 (${retryMessage})`);
    return false;
  }
}

function parseSemver(version) {
  const normalized = String(version ?? '').trim().replace(/^v/i, '');
  const [core] = normalized.split('-');
  const parts = core.split('.');
  if (parts.length < 1 || parts.length > 3) {
    return null;
  }

  const numbers = [0, 0, 0];
  for (let i = 0; i < Math.min(parts.length, 3); i += 1) {
    const value = Number.parseInt(parts[i], 10);
    if (!Number.isInteger(value) || value < 0) {
      return null;
    }
    numbers[i] = value;
  }
  return numbers;
}

function compareSemver(left, right) {
  const l = parseSemver(left);
  const r = parseSemver(right);
  if (!l || !r) {
    return 0;
  }

  for (let i = 0; i < 3; i += 1) {
    if (l[i] > r[i]) {
      return 1;
    }
    if (l[i] < r[i]) {
      return -1;
    }
  }
  return 0;
}

function toPercent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

async function fetchLatestVersionFromNpm(packageName) {
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(5000)
  });

  if (!response.ok) {
    throw new Error(`npm registry request failed (${response.status})`);
  }

  const data = await response.json();
  const latest = data?.['dist-tags']?.latest;
  if (!latest || typeof latest !== 'string') {
    throw new Error('Could not resolve latest version from npm registry');
  }
  return latest;
}

async function runNpmGlobalUpdate(packageName) {
  await new Promise((resolve, reject) => {
    const child = spawn('npm', ['install', '-g', `${packageName}@latest`], {
      stdio: 'inherit'
    });

    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`npm install exited with code ${code ?? 'unknown'}`));
    });
  });
}

async function readAutomationConfigFromFile(pathValue) {
  const raw = await readFile(pathValue, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Automation config file must be a JSON object.');
  }
  return parsed;
}

function toNumberInRange(raw, fallback, min, max) {
  const value = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isInteger(value)) {
    return fallback;
  }
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function renderOpsDashboard({
  projectKey,
  sessions,
  selectedIndex,
  selectedSession,
  events,
  tailLimit,
  showAllSessions,
  refreshMs,
  lastUpdatedAt,
  lastError
}) {
  const lines = [];
  lines.push('\x1Bc');
  lines.push(`OpenSession Ops Console | project=${projectKey}`);
  lines.push(
    `Shortcuts: [j/k] move [r] refresh [l] tail-limit [a] active/all [q] quit | refresh=${refreshMs}ms tail=${tailLimit} scope=${
      showAllSessions ? 'all' : 'active'
    }`
  );
  lines.push(`Updated: ${lastUpdatedAt ?? '-'}${lastError ? ` | last error: ${lastError}` : ''}`);
  lines.push('');
  lines.push(`Sessions (${sessions.length})`);

  if (sessions.length === 0) {
    lines.push('  (none)');
  } else {
    sessions.slice(0, 12).forEach((session, index) => {
      const marker = index === selectedIndex ? '>' : ' ';
      lines.push(
        `${marker} ${session.id} | actor=${session.actor} | status=${session.status} | started=${session.started_at}`
      );
    });
  }

  lines.push('');
  lines.push(`Events (${events.length})${selectedSession ? ` | session=${selectedSession.id}` : ''}`);
  if (events.length === 0) {
    lines.push('  (none)');
  } else {
    for (const event of events) {
      lines.push(`  ${event.created_at} | ${event.type} | ${JSON.stringify(event.payload)}`);
    }
  }

  output.write(`${lines.join('\n')}\n`);
}

async function runOpsConsole(options) {
  if (!input.isTTY) {
    throw new Error('ops requires an interactive terminal (TTY).');
  }

  const refreshMs = toNumberInRange(options.refreshMs, 5000, 1000, 60000);
  let tailLimit = toNumberInRange(options.limit, 50, 10, 200);
  const tailLimitOptions = [20, 50, 100, 200];
  const config = await readConfig();
  const client = getClient(config);
  const projectKey = options.projectKey ?? options.project ?? config.defaultProjectKey ?? config.syncStatus?.project;
  if (!projectKey) {
    throw new Error('Missing project key. Pass --project-key, sync --project, or run start first.');
  }

  const project = await ensureProject(client, projectKey, projectKey);
  let selectedIndex = 0;
  let showAllSessions = false;
  let sessions = [];
  let selectedSession = null;
  let events = [];
  let lastUpdatedAt = null;
  let lastError = null;

  const refresh = async () => {
    try {
      const allSessions = await listSessions(client, project.id, 120);
      sessions = showAllSessions ? allSessions : allSessions.filter((session) => session.status === 'active');
      if (sessions.length === 0) {
        selectedIndex = 0;
        selectedSession = null;
        events = [];
      } else {
        if (selectedIndex > sessions.length - 1) {
          selectedIndex = sessions.length - 1;
        }
        selectedSession = sessions[selectedIndex];
        events = await getSessionEvents(client, selectedSession.id, tailLimit, { ascending: false });
        events.reverse();
      }
      lastError = null;
    } catch (error) {
      lastError = formatError(error);
    }
    lastUpdatedAt = new Date().toISOString();
  };

  const redraw = () => {
    renderOpsDashboard({
      projectKey,
      sessions,
      selectedIndex,
      selectedSession,
      events,
      tailLimit,
      showAllSessions,
      refreshMs,
      lastUpdatedAt,
      lastError
    });
  };

  await refresh();
  redraw();

  let intervalHandle = null;
  let closed = false;
  const close = () => {
    if (closed) {
      return;
    }
    closed = true;
    if (intervalHandle) {
      clearInterval(intervalHandle);
    }
    input.off('keypress', onKeypress);
    if (typeof input.setRawMode === 'function') {
      input.setRawMode(false);
    }
    output.write('\n');
  };

  const onKeypress = async (_value, key) => {
    try {
      if (key?.ctrl && key.name === 'c') {
        close();
        return;
      }
      if (!key?.name) {
        return;
      }

      if (key.name === 'q') {
        close();
        return;
      }

      if ((key.name === 'j' || key.name === 'down') && sessions.length > 0) {
        selectedIndex = Math.min(selectedIndex + 1, sessions.length - 1);
        await refresh();
        redraw();
        return;
      }

      if ((key.name === 'k' || key.name === 'up') && sessions.length > 0) {
        selectedIndex = Math.max(selectedIndex - 1, 0);
        await refresh();
        redraw();
        return;
      }

      if (key.name === 'r') {
        await refresh();
        redraw();
        return;
      }

      if (key.name === 'l') {
        const index = tailLimitOptions.indexOf(tailLimit);
        tailLimit = tailLimitOptions[(index + 1) % tailLimitOptions.length];
        await refresh();
        redraw();
        return;
      }

      if (key.name === 'a') {
        showAllSessions = !showAllSessions;
        selectedIndex = 0;
        await refresh();
        redraw();
      }
    } catch (error) {
      lastError = formatError(error);
      redraw();
    }
  };

  readline.emitKeypressEvents(input);
  if (typeof input.setRawMode === 'function') {
    input.setRawMode(true);
  }
  input.on('keypress', onKeypress);

  intervalHandle = setInterval(async () => {
    if (closed) {
      return;
    }
    await refresh();
    redraw();
  }, refreshMs);

  await new Promise((resolve) => {
    const done = () => {
      close();
      resolve();
    };
    input.once('end', done);
    const poll = setInterval(() => {
      if (closed) {
        clearInterval(poll);
        resolve();
      }
    }, 100);
  });
}

function parsePositiveInt(raw, fallback) {
  const value = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isInteger(value) || value <= 0) {
    return fallback;
  }
  return value;
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

program
  .name('opensession')
  .description('Session continuity bridge CLI for Supabase')
  .version(packageMetadata.version);

program
  .command('init')
  .alias('setup')
  .description('Initialize CLI config with interactive prompt')
  .option('--project-key <projectKey>', 'Default project key')
  .option('--actor <actor>', 'Default actor/username')
  .action(async (options) => {
    const current = await readConfig();
    const { url, anonKey, projectKey, actor } = await readInitWizardInputs(current, options);

    if (!url || !anonKey) {
      throw new Error('Supabase URL과 ANON KEY는 필수입니다.');
    }

    const next = mergeConfig(current, {
      supabaseUrl: url,
      supabaseAnonKey: anonKey,
      defaultProjectKey: projectKey || current.defaultProjectKey,
      actor: actor || current.actor
    });

    const configPath = await writeConfig(next);
    console.log(`설정 저장 완료: ${configPath}`);
    console.log(`- Supabase URL: ${next.supabaseUrl}`);
    console.log(`- Supabase ANON KEY: ${maskSecret(next.supabaseAnonKey)}`);
    console.log(`- Default project key: ${next.defaultProjectKey ?? '(not set)'}`);
    console.log(`- Actor: ${next.actor ?? '(not set)'}`);
    try {
      await validateConnection(url, anonKey);
      console.log('연결 검증: 성공');
    } catch (error) {
      if (isSchemaMissingError(error)) {
        const recovered = await handleSchemaBootstrapFlow(url, anonKey, error);
        if (!recovered) {
          process.exitCode = 1;
        }
        return;
      }
      const message = formatError(error);
      console.log(`연결 검증: 실패 (${message})`);
      process.exitCode = 1;
    }
  });

program
  .command('login')
  .description('Save actor identity used in session events')
  .requiredOption('--actor <actor>', 'Actor/username')
  .action(async (options) => {
    const current = await readConfig();
    const next = mergeConfig(current, { actor: options.actor });
    await writeConfig(next);
    console.log(`Logged in as ${options.actor}`);
  });

program
  .command('start')
  .alias('st')
  .description('Start a new session and emit a start event')
  .requiredOption('--project-key <projectKey>', 'Project key')
  .option('--project-name <projectName>', 'Project display name')
  .option('--actor <actor>', 'Actor override')
  .action(async (options) => {
    const config = await readConfig();
    const client = getClient(config);
    const actor = options.actor ?? config.actor ?? 'anonymous';
    const operationId = randomUUID();

    const project = await ensureProject(client, options.projectKey, options.projectName);
    const session = await startSession(client, project.id, actor, { operationId });

    await writeConfig(
      mergeConfig(config, {
        defaultProjectKey: options.projectKey,
        lastSessionId: session.id
      })
    );

    console.log(`Session started: ${session.id}`);
    console.log(`Project: ${project.project_key}`);
    console.log(`Actor: ${session.actor}`);
  });

program
  .command('resume')
  .alias('rs')
  .description('Resume an existing session by emitting a resumed event')
  .requiredOption('--session-id <sessionId>', 'Session id to resume')
  .option('--actor <actor>', 'Actor override')
  .option('--operation-id <operationId>', 'Stable idempotency key for resume')
  .action(async (options) => {
    let config = await readConfig();
    const client = getClient(config);
    const actor = options.actor ?? config.actor ?? 'anonymous';
    const session = await getSession(client, options.sessionId);

    if (!session) {
      throw new Error(`Session not found: ${options.sessionId}`);
    }

    const reservation = reserveResumeOperation(config, session.id, actor, options.operationId);
    config = reservation.nextConfig;
    await writeConfig(config);

    const event = await appendEvent(client, session.id, 'resumed', { actor }, { idempotencyKey: reservation.operationId });
    const postResumeConfig = mergeConfig(
      releaseResumeOperation(config, session.id, actor),
      { lastSessionId: session.id }
    );
    await writeConfig(postResumeConfig);

    console.log(`Session resumed: ${session.id}`);
    console.log(`Event: ${event.id}`);
  });

program
  .command('list')
  .alias('sessions')
  .description('List recent sessions for a project')
  .option('--project-key <projectKey>', 'Project key (defaults to configured project key)')
  .option('--project <projectKey>', 'Alias of --project-key')
  .option('--limit <limit>', 'Number of sessions', '20')
  .action(async (options) => {
    const config = await readConfig();
    const client = getClient(config);
    const projectKey = options.project ?? options.projectKey ?? config.defaultProjectKey ?? config.syncStatus?.project;
    if (!projectKey) {
      throw new Error('Missing project key. Pass --project-key, sync --project, or run start first.');
    }

    const limit = parsePositiveInt(options.limit, 20);
    const project = await ensureProject(client, projectKey, projectKey);
    const sessions = await listSessions(client, project.id, limit);

    if (sessions.length === 0) {
      console.log(`No sessions for project ${project.project_key}`);
      return;
    }

    for (const session of sessions) {
      console.log(
        `${session.id} | actor=${session.actor} | status=${session.status} | started=${session.started_at} | ended=${session.ended_at ?? '-'}`
      );
    }
  });

program
  .command('view')
  .alias('inspect')
  .description('Inspect a session with recent events')
  .option('--session-id <sessionId>', 'Session id (defaults to latest known session)')
  .option('--project-key <projectKey>', 'Project key used when selecting latest session')
  .option('--project <projectKey>', 'Alias of --project-key')
  .option('--tail <tail>', 'Number of recent events to show', '20')
  .action(async (options) => {
    const config = await readConfig();
    const client = getClient(config);
    let sessionId = options.sessionId ?? config.lastSessionId ?? null;

    if (!sessionId) {
      const projectKey = options.project ?? options.projectKey ?? config.defaultProjectKey ?? config.syncStatus?.project;
      if (!projectKey) {
        throw new Error('Missing session id. Pass --session-id, --project-key, or run start first.');
      }
      const project = await ensureProject(client, projectKey, projectKey);
      const sessions = await listSessions(client, project.id, 1);
      sessionId = sessions[0]?.id ?? null;
    }

    if (!sessionId) {
      throw new Error('No sessions found to inspect.');
    }

    const session = await getSession(client, sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const tail = parsePositiveInt(options.tail, 20);
    const events = await getSessionEvents(client, session.id, tail, { ascending: false });
    const ordered = [...events].reverse();
    await writeConfig(mergeConfig(config, { lastSessionId: session.id }));

    console.log(`Session: ${session.id}`);
    console.log(`Project ID: ${session.project_id}`);
    console.log(`Actor: ${session.actor}`);
    console.log(`Status: ${session.status}`);
    console.log(`Started: ${session.started_at}`);
    console.log(`Ended: ${session.ended_at ?? '-'}`);
    console.log(`Events: ${ordered.length} (tail=${tail})`);

    for (const event of ordered) {
      console.log(`${event.created_at} | ${event.type} | ${JSON.stringify(event.payload)}`);
    }
  });

program
  .command('tail')
  .alias('follow')
  .description('Poll and print new events from a session')
  .option('--session-id <sessionId>', 'Session id (defaults to latest known session)')
  .option('--project-key <projectKey>', 'Project key used when selecting latest session')
  .option('--project <projectKey>', 'Alias of --project-key')
  .option('--limit <limit>', 'Number of recent events to request per poll', '20')
  .option('--interval <interval>', 'Polling interval in seconds', '2')
  .option('--iterations <iterations>', 'Number of polling rounds (0 = infinite)', '0')
  .action(async (options) => {
    const config = await readConfig();
    const client = getClient(config);
    let sessionId = options.sessionId ?? config.lastSessionId ?? null;

    if (!sessionId) {
      const projectKey = options.project ?? options.projectKey ?? config.defaultProjectKey ?? config.syncStatus?.project;
      if (!projectKey) {
        throw new Error('Missing session id. Pass --session-id, --project-key, or run start first.');
      }
      const project = await ensureProject(client, projectKey, projectKey);
      const sessions = await listSessions(client, project.id, 1);
      sessionId = sessions[0]?.id ?? null;
    }

    if (!sessionId) {
      throw new Error('No sessions found to tail.');
    }

    const session = await getSession(client, sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const limit = parsePositiveInt(options.limit, 20);
    const intervalSec = parsePositiveInt(options.interval, 2);
    const iterations = Math.max(0, Number.parseInt(String(options.iterations ?? '0'), 10) || 0);

    await writeConfig(mergeConfig(config, { lastSessionId: session.id }));
    console.log(`Tailing session: ${session.id}`);
    console.log(`Polling: interval=${intervalSec}s limit=${limit} iterations=${iterations === 0 ? 'infinite' : iterations}`);

    const seenEventIds = new Set();
    let remaining = iterations;
    while (iterations === 0 || remaining > 0) {
      const events = await getSessionEvents(client, session.id, limit, { ascending: false });
      const ordered = [...events].reverse();
      for (const event of ordered) {
        if (seenEventIds.has(event.id)) {
          continue;
        }
        seenEventIds.add(event.id);
        console.log(`${event.created_at} | ${event.type} | ${JSON.stringify(event.payload)}`);
      }

      if (iterations !== 0) {
        remaining -= 1;
        if (remaining <= 0) {
          break;
        }
      }

      await delay(intervalSec * 1000);
    }
  });

program
  .command('status')
  .alias('ps')
  .description('Show active sessions and latest sync status')
  .option('--project-key <projectKey>', 'Project key (defaults to configured project key)')
  .option('--project <projectKey>', 'Alias of --project-key')
  .action(async (options) => {
    const currentVersion = packageMetadata.version;
    let latestVersion = '-';
    let versionState = 'unknown';

    try {
      const latest = await fetchLatestVersionFromNpm(packageMetadata.name);
      latestVersion = latest;
      const compare = compareSemver(currentVersion, latest);
      if (compare >= 0) {
        versionState = 'up-to-date';
      } else {
        versionState = 'update-available';
      }
    } catch (error) {
      versionState = `check-failed (${formatError(error)})`;
    }

    const config = await readConfig();
    const projectKey = options.project ?? options.projectKey ?? config.defaultProjectKey ?? config.syncStatus?.project;
    const syncStatus = config.syncStatus ?? {};

    console.log(`CLI version: ${currentVersion}`);
    console.log(`Latest version: ${latestVersion}`);
    console.log(`Version status: ${versionState}`);

    if (!projectKey) {
      throw new Error('Missing project key. Pass --project-key, sync --project, or run start first.');
    }

    console.log(`Project: ${projectKey}`);
    console.log(`Last sync: ${syncStatus.lastSyncAt ?? '-'}`);
    console.log(`Sync project: ${syncStatus.project ?? '-'}`);
    console.log(`Pending events: ${syncStatus.pendingEvents ?? 0}`);
    console.log(`Recent sync error: ${syncStatus.lastError ?? '-'}`);

    let client;
    try {
      client = getClient(config);
    } catch (error) {
      const message = formatError(error);
      console.log(`원격 상태 확인 불가: ${message}`);
      process.exitCode = 1;
      return;
    }
    const project = await ensureProject(client, projectKey, projectKey);
    const active = await listActiveSessions(client, project.id);

    if (active.length === 0) {
      console.log('No active sessions');
      return;
    }

    for (const session of active) {
      console.log(`- ${session.id} | actor=${session.actor} | started=${session.started_at}`);
    }
  });

program
  .command('self-update')
  .description('Check for updates and optionally install the latest global version')
  .option('--check', 'Check only, do not install')
  .action(async (options) => {
    const packageName = packageMetadata.name;
    const currentVersion = packageMetadata.version;
    const latestVersion = await fetchLatestVersionFromNpm(packageName);
    const compare = compareSemver(currentVersion, latestVersion);

    console.log(`Package: ${packageName}`);
    console.log(`Current version: ${currentVersion}`);
    console.log(`Latest version: ${latestVersion}`);

    if (compare >= 0) {
      console.log('Already up to date.');
      return;
    }

    if (options.check) {
      console.log('Update available. Run `opensession self-update` to install globally.');
      return;
    }

    console.log(`Installing ${packageName}@latest globally...`);
    await runNpmGlobalUpdate(packageName);
    console.log('Self-update complete.');
  });

program
  .command('viewer')
  .alias('vw')
  .description('Run read-only web viewer for projects/sessions/events')
  .option('--host <host>', 'Host to bind', '127.0.0.1')
  .option('--port <port>', 'Port to bind', '8787')
  .action(async (options) => {
    const host = String(options.host ?? '127.0.0.1');
    const port = Number.parseInt(String(options.port ?? '8787'), 10);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new Error('Invalid port. Use a number between 1 and 65535.');
    }

    const { server, url } = await startViewerServer({ host, port });
    console.log(`Read-only viewer running at ${url}`);
    console.log('Press Ctrl+C to stop.');

    process.once('SIGINT', () => {
      server.close(() => {
        process.exit(0);
      });
    });
  });

program
  .command('webhook-server')
  .description('Run inbound webhook ingestion server with optional automation forwarding')
  .option('--host <host>', 'Host to bind', '127.0.0.1')
  .option('--port <port>', 'Port to bind', '8788')
  .option('--project-key <projectKey>', 'Default project key when missing from payload')
  .option('--actor <actor>', 'Default actor for auto-created sessions')
  .option('--session-id <sessionId>', 'Force all webhooks into a specific session')
  .option('--secret <secret>', 'Shared secret expected in x-opensession-secret header')
  .option('--automation-file <path>', 'JSON file with automation rules/webhooks')
  .option('--no-auto-start-session', 'Disable automatic session creation when no active session exists')
  .action(async (options) => {
    const host = String(options.host ?? '127.0.0.1');
    const port = Number.parseInt(String(options.port ?? '8788'), 10);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new Error('Invalid port. Use a number between 1 and 65535.');
    }

    const config = await readConfig();
    const automationFromFile = options.automationFile
      ? await readAutomationConfigFromFile(options.automationFile)
      : {};
    const automationConfig = {
      ...(config.automation ?? {}),
      ...automationFromFile
    };

    const client = getClient(config);
    const projectKey = options.projectKey ?? config.defaultProjectKey ?? null;
    const actor = options.actor ?? config.actor ?? 'integration-bot';
    const fixedSessionId = options.sessionId ?? null;
    const autoStartSession = options.autoStartSession !== false;

    const { server, url } = await startHookServer({
      host,
      port,
      secret: options.secret ?? process.env.OPENSESSION_WEBHOOK_SECRET ?? null,
      projectKey,
      actor,
      autoStartSession,
      fixedSessionId,
      client,
      automationConfig
    });

    console.log(`Webhook server listening at ${url}`);
    console.log('POST events to /webhooks/event');
    console.log('Health check: GET /health');
    console.log('Press Ctrl+C to stop.');

    process.once('SIGINT', () => {
      server.close(() => {
        process.exit(0);
      });
    });
  });

program
  .command('sync')
  .alias('sy')
  .description('Sync local/remote session state for a project')
  .option('--project <projectKey>', 'Project key')
  .option('--project-key <projectKey>', 'Alias of --project')
  .action(async (options) => {
    const config = await readConfig();
    const now = new Date().toISOString();
    const projectKey = options.project ?? options.projectKey;

    if (!projectKey) {
      throw new Error('Missing project key. Pass --project or --project-key.');
    }

    try {
      const client = getClient(config);
      const project = await ensureProject(client, projectKey, projectKey);
      const active = await listActiveSessions(client, project.id);
      const next = mergeConfig(config, {
        defaultProjectKey: projectKey,
        syncStatus: {
          lastSyncAt: now,
          project: projectKey,
          pendingEvents: 0,
          lastError: null
        }
      });
      await writeConfig(next);
      console.log(`동기화 완료: project=${projectKey}`);
      console.log(`active sessions=${active.length}`);
      console.log(`pending events=0`);
    } catch (error) {
      const message = formatError(error);
      const next = mergeConfig(config, {
        syncStatus: {
          lastSyncAt: now,
          project: projectKey,
          pendingEvents: 0,
          lastError: message
        }
      });
      await writeConfig(next);
      console.log(`동기화 실패: ${message}`);
      process.exitCode = 1;
    }
  });

program
  .command('log')
  .alias('lg')
  .alias('logs')
  .description('Show session event log')
  .option('--session-id <sessionId>', 'Session id (defaults to last session)')
  .option('--limit <limit>', 'Number of events', '50')
  .action(async (options) => {
    const config = await readConfig();
    const client = getClient(config);
    const sessionId = options.sessionId ?? config.lastSessionId;

    if (!sessionId) {
      throw new Error('Missing session id. Pass --session-id or run start/resume first.');
    }

    const events = await getSessionEvents(client, sessionId, Number.parseInt(options.limit, 10));

    if (events.length === 0) {
      console.log(`No events for session ${sessionId}`);
      return;
    }

    for (const event of events) {
      console.log(`${event.created_at} | ${event.type} | ${JSON.stringify(event.payload)}`);
    }
  });

program
  .command('report')
  .description('Generate KPI and weekly trend report for a project')
  .option('--project-key <projectKey>', 'Project key (defaults to configured project key)')
  .option('--project <projectKey>', 'Alias of --project-key')
  .option('--days <days>', 'Rolling window size in days', '28')
  .option('--weeks <weeks>', 'Weekly buckets to show', '6')
  .option('--json', 'Emit report as JSON')
  .action(async (options) => {
    const config = await readConfig();
    const client = getClient(config);
    const projectKey = options.project ?? options.projectKey ?? config.defaultProjectKey ?? config.syncStatus?.project;

    if (!projectKey) {
      throw new Error('Missing project key. Pass --project-key, sync --project, or run start first.');
    }

    const days = Math.max(1, Math.min(180, Number.parseInt(String(options.days ?? '28'), 10) || 28));
    const weeks = Math.max(1, Math.min(26, Number.parseInt(String(options.weeks ?? '6'), 10) || 6));
    const now = new Date();
    const windowStart = new Date(now);
    windowStart.setUTCDate(windowStart.getUTCDate() - days);
    const previousWindowStart = new Date(windowStart);
    previousWindowStart.setUTCDate(previousWindowStart.getUTCDate() - days);

    const project = await ensureProject(client, projectKey, projectKey);
    const sessions = await listSessions(client, project.id, 1000);
    const allSessionIds = sessions.map((session) => session.id);

    const windowSessions = sessions.filter((session) => {
      const time = Date.parse(session.started_at);
      return Number.isFinite(time) && time >= windowStart.getTime() && time < now.getTime();
    });
    const previousWindowSessions = sessions.filter((session) => {
      const time = Date.parse(session.started_at);
      return Number.isFinite(time) && time >= previousWindowStart.getTime() && time < windowStart.getTime();
    });

    const [windowEvents, previousWindowEvents] = await Promise.all([
      listSessionEvents(client, allSessionIds, {
        since: windowStart.toISOString(),
        until: now.toISOString(),
        ascending: true
      }),
      listSessionEvents(client, allSessionIds, {
        since: previousWindowStart.toISOString(),
        until: windowStart.toISOString(),
        ascending: true
      })
    ]);

    const kpis = computeKpis(windowSessions, windowEvents);
    const previousKpis = computeKpis(previousWindowSessions, previousWindowEvents);
    const trend = computeWeeklyTrend(windowSessions, windowEvents, weeks, now);

    const payload = {
      generatedAt: now.toISOString(),
      project: {
        key: project.project_key,
        id: project.id
      },
      window: {
        days,
        since: windowStart.toISOString(),
        until: now.toISOString()
      },
      kpis,
      deltas: {
        sessions: formatSignedDelta(kpis.totalSessions, previousKpis.totalSessions),
        activeSessions: formatSignedDelta(kpis.activeSessions, previousKpis.activeSessions),
        uniqueActors: formatSignedDelta(kpis.uniqueActors, previousKpis.uniqueActors),
        events: formatSignedDelta(kpis.totalEvents, previousKpis.totalEvents)
      },
      trend
    };

    if (options.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    console.log(`Project KPI Report: ${project.project_key}`);
    console.log(`Window: ${windowStart.toISOString()} -> ${now.toISOString()} (${days}d)`);
    console.log('');
    console.log(`Sessions       ${kpis.totalSessions} (${payload.deltas.sessions} vs prev ${days}d)`);
    console.log(`Active         ${kpis.activeSessions} (${payload.deltas.activeSessions})`);
    console.log(`Unique actors  ${kpis.uniqueActors} (${payload.deltas.uniqueActors})`);
    console.log(`Events         ${kpis.totalEvents} (${payload.deltas.events})`);
    console.log(`Events/session ${kpis.eventsPerSession.toFixed(2)}`);
    console.log(`Resume rate    ${toPercent(kpis.resumeRate)}`);
    console.log('');
    console.log('Weekly trend (week_start | sessions | actors | events)');
    for (const bucket of trend) {
      console.log(`${bucket.weekStart} | ${bucket.sessions} | ${bucket.uniqueActors} | ${bucket.events}`);
    }
  });

program
  .command('ops')
  .description('Run keyboard-driven ops console (TUI) for session/event monitoring')
  .option('--project-key <projectKey>', 'Project key (defaults to configured project key)')
  .option('--project <projectKey>', 'Alias of --project-key')
  .option('--refresh-ms <refreshMs>', 'Auto refresh interval in ms', '5000')
  .option('--limit <limit>', 'Tail event limit (10-200)', '50')
  .action(async (options) => {
    await runOpsConsole(options);
  });

program
  .command('config-path')
  .description('Print local config path')
  .action(() => {
    console.log(getConfigPath());
  });

async function main() {
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    const message = formatError(error);
    console.error(message);
    process.exitCode = 1;
  }
}

await main();
