import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLI_PATH = path.resolve(__dirname, '../src/cli.js');

function runCli(args, options = {}) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    encoding: 'utf8',
    env: options.env ?? process.env,
    timeout: 5000
  });
}

test('config-path prints isolated config location with custom HOME', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'opensession-e2e-cli-'));
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home
  };
  const expectedPath = path.join(home, '.opensession', 'config.json');

  const result = runCli(['config-path'], { env });

  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), expectedPath);
});

test('viewer command help is available through command definition', () => {
  const result = runCli(['viewer', '--help']);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Run read-only web viewer for projects\/sessions\/events/);
  assert.match(result.stdout, /--host <host>/);
  assert.match(result.stdout, /--port <port>/);
  assert.match(result.stdout, /vw/);
});

test('version command returns a semver-compatible value', () => {
  const result = runCli(['--version']);

  assert.equal(result.status, 0);
  assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+/);
});
