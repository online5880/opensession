import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLI_PATH = path.resolve(__dirname, '../src/cli.js');

function runCli(args) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    encoding: 'utf8',
    env: process.env
  });
}

test('start command help keeps required compatibility flags', () => {
  const result = runCli(['start', '--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /--project-key <projectKey>/);
  assert.match(result.stdout, /--project-name <projectName>/);
  assert.match(result.stdout, /--actor <actor>/);
});

test('resume command help keeps required compatibility flags', () => {
  const result = runCli(['resume', '--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /--session-id <sessionId>/);
  assert.match(result.stdout, /--actor <actor>/);
});

test('approve command help keeps required compatibility flags', () => {
  const result = runCli(['approve', '--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /--session-id <sessionId>/);
  assert.match(result.stdout, /--project-key <projectKey>/);
  assert.match(result.stdout, /--project <projectKey>/);
  assert.match(result.stdout, /--actor <actor>/);
  assert.match(result.stdout, /--note <note>/);
  assert.match(result.stdout, /--idempotency-key <idempotencyKey>/);
});

test('status command help keeps both project-key and project alias', () => {
  const result = runCli(['status', '--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /--project-key <projectKey>/);
  assert.match(result.stdout, /--project <projectKey>/);
});

test('log command help keeps session and limit flags', () => {
  const result = runCli(['log', '--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /--session-id <sessionId>/);
  assert.match(result.stdout, /--limit <limit>/);
});

test('logs alias resolves to log command help', () => {
  const result = runCli(['logs', '--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Show session event log/);
  assert.match(result.stdout, /--session-id <sessionId>/);
});
