import { config } from './config.js';
import { db } from './db.js';
import { decryptSecret, encryptSecret } from './secrets.js';
import { categorize } from './categorize.js';
import { merchantKey, nowISO, todayISO } from './util.js';

class PlaidError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'PlaidError';
    this.details = details;
  }
}

async function plaidRequest(path, body = {}) {
  if (!config.plaid.configured) {
    throw new PlaidError('Plaid is not configured. Add PLAID_CLIENT_ID and PLAID_SECRET to your environment.');
  }
  const response = await fetch(`${config.plaid.baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: config.plaid.clientId,
      secret: config.plaid.secret,
      ...body,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new PlaidError(payload.error_message || `Plaid request failed (${response.status})`, {
      status: response.status,
      code: payload.error_code,
      type: payload.error_type,
    });
  }
  return payload;
}

export function plaidStatus() {
  return {
    configured: config.plaid.configured,
    environment: config.plaid.envName,
    investments: config.plaid.investments,
    countryCodes: config.plaid.countryCodes,
  };
}

export async function createLinkToken() {
  const payload = await plaidRequest('/link/token/create', {
    user_id: 'cove-user',
    client_name: 'Cove',
    language: 'en',
    country_codes: config.plaid.countryCodes,
    products: config.plaid.investments ? ['transactions', 'investments'] : ['transactions'],
    transactions: { days_requested: 730 },
    webhook: `${config.appUrl}/api/plaid/webhook`,
  });
  return payload.link_token;
}

export async function createSandboxPublicToken() {
  if (config.plaid.envName !== 'sandbox') throw new PlaidError('Sandbox helper is only available in the sandbox environment');
  const payload = await plaidRequest('/sandbox/public_token/create', {
    institution_id: 'ins_109508',
    initial_products: config.plaid.investments ? ['transactions', 'investments'] : ['transactions'],
    options: {
      override_username: 'user_transactions_dynamic',
      override_password: 'pass_good',
      transactions: { days_requested: 730 },
    },
  });
  return payload.public_token;
}

function mapAccountType(type, subtype) {
  const kind = String(type || '').toLowerCase();
  const sub = String(subtype || '').toLowerCase();
  if (kind === 'depository') return sub === 'savings' ? 'savings' : 'checking';
  if (kind === 'credit') return 'credit';
  if (kind === 'loan') return 'loan';
  if (kind === 'investment' || kind === 'brokerage') return 'investment';
  if (sub === 'savings') return 'savings';
  return 'other';
}

function snapshotBalance(accountId, balanceCents, date = todayISO()) {
  db.prepare(
    `INSERT INTO balance_snapshots (account_id, date, balance_cents) VALUES (?, ?, ?)
     ON CONFLICT(account_id, date) DO UPDATE SET balance_cents = excluded.balance_cents`,
  ).run(accountId, date, balanceCents);
}

export function snapshotAllBalances() {
  const accounts = db.prepare('SELECT id, balance_cents FROM accounts WHERE archived = 0').all();
  const insert = db.prepare(
    `INSERT INTO balance_snapshots (account_id, date, balance_cents) VALUES (?, ?, ?)
     ON CONFLICT(account_id, date) DO UPDATE SET balance_cents = excluded.balance_cents`,
  );
  const run = db.transaction(() => {
    for (const account of accounts) insert.run(account.id, todayISO(), account.balance_cents);
  });
  run();
}

async function syncAccounts(item) {
  const payload = await plaidRequest('/accounts/get', { access_token: decryptSecret(item.access_token) });
  const updated = [];
  for (const account of payload.accounts || []) {
    const balanceCents = Math.round(Number(account.balances?.current ?? account.balances?.available ?? 0) * 100);
    const existing = db
      .prepare('SELECT id FROM accounts WHERE plaid_account_id = ?')
      .get(account.account_id);
    if (existing) {
      db.prepare(
        `UPDATE accounts SET name = ?, official_name = ?, subtype = ?, mask = ?, balance_cents = ?,
           available_cents = ?, balance_updated_at = ?, currency = ?
         WHERE id = ?`,
      ).run(
        account.name || 'Account',
        account.official_name || null,
        account.subtype || null,
        account.mask || null,
        balanceCents,
        account.balances?.available != null ? Math.round(account.balances.available * 100) : null,
        nowISO(),
        account.balances?.iso_currency_code || 'USD',
        existing.id,
      );
      snapshotBalance(existing.id, balanceCents);
      updated.push(existing.id);
    } else {
      const result = db
        .prepare(
          `INSERT INTO accounts
            (name, official_name, type, subtype, mask, institution, currency, balance_cents,
             available_cents, balance_updated_at, plaid_item_id, plaid_account_id, is_manual, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        )
        .run(
          account.name || 'Account',
          account.official_name || null,
          mapAccountType(account.type, account.subtype),
          account.subtype || null,
          account.mask || null,
          item.institution_name || null,
          account.balances?.iso_currency_code || 'USD',
          balanceCents,
          account.balances?.available != null ? Math.round(account.balances.available * 100) : null,
          nowISO(),
          item.id,
          account.account_id,
          nowISO(),
        );
      snapshotBalance(Number(result.lastInsertRowid), balanceCents);
      updated.push(Number(result.lastInsertRowid));
    }
  }
  return payload.accounts || [];
}

async function syncHoldings(item, plaidAccounts) {
  if (!config.plaid.investments) return 0;
  const investmentAccountIds = plaidAccounts
    .filter((account) => String(account.type).toLowerCase() === 'investment')
    .map((account) => account.account_id);
  if (!investmentAccountIds.length) return 0;

  const payload = await plaidRequest('/investments/holdings/get', {
    access_token: decryptSecret(item.access_token),
  });
  const securities = new Map((payload.securities || []).map((security) => [security.security_id, security]));
  const accountsByPlaidId = new Map(
    db
      .prepare('SELECT id, plaid_account_id FROM accounts WHERE plaid_account_id IS NOT NULL')
      .all()
      .map((row) => [row.plaid_account_id, row.id]),
  );

  const asOf = todayISO();
  let count = 0;
  const run = db.transaction(() => {
    for (const plaidAccountId of investmentAccountIds) {
      const localId = accountsByPlaidId.get(plaidAccountId);
      if (!localId) continue;
      db.prepare('DELETE FROM holdings WHERE account_id = ?').run(localId);
      for (const holding of (payload.holdings || []).filter((row) => row.account_id === plaidAccountId)) {
        const security = securities.get(holding.security_id) || {};
        db.prepare(
          `INSERT INTO holdings
            (account_id, security_id, ticker, name, security_type, quantity, price_cents, value_cents,
             cost_basis_cents, currency, as_of)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          localId,
          holding.security_id,
          security.ticker_symbol || security.name || 'Cash',
          security.name || security.ticker_symbol || 'Holding',
          security.type || 'other',
          Number(holding.quantity || 0),
          Math.round(Number(holding.institution_price || 0) * 100),
          Math.round(Number(holding.institution_value || 0) * 100),
          holding.cost_basis != null ? Math.round(Number(holding.cost_basis) * 100) : null,
          holding.iso_currency_code || 'USD',
          asOf,
        );
        count += 1;
      }
    }
  });
  run();
  return count;
}

function saveTransaction(tx, account, currency) {
  const category = categorize({
    name: tx.name || tx.merchant_name || 'Transaction',
    merchant_name: tx.merchant_name,
    plaidCategory: tx.personal_finance_category,
  });
  const amountCents = -Math.round(Number(tx.amount || 0) * 100);
  const existing = db.prepare('SELECT id FROM transactions WHERE plaid_transaction_id = ?').get(tx.transaction_id);
  if (!existing) {
    db.prepare(
      `INSERT INTO transactions
        (account_id, date, name, merchant_name, amount_cents, currency, category_id, category_source,
         pending, excluded, plaid_transaction_id, raw, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    ).run(
      account.id,
      tx.date,
      tx.name || tx.merchant_name || 'Transaction',
      tx.merchant_name || null,
      amountCents,
      tx.iso_currency_code || currency,
      category.categoryId,
      category.source,
      tx.pending ? 1 : 0,
      tx.transaction_id,
      JSON.stringify({ personal_finance_category: tx.personal_finance_category, logo_url: tx.logo_url }),
      nowISO(),
    );
  } else {
    db.prepare(
      `UPDATE transactions SET date = ?, name = ?, merchant_name = ?, amount_cents = ?, currency = ?,
         pending = ?, raw = ?, updated_at = ?,
         category_id = CASE WHEN category_source = 'manual' THEN category_id ELSE ? END,
         category_source = CASE WHEN category_source = 'manual' THEN 'manual' ELSE ? END
       WHERE plaid_transaction_id = ?`,
    ).run(
      tx.date,
      tx.name || tx.merchant_name || 'Transaction',
      tx.merchant_name || null,
      amountCents,
      tx.iso_currency_code || currency,
      tx.pending ? 1 : 0,
      JSON.stringify({ personal_finance_category: tx.personal_finance_category, logo_url: tx.logo_url }),
      nowISO(),
      category.categoryId,
      category.source,
      tx.transaction_id,
    );
  }
}

export async function syncItem(item) {
  const accessToken = decryptSecret(item.access_token);
  if (!accessToken) throw new PlaidError('Stored bank token could not be decrypted. Reconnect the bank account.');

  const plaidAccounts = await syncAccounts(item);
  const accountsByPlaidId = new Map(
    db
      .prepare('SELECT id, plaid_account_id, currency FROM accounts WHERE plaid_account_id IS NOT NULL')
      .all()
      .map((row) => [row.plaid_account_id, row]),
  );

  let cursor = item.cursor || undefined;
  let added = 0;
  let modified = 0;
  let removed = 0;
  let pages = 0;

  for (;;) {
    const payload = await plaidRequest('/transactions/sync', {
      access_token: accessToken,
      cursor,
      count: 500,
      options: { include_personal_finance_category: true },
    });

    const run = db.transaction(() => {
      for (const tx of payload.added || []) {
        const account = accountsByPlaidId.get(tx.account_id);
        if (!account) continue;
        saveTransaction(tx, account, account.currency);
        added += 1;
      }
      for (const tx of payload.modified || []) {
        const account = accountsByPlaidId.get(tx.account_id);
        if (!account) continue;
        saveTransaction(tx, account, account.currency);
        modified += 1;
      }
      for (const tx of payload.removed || []) {
        if (!tx.transaction_id) continue;
        db.prepare('DELETE FROM transactions WHERE plaid_transaction_id = ?').run(tx.transaction_id);
        removed += 1;
      }
    });
    run();

    cursor = payload.next_cursor;
    pages += 1;
    if (!payload.has_more || pages >= 20) break;
  }

  const holdings = await syncHoldings(item, plaidAccounts);

  db.prepare('UPDATE plaid_items SET cursor = ?, last_synced_at = ?, last_error = NULL WHERE id = ?').run(
    cursor || null,
    nowISO(),
    item.id,
  );
  db.prepare("INSERT INTO settings (key, value) VALUES ('last_sync_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    nowISO(),
  );

  return { added, modified, removed, holdings, accounts: plaidAccounts.length };
}

export async function exchangePublicToken(publicToken, institution) {
  const payload = await plaidRequest('/item/public_token/exchange', { public_token: publicToken });
  const existing = db.prepare('SELECT id FROM plaid_items WHERE item_id = ?').get(payload.item_id);
  let itemId;
  if (existing) {
    db.prepare(
      'UPDATE plaid_items SET access_token = ?, institution_id = ?, institution_name = ?, last_error = NULL WHERE id = ?',
    ).run(
      encryptSecret(payload.access_token),
      institution?.institution_id || null,
      institution?.name || null,
      existing.id,
    );
    itemId = existing.id;
  } else {
    const result = db
      .prepare(
        'INSERT INTO plaid_items (item_id, access_token, institution_id, institution_name, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(
        payload.item_id,
        encryptSecret(payload.access_token),
        institution?.institution_id || null,
        institution?.name || null,
        nowISO(),
      );
    itemId = Number(result.lastInsertRowid);
  }

  const item = db.prepare('SELECT * FROM plaid_items WHERE id = ?').get(itemId);
  const result = await syncItem(item);
  return { itemId, ...result };
}

export async function syncAllItems() {
  const items = db.prepare('SELECT * FROM plaid_items ORDER BY id').all();
  const results = [];
  for (const item of items) {
    try {
      const result = await syncItem(item);
      results.push({ itemId: item.id, institution: item.institution_name, ...result });
    } catch (error) {
      db.prepare('UPDATE plaid_items SET last_error = ? WHERE id = ?').run(
        String(error.message || error).slice(0, 400),
        item.id,
      );
      results.push({ itemId: item.id, institution: item.institution_name, error: error.message });
      console.error(`[plaid] sync failed for item ${item.id}:`, error.message);
    }
  }
  return results;
}

export async function syncItemById(id) {
  const item = db.prepare('SELECT * FROM plaid_items WHERE id = ?').get(id);
  if (!item) throw new PlaidError('Bank connection not found');
  return syncItem(item);
}

export function listItems() {
  return db
    .prepare(
      `SELECT p.id, p.institution_id, p.institution_name, p.last_synced_at, p.last_error, p.created_at,
              (SELECT COUNT(*) FROM accounts a WHERE a.plaid_item_id = p.id) AS account_count
       FROM plaid_items p ORDER BY p.id`,
    )
    .all();
}

export function removeItem(id) {
  const item = db.prepare('SELECT * FROM plaid_items WHERE id = ?').get(id);
  if (!item) return;
  db.prepare('DELETE FROM accounts WHERE plaid_item_id = ?').run(id);
  db.prepare('DELETE FROM plaid_items WHERE id = ?').run(id);
}

export async function fetchInstitutionName(institutionId) {
  try {
    const payload = await plaidRequest('/institutions/get_by_id', {
      institution_id: institutionId,
      country_codes: config.plaid.countryCodes,
    });
    return payload.institution?.name || institutionId;
  } catch {
    return institutionId;
  }
}

export function handleWebhook(body) {
  if (!body || body.webhook_type !== 'TRANSACTIONS') return { synced: false };
  const item = db.prepare('SELECT id FROM plaid_items WHERE item_id = ?').get(body.item_id);
  if (!item) return { synced: false };
  // Debounce: never sync the same item more than once every 30 seconds.
  const last = db.prepare('SELECT last_synced_at FROM plaid_items WHERE id = ?').get(item.id);
  if (last?.last_synced_at && Date.now() - Date.parse(last.last_synced_at) < 30_000) {
    return { synced: false, debounced: true };
  }
  syncItemById(item.id).catch((error) => {
    db.prepare('UPDATE plaid_items SET last_error = ? WHERE id = ?').run(error.message.slice(0, 400), item.id);
  });
  return { synced: true };
}

export { PlaidError, plaidRequest };
