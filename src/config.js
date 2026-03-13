import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const CONFIG_DIR = path.join(os.homedir(), '.opensession');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
const ENC_PREFIX = 'enc:v1';
const ENC_ALGO = 'aes-256-gcm';
const ENC_IV_BYTES = 12;

function getKeyMaterial() {
  return `${os.userInfo().username}|${os.hostname()}|${process.platform}|${process.arch}|opensession-config-v1`;
}

function deriveEncryptionKey() {
  const salt = crypto.createHash('sha256').update(getKeyMaterial()).digest();
  return crypto.scryptSync(getKeyMaterial(), salt, 32);
}

function encryptSecret(plainText) {
  if (typeof plainText !== 'string' || plainText.length === 0) {
    return null;
  }
  const iv = crypto.randomBytes(ENC_IV_BYTES);
  const cipher = crypto.createCipheriv(ENC_ALGO, deriveEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

function decryptSecret(payload) {
  if (typeof payload !== 'string' || !payload.startsWith(`${ENC_PREFIX}:`)) {
    return null;
  }
  const [, , ivBase64, tagBase64, cipherBase64] = payload.split(':');
  if (!ivBase64 || !tagBase64 || !cipherBase64) {
    return null;
  }
  const decipher = crypto.createDecipheriv(ENC_ALGO, deriveEncryptionKey(), Buffer.from(ivBase64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagBase64, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(cipherBase64, 'base64')),
    decipher.final()
  ]);
  return decrypted.toString('utf8');
}

function decodeSensitiveConfig(config) {
  if (!config || typeof config !== 'object') {
    return {};
  }
  if (typeof config.supabaseAnonKey === 'string' && config.supabaseAnonKey.length > 0) {
    return config;
  }
  if (typeof config.supabaseAnonKeyEnc !== 'string') {
    return config;
  }

  try {
    const decrypted = decryptSecret(config.supabaseAnonKeyEnc);
    if (!decrypted) {
      return config;
    }
    return {
      ...config,
      supabaseAnonKey: decrypted
    };
  } catch {
    return config;
  }
}

function encodeSensitiveConfig(config) {
  if (!config || typeof config !== 'object') {
    return {};
  }
  const next = { ...config };
  const secret = typeof next.supabaseAnonKey === 'string' ? next.supabaseAnonKey.trim() : '';

  if (secret.length > 0) {
    const encrypted = encryptSecret(secret);
    if (encrypted) {
      next.supabaseAnonKeyEnc = encrypted;
      delete next.supabaseAnonKey;
    }
  }

  return next;
}

export async function readConfig() {
  try {
    const raw = await fs.readFile(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return decodeSensitiveConfig(parsed);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

export async function writeConfig(config) {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  const serializableConfig = encodeSensitiveConfig(config);
  await fs.writeFile(CONFIG_PATH, JSON.stringify(serializableConfig, null, 2) + '\n', 'utf8');
  return CONFIG_PATH;
}

export function getConfigPath() {
  return CONFIG_PATH;
}

export function mergeConfig(base, patch) {
  return { ...base, ...patch };
}
