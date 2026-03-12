import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const CONFIG_DIR = path.join(os.homedir(), '.session-bridge');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

export async function readConfig() {
  try {
    const raw = await fs.readFile(CONFIG_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

export async function writeConfig(config) {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf8');
  return CONFIG_PATH;
}

export function getConfigPath() {
  return CONFIG_PATH;
}

export function mergeConfig(base, patch) {
  return { ...base, ...patch };
}
