#!/usr/bin/env node

import { Command } from 'commander';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  appendEvent,
  bootstrapSchemaWithManagementApi,
  ensureProject,
  getClient,
  getSession,
  getSessionEvents,
  listActiveSessions,
  startSession,
  validateConnection
} from './supabase.js';
import { getConfigPath, mergeConfig, readConfig, writeConfig } from './config.js';

const program = new Command();

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

function extractProjectRef(supabaseUrl) {
  try {
    const host = new URL(supabaseUrl).hostname;
    const first = host.split('.')[0];
    return first || '';
  } catch {
    return '';
  }
}

function isSchemaMissingError(error) {
  if (!error || typeof error !== 'object') {
    return false;
  }
  return error.code === 'PGRST205' || String(error.message ?? '').includes('PGRST205');
}

async function promptLine(question, defaultValue = '') {
  if (!input.isTTY) {
    return defaultValue;
  }
  const rl = createInterface({ input, output });
  const suffix = defaultValue ? ` [${defaultValue}]` : '';
  const answer = (await rl.question(`${question}${suffix}: `)).trim();
  rl.close();
  return answer || defaultValue;
}

async function readInitSecrets() {
  if (input.isTTY) {
    const rl = createInterface({ input, output });
    const url = (await rl.question('Supabase URL을 입력하세요: ')).trim();
    const anonKey = (await rl.question('Supabase ANON KEY를 입력하세요: ')).trim();
    rl.close();
    return { url, anonKey };
  }

  const raw = await readFile('/dev/stdin', 'utf8');
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return {
    url: lines[0] ?? '',
    anonKey: lines[1] ?? ''
  };
}

program
  .name('opensession')
  .description('Session continuity bridge CLI for Supabase')
  .version('0.1.0');

program
  .command('init')
  .description('Initialize CLI config with interactive prompt')
  .option('--project-key <projectKey>', 'Default project key')
  .option('--actor <actor>', 'Default actor/username')
  .action(async (options) => {
    const { url, anonKey } = await readInitSecrets();

    if (!url || !anonKey) {
      throw new Error('Supabase URL과 ANON KEY는 필수입니다.');
    }

    const current = await readConfig();
    const next = mergeConfig(current, {
      supabaseUrl: url,
      supabaseAnonKey: anonKey,
      defaultProjectKey: options.projectKey ?? current.defaultProjectKey,
      actor: options.actor ?? current.actor
    });

    const configPath = await writeConfig(next);
    console.log(`설정 저장 완료: ${configPath}`);
    try {
      await validateConnection(url, anonKey);
      console.log('Connection validation: PASS');
    } catch (error) {
      const message = formatError(error);
      console.log(`Connection validation: FAIL (${message})`);

      if (isSchemaMissingError(error)) {
        const schemaPath = fileURLToPath(new URL('../sql/schema.sql', import.meta.url));
        const schemaSql = await readFile(schemaPath, 'utf8');
        console.log('Detected missing schema (PGRST205).');

        const mode = (await promptLine('Choose bootstrap option: [A]uto API / [B] command output', 'B'))
          .toUpperCase()
          .trim();

        if (mode === 'A') {
          const defaultProjectRef = extractProjectRef(url);
          const managementToken = await promptLine('Supabase Management API token');
          const projectRef = await promptLine('Supabase project ref', defaultProjectRef);

          if (!managementToken || !projectRef) {
            console.log('Bootstrap skipped: missing management token or project ref.');
            process.exitCode = 1;
            return;
          }

          try {
            await bootstrapSchemaWithManagementApi(managementToken, projectRef, schemaSql);
            console.log('Bootstrap via Management API: PASS');
            await validateConnection(url, anonKey);
            console.log('Post-bootstrap validation retry: PASS');
            return;
          } catch (bootstrapError) {
            console.log(`Bootstrap via Management API: FAIL (${formatError(bootstrapError)})`);
            process.exitCode = 1;
            return;
          }
        }

        const sqlPath = path.resolve(schemaPath);
        console.log('Bootstrap via command output (Option B):');
        console.log(`SQL file path: ${sqlPath}`);
        console.log('Next command (replace placeholders):');
        console.log(
          `curl -sS -X POST \"https://api.supabase.com/v1/projects/<project-ref>/database/query\" -H \"Authorization: Bearer <management-token>\" -H \"apikey: <management-token>\" -H \"Content-Type: application/json\" --data @<(jq -Rs '{query: .}' ${sqlPath})`
        );
      }

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
  .description('Start a new session and emit a start event')
  .requiredOption('--project-key <projectKey>', 'Project key')
  .option('--project-name <projectName>', 'Project display name')
  .option('--actor <actor>', 'Actor override')
  .action(async (options) => {
    const config = await readConfig();
    const client = getClient(config);
    const actor = options.actor ?? config.actor ?? 'anonymous';

    const project = await ensureProject(client, options.projectKey, options.projectName);
    const session = await startSession(client, project.id, actor);

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
  .description('Resume an existing session by emitting a resumed event')
  .requiredOption('--session-id <sessionId>', 'Session id to resume')
  .option('--actor <actor>', 'Actor override')
  .action(async (options) => {
    const config = await readConfig();
    const client = getClient(config);
    const actor = options.actor ?? config.actor ?? 'anonymous';
    const session = await getSession(client, options.sessionId);

    if (!session) {
      throw new Error(`Session not found: ${options.sessionId}`);
    }

    const event = await appendEvent(client, session.id, 'resumed', { actor });
    await writeConfig(mergeConfig(config, { lastSessionId: session.id }));

    console.log(`Session resumed: ${session.id}`);
    console.log(`Event: ${event.id}`);
  });

program
  .command('status')
  .description('Show active sessions and latest sync status')
  .option('--project-key <projectKey>', 'Project key (defaults to configured project key)')
  .action(async (options) => {
    const config = await readConfig();
    const projectKey = options.projectKey ?? config.defaultProjectKey ?? config.syncStatus?.project;
    const syncStatus = config.syncStatus ?? {};

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
  .command('sync')
  .description('Sync local/remote session state for a project')
  .requiredOption('--project <projectKey>', 'Project key')
  .action(async (options) => {
    const config = await readConfig();
    const now = new Date().toISOString();

    try {
      const client = getClient(config);
      const project = await ensureProject(client, options.project, options.project);
      const active = await listActiveSessions(client, project.id);
      const next = mergeConfig(config, {
        defaultProjectKey: options.project,
        syncStatus: {
          lastSyncAt: now,
          project: options.project,
          pendingEvents: 0,
          lastError: null
        }
      });
      await writeConfig(next);
      console.log(`동기화 완료: project=${options.project}`);
      console.log(`active sessions=${active.length}`);
      console.log(`pending events=0`);
    } catch (error) {
      const message = formatError(error);
      const next = mergeConfig(config, {
        syncStatus: {
          lastSyncAt: now,
          project: options.project,
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
