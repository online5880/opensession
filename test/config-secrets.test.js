import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const fixtureRoot = path.join(os.tmpdir(), `opensession-config-test-${process.pid}-${Date.now()}`);
const fixtureHome = path.join(fixtureRoot, 'home');
const configFile = path.join(fixtureHome, '.opensession', 'config.json');

test('writeConfig persists encrypted secret and readConfig decrypts it', async () => {
  await fs.mkdir(fixtureHome, { recursive: true });
  const prevHome = process.env.HOME;
  const prevUserProfile = process.env.USERPROFILE;
  process.env.HOME = fixtureHome;
  process.env.USERPROFILE = fixtureHome;

  try {
    const configModule = await import(`../src/config.js?fixture=${Date.now()}`);

    await configModule.writeConfig({
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'sb_secret_plaintext_for_test',
      actor: 'tester'
    });

    const raw = await fs.readFile(configFile, 'utf8');
    assert.doesNotMatch(raw, /sb_secret_plaintext_for_test/);
    assert.match(raw, /"supabaseAnonKeyEnc"\s*:\s*"enc:v1:/);

    const loaded = await configModule.readConfig();
    assert.equal(loaded.supabaseAnonKey, 'sb_secret_plaintext_for_test');
    assert.equal(loaded.supabaseUrl, 'https://example.supabase.co');
    assert.equal(loaded.actor, 'tester');
  } finally {
    if (prevHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = prevHome;
    }
    if (prevUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = prevUserProfile;
    }
  }
});
