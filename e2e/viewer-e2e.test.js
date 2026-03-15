import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLI_PATH = path.resolve(__dirname, '../src/cli.js');

function createTempConfig(home) {
  return fs.mkdir(path.join(home, '.opensession'), { recursive: true }).then(() =>
    fs.writeFile(
      path.join(home, '.opensession', 'config.json'),
      JSON.stringify({
        supabaseUrl: 'https://example.supabase.co',
        supabaseAnonKey: 'test-anon-key'
      })
    )
  );
}

function truncateOutput(text, limit = 1200) {
  if (text.length <= limit) {
    return text;
  }
  return `...${text.slice(-limit)}`;
}

function formatProcessOutput(output) {
  return [
    output.exitCode === null ? '' : `exitCode=${output.exitCode}`,
    output.signal ? `signal=${output.signal}` : '',
    `stdout:\n${truncateOutput(output.stdout || '<empty>')}`,
    `stderr:\n${truncateOutput(output.stderr || '<empty>')}`
  ].filter(Boolean).join('\n');
}

async function getFreePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : null;
  await new Promise((resolve) => {
    server.close(resolve);
  });

  if (!port) {
    throw new Error('Failed to allocate ephemeral port for viewer e2e test.');
  }
  return port;
}

async function waitForHealth(url, timeoutMs = 5000, intervalMs = 120, child, output) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Viewer exited before health endpoint became available. ${formatProcessOutput(output)}`);
    }

    try {
      const response = await fetch(url);
      if (response.status === 200) {
        return response.json();
      }
      lastStatus = response.status;
    } catch (error) {
      lastStatus = error.code ?? error.name ?? 'unknown';
    }

    await new Promise((resolve) => {
      setTimeout(resolve, intervalMs);
    });
  }

  throw new Error(`Timed out waiting for health endpoint after ${timeoutMs}ms (last status ${lastStatus}). ${formatProcessOutput(output)}`);
}

async function runViewer({ port, env }) {
  const child = spawn(process.execPath, [CLI_PATH, 'viewer', '--host', '127.0.0.1', '--port', String(port)], {
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const output = {
    stdout: '',
    stderr: '',
    exitCode: null,
    signal: null
  };

  child.stdout?.on('data', (chunk) => {
    output.stdout += String(chunk);
  });
  child.stderr?.on('data', (chunk) => {
    output.stderr += String(chunk);
  });
  child.on('exit', (code, signal) => {
    output.exitCode = code;
    output.signal = signal;
  });

  try {
    const healthUrl = `http://127.0.0.1:${port}/health`;
    const body = await waitForHealth(healthUrl, 5000, 120, child, output);
    assert.equal(body.ok, true);
    assert.equal(body.mode, 'read-only');
  } finally {
    await new Promise((resolve, reject) => {
      if (!child || child.exitCode !== null) {
        resolve();
        return;
      }

      if (!child.stdout?.destroyed) {
        child.stdout?.destroy();
      }
      if (!child.stderr?.destroyed) {
        child.stderr?.destroy();
      }

      const timeout = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`Timed out waiting for viewer process to stop after SIGINT. ${formatProcessOutput(output)}`));
      }, 2000);

      child.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });

      child.kill('SIGINT');
    });
  }
}

test('viewer command starts and health endpoint returns read-only status', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'opensession-e2e-viewer-'));
  const port = await getFreePort();

  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home
  };

  await createTempConfig(home);
  await runViewer({ port, env });

  await fs.rm(home, { recursive: true, force: true });
});
