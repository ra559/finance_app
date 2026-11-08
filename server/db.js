import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config.js';
import { CATEGORIES, SEED_RULES } from './seed-data.js';
import { nowISO } from './util.js';

const dbPath = path.join(config.dataDir, 'cove.db');
const isNewDatabase = !fs.existsSync(dbPath);

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
db.pragma('synchronous = NORMAL');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  user_agent TEXT
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('expense', 'income', 'transfer')),
  color TEXT NOT NULL DEFAULT '#6b7280',
  icon TEXT NOT NULL DEFAULT 'dots',
  sort INTEGER NOT NULL DEFAULT 0,
  is_system INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  official_name TEXT,
  type TEXT NOT NULL DEFAULT 'checking',
  subtype TEXT,
  mask TEXT,
  institution TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  balance_cents INTEGER NOT NULL DEFAULT 0,
  available_cents INTEGER,
  balance_updated_at TEXT,
  plaid_item_id INTEGER REFERENCES plaid_items(id) ON DELETE SET NULL,
  plaid_account_id TEXT,
  is_manual INTEGER NOT NULL DEFAULT 1,
  include_in_networth INTEGER NOT NULL DEFAULT 1,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plaid_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id TEXT NOT NULL UNIQUE,
  access_token TEXT NOT NULL,
  institution_id TEXT,
  institution_name TEXT,
  cursor TEXT,
  last_synced_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  name TEXT NOT NULL,
  merchant_name TEXT,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  category_source TEXT,
  pending INTEGER NOT NULL DEFAULT 0,
  excluded INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  plaid_transaction_id TEXT,
  dedupe_key TEXT,
  raw TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_plaid ON transactions(plaid_transaction_id)
  WHERE plaid_transaction_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_dedupe ON transactions(dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern TEXT NOT NULL,
  field TEXT NOT NULL DEFAULT 'any',
  match_type TEXT NOT NULL DEFAULT 'contains',
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  priority INTEGER NOT NULL DEFAULT 100,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS merchants (
  key TEXT PRIMARY KEY,
  display_name TEXT,
  category_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS budgets (
  category_id INTEGER PRIMARY KEY REFERENCES categories(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recurring (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  merchant_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  amount_cents INTEGER NOT NULL,
  cadence TEXT NOT NULL,
  interval_days INTEGER NOT NULL,
  last_date TEXT NOT NULL,
  next_date TEXT NOT NULL,
  occurrences INTEGER NOT NULL,
  confidence REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS holdings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  security_id TEXT,
  ticker TEXT,
  name TEXT NOT NULL,
  security_type TEXT,
  quantity REAL NOT NULL DEFAULT 0,
  price_cents INTEGER NOT NULL DEFAULT 0,
  value_cents INTEGER NOT NULL DEFAULT 0,
  cost_basis_cents INTEGER,
  currency TEXT NOT NULL DEFAULT 'USD',
  as_of TEXT NOT NULL,
  UNIQUE (account_id, security_id)
);

CREATE TABLE IF NOT EXISTS balance_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  balance_cents INTEGER NOT NULL,
  UNIQUE (account_id, date)
);

CREATE TABLE IF NOT EXISTS mcp_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tools TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS import_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT,
  format TEXT NOT NULL,
  imported INTEGER NOT NULL DEFAULT 0,
  duplicates INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
`);

function seed() {
  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  const defaults = {
    currency: 'USD',
    locale: 'en-US',
    ai_base_url: 'https://api.openai.com/v1',
    ai_model: 'gpt-4.1-mini',
    ai_api_key: '',
    last_sync_at: '',
  };
  for (const [key, value] of Object.entries(defaults)) insertSetting.run(key, value);

  const categoryCount = db.prepare('SELECT COUNT(*) AS count FROM categories').get().count;
  if (categoryCount === 0) {
    const insertCategory = db.prepare(
      'INSERT INTO categories (name, kind, color, icon, sort, is_system) VALUES (?, ?, ?, ?, ?, 1)',
    );
    CATEGORIES.forEach((category, index) => {
      insertCategory.run(category.name, category.kind, category.color, category.icon, index);
    });
  }

  const ruleCount = db.prepare('SELECT COUNT(*) AS count FROM rules').get().count;
  if (ruleCount === 0) {
    const findCategory = db.prepare('SELECT id FROM categories WHERE name = ?');
    const insertRule = db.prepare(
      'INSERT INTO rules (pattern, field, match_type, category_id, priority, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    for (const [pattern, categoryName] of SEED_RULES) {
      const category = findCategory.get(categoryName);
      if (category) insertRule.run(pattern, 'any', 'contains', category.id, 500, nowISO());
    }
  }
}

seed();

export const getSetting = (key, fallback = '') => {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
};

export const setSetting = (key, value) => {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, String(value ?? ''));
};

export const getCategoryById = (id) =>
  id ? db.prepare('SELECT * FROM categories WHERE id = ?').get(id) : undefined;

export const getCategoryByName = (name) =>
  name ? db.prepare('SELECT * FROM categories WHERE lower(name) = lower(?)').get(name) : undefined;

export const countUsers = () => db.prepare('SELECT COUNT(*) AS count FROM users').get().count;

if (isNewDatabase) {
  console.log(`[db] created ${dbPath}`);
}

export { dbPath };
