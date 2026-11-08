import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');

// Minimal .env loader so the app works without extra dependencies.
function loadDotEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv();

const env = process.env;
const bool = (value, fallback = false) => {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

const appUrl = (env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');

export const config = {
  root: ROOT,
  isProduction: env.NODE_ENV === 'production',
  port: Number(env.PORT || 3000),
  host: env.HOST || '0.0.0.0',
  dataDir: path.resolve(ROOT, env.DATA_DIR || 'data'),
  appUrl,
  trustProxy: bool(env.TRUST_PROXY, true),
  sessionDays: 30,
  syncIntervalHours: Number(env.SYNC_INTERVAL_HOURS ?? 6),
  plaid: {
    clientId: (env.PLAID_CLIENT_ID || '').trim(),
    secret: (env.PLAID_SECRET || '').trim(),
    envName: (env.PLAID_ENV || 'sandbox').trim().toLowerCase(),
    countryCodes: (env.PLAID_COUNTRY_CODES || 'US,CA')
      .split(',')
      .map((code) => code.trim().toUpperCase())
      .filter(Boolean),
    investments: bool(env.PLAID_INVESTMENTS, true),
    get baseUrl() {
      return this.envName === 'production'
        ? 'https://production.plaid.com'
        : this.envName === 'development'
          ? 'https://development.plaid.com'
          : 'https://sandbox.plaid.com';
    },
    get configured() {
      return Boolean(this.clientId && this.secret);
    },
  },
  ai: {
    baseUrl: (env.AI_BASE_URL || '').trim(),
    apiKey: (env.AI_API_KEY || '').trim(),
    model: (env.AI_MODEL || '').trim(),
  },
};

fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
