import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler, nowISO, parseAmountToCents, todayISO } from '../util.js';
import { badRequest, notFound } from '../errors.js';
import { accountNetWorthCents, isLiability } from '../analytics.js';

const router = Router();
const ACCOUNT_TYPES = ['checking', 'savings', 'credit', 'loan', 'investment', 'cash', 'other'];

function serialize(account) {
  const transactionCount = db
    .prepare('SELECT COUNT(*) AS count FROM transactions WHERE account_id = ?')
    .get(account.id).count;
  return {
    ...account,
    is_liability: isLiability(account.type),
    net_worth_cents: account.include_in_networth ? accountNetWorthCents(account) : 0,
    transaction_count: transactionCount,
  };
}

function parseBalance(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const cents = parseAmountToCents(value);
  if (cents === null) throw badRequest('Balance must be a number');
  return cents;
}

router.get('/', (req, res) => {
  const accounts = db.prepare('SELECT * FROM accounts WHERE archived = 0 ORDER BY type, name').all();
  res.json({ accounts: accounts.map(serialize) });
});

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const name = String(body.name || '').trim();
    if (!name) throw badRequest('Account name is required');
    const type = ACCOUNT_TYPES.includes(body.type) ? body.type : 'checking';
    const balance = parseBalance(body.balance, 0);
    const result = db
      .prepare(
        `INSERT INTO accounts (name, type, subtype, mask, institution, currency, balance_cents,
           balance_updated_at, is_manual, include_in_networth, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(
        name.slice(0, 120),
        type,
        body.subtype ? String(body.subtype).slice(0, 60) : null,
        body.mask ? String(body.mask).slice(-4) : null,
        body.institution ? String(body.institution).slice(0, 120) : null,
        body.currency ? String(body.currency).slice(0, 3).toUpperCase() : 'USD',
        balance,
        nowISO(),
        body.includeInNetworth === false ? 0 : 1,
        nowISO(),
      );
    const accountId = Number(result.lastInsertRowid);
    db.prepare(
      `INSERT INTO balance_snapshots (account_id, date, balance_cents) VALUES (?, ?, ?)
       ON CONFLICT(account_id, date) DO UPDATE SET balance_cents = excluded.balance_cents`,
    ).run(accountId, todayISO(), balance);
    res.status(201).json({ account: serialize(db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId)) });
  }),
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id);
    if (!account) throw notFound('Account not found');
    const body = req.body || {};
    const fields = [];
    const values = [];

    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) throw badRequest('Account name cannot be empty');
      fields.push('name = ?');
      values.push(name.slice(0, 120));
    }
    if (body.type !== undefined) {
      if (!ACCOUNT_TYPES.includes(body.type)) throw badRequest('Invalid account type');
      fields.push('type = ?');
      values.push(body.type);
    }
    if (body.institution !== undefined) {
      fields.push('institution = ?');
      values.push(body.institution ? String(body.institution).slice(0, 120) : null);
    }
    if (body.mask !== undefined) {
      fields.push('mask = ?');
      values.push(body.mask ? String(body.mask).slice(-4) : null);
    }
    if (body.includeInNetworth !== undefined) {
      fields.push('include_in_networth = ?');
      values.push(body.includeInNetworth ? 1 : 0);
    }
    if (body.archived !== undefined) {
      fields.push('archived = ?');
      values.push(body.archived ? 1 : 0);
    }
    if (body.balance !== undefined) {
      const balance = parseBalance(body.balance);
      fields.push('balance_cents = ?', 'balance_updated_at = ?');
      values.push(balance, nowISO());
      db.prepare(
        `INSERT INTO balance_snapshots (account_id, date, balance_cents) VALUES (?, ?, ?)
         ON CONFLICT(account_id, date) DO UPDATE SET balance_cents = excluded.balance_cents`,
      ).run(account.id, todayISO(), balance);
    }

    if (!fields.length) return res.json({ account: serialize(account) });
    values.push(account.id);
    db.prepare(`UPDATE accounts SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    res.json({ account: serialize(db.prepare('SELECT * FROM accounts WHERE id = ?').get(account.id)) });
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id);
    if (!account) throw notFound('Account not found');
    db.prepare('DELETE FROM accounts WHERE id = ?').run(account.id);
    res.json({ ok: true });
  }),
);

export default router;
