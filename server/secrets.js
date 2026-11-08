import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const SECRET_FILE = path.join(config.dataDir, 'secret.key');
let cachedKey = null;

function getKey() {
  if (cachedKey) return cachedKey;
  if (process.env.APP_SECRET) {
    cachedKey = crypto.createHash('sha256').update(process.env.APP_SECRET).digest();
    return cachedKey;
  }
  try {
    const stored = fs.readFileSync(SECRET_FILE, 'utf8').trim();
    if (/^[0-9a-f]{64}$/i.test(stored)) {
      cachedKey = Buffer.from(stored, 'hex');
      return cachedKey;
    }
  } catch {
    // generate below
  }
  const key = crypto.randomBytes(32);
  fs.writeFileSync(SECRET_FILE, key.toString('hex'), { mode: 0o600 });
  cachedKey = key;
  return key;
}

export function encryptSecret(plain) {
  if (!plain) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join(':');
}

export function decryptSecret(payload) {
  if (!payload) return '';
  const parts = String(payload).split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') return '';
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(parts[1], 'base64'));
    decipher.setAuthTag(Buffer.from(parts[2], 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

export function maskSecret(value) {
  if (!value) return '';
  if (value.length <= 8) return '••••••••';
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}
