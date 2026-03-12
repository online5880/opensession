#!/usr/bin/env node

import { Command } from 'commander';
import {
  appendEvent,
  ensureProject,
  getClient,
  getSession,
  getSessionEvents,
  listActiveSessions,
  startSession
} from './supabase.js';
import { getConfigPath, mergeConfig, readConfig, writeConfig } from './config.js';

const program = new Command();

program
  .name('session-bridge')
  .description('Session continuity bridge CLI for Supabase')
  .version('0.1.0');

program
  .command('init')
  .description('Initialize CLI config')
  .requiredOption('--url <url>', 'Supabase project URL')
  .requiredOption('--anon-key <anonKey>', 'Supabase anon key')
  .option('--project-key <projectKey>', 'Default project key')
  .option('--actor <actor>', 'Default actor/username')
  .action(async (options) => {
    const current = await readConfig();
    const next = mergeConfig(current, {
      supabaseUrl: options.url,
      supabaseAnonKey: options.anonKey,
      defaultProjectKey: options.projectKey ?? current.defaultProjectKey,
      actor: options.actor ?? current.actor
    });

    const path = await writeConfig(next);
    console.log(`Config saved: ${path}`);
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
  .description('Show active sessions for a project')
  .option('--project-key <projectKey>', 'Project key (defaults to configured project key)')
  .action(async (options) => {
    const config = await readConfig();
    const client = getClient(config);
    const projectKey = options.projectKey ?? config.defaultProjectKey;

    if (!projectKey) {
      throw new Error('Missing project key. Pass --project-key or run start first.');
    }

    const project = await ensureProject(client, projectKey, projectKey);
    const active = await listActiveSessions(client, project.id);

    console.log(`Project: ${project.project_key}`);

    if (active.length === 0) {
      console.log('No active sessions');
      return;
    }

    for (const session of active) {
      console.log(`- ${session.id} | actor=${session.actor} | started=${session.started_at}`);
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
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  }
}

await main();
