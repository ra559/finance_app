import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler, nowISO, parseAmountToCents } from '../util.js';
import { badRequest, notFound } from '../errors.js';
import { queryTransactions } from '../analytics.js';
import {
  applyCategoryToSimilar,
  invalidateRuleCache,
  learnMerchant,
  recategorizeAutomatically,
} from '../categorize.js';

const router = Router();

router.get('/', (req, res) => {
  const result = queryTransactions({
    search: req.query.search || '',
    categoryId: req.query.category ? Number(req.query.category) : null,
    accountId: req.query.account ? Number(req.query.account) : null,
    from: req.query.from || null,
    to: req.query.to || null,
    sort: req.query.sort || 'date_desc',
    page: req.query.page,
    limit: req.query.limit,
    includePending: req.query.pending !== '0',
    includeExcluded: req.query.excluded !== '0',
    kind: req.query.kind || null,
    uncategorized: req.query.uncategorized === '1',
  });
  res.json(result);
});

router.get('/rules', (req, res) => {
  const rules = db
    .prepare(
      `SELECT r.*, c.name AS category_name, c.color AS category_color
       FROM rules r JOIN categories c ON c.id = r.category_id ORDER BY r.priority ASC, r.id DESC`,
    )
    .all();
  res.json({ rules });
});

router.post(
  '/rules',
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const pattern = String(body.pattern || '').trim();
    if (!pattern) throw badRequest('Rule pattern is required');
    if (body.matchType === 'regex') {
      try {
        new RegExp(pattern);
      } catch {
        throw badRequest('Invalid regular expression');
      }
    }
    const category = db.prepare('SELECT id FROM categories WHERE id = ?').get(body.categoryId);
    if (!category) throw badRequest('Choose a category');
    const result = db
      .prepare('INSERT INTO rules (pattern, field, match_type, category_id, priority, created_at) VALUES (?, ?, ?, ?, 10, ?)')
      .run(
        pattern.slice(0, 200),
        ['any', 'description', 'merchant'].includes(body.field) ? body.field : 'any',
        ['contains', 'exact', 'regex'].includes(body.matchType) ? body.matchType : 'contains',
        category.id,
        nowISO(),
      );
    invalidateRuleCache();
    let affected = 0;
    if (body.applyToExisting !== false) affected = recategorizeAutomatically();
    res.status(201).json({ rule: db.prepare('SELECT * FROM rules WHERE id = ?').get(Number(result.lastInsertRowid)), affected });
  }),
);

router.delete(
  '/rules/:id',
  asyncHandler(async (req, res) => {
    db.prepare('DELETE FROM rules WHERE id = ?').run(req.params.id);
    invalidateRuleCache();
    recategorizeAutomatically();
    res.json({ ok: true });
  }),
);

router.post(
  '/recategorize',
  asyncHandler(async (req, res) => {
    const affected = recategorizeAutomatically();
    res.json({ ok: true, affected });
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(body.accountId);
    if (!account) throw badRequest('Choose an account');
    const amountCents = parseAmountToCents(body.amount);
    if (!amountCents) throw badRequest('Enter a non-zero amount');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.date || ''))) throw badRequest('Enter a valid date');
    const name = String(body.description || '').trim();
    if (!name) throw badRequest('Enter a description');
    const category = body.categoryId
      ? db.prepare('SELECT id FROM categories WHERE id = ?').get(body.categoryId)
      : null;

    const result = db
      .prepare(
        `INSERT INTO transactions
          (account_id, date, name, merchant_name, amount_cents, currency, category_id, category_source,
           pending, excluded, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`,
      )
      .run(
        account.id,
        body.date,
        name.slice(0, 200),
        body.merchantName ? String(body.merchantName).slice(0, 200) : null,
        amountCents,
        account.currency,
        category?.id || null,
        category ? 'manual' : 'uncategorized',
        body.notes ? String(body.notes).slice(0, 1000) : null,
        nowISO(),
      );
    if (category) learnMerchant(name, body.merchantName, category.id);
    res.status(201).json({
      transaction: db
        .prepare(
          `SELECT t.*, c.name AS category_name, c.color AS category_color, a.name AS account_name
           FROM transactions t JOIN accounts a ON a.id = t.account_id
           LEFT JOIN categories c ON c.id = t.category_id WHERE t.id = ?`,
        )
        .get(Number(result.lastInsertRowid)),
    });
  }),
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const transaction = db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.id);
    if (!transaction) throw notFound('Transaction not found');
    const body = req.body || {};
    const fields = [];
    const values = [];

    if (Object.prototype.hasOwnProperty.call(body, 'categoryId')) {
      const categoryId = body.categoryId ? Number(body.categoryId) : null;
      if (categoryId) {
        const category = db.prepare('SELECT id FROM categories WHERE id = ?').get(categoryId);
        if (!category) throw badRequest('Category not found');
      }
      fields.push('category_id = ?', 'category_source = ?');
      values.push(categoryId, categoryId ? 'manual' : 'uncategorized');
      if (categoryId) {
        learnMerchant(transaction.name, transaction.merchant_name, categoryId);
        if (body.applyToSimilar) {
          applyCategoryToSimilar(transaction.name, transaction.merchant_name, categoryId);
        }
      }
    }
    if (Object.prototype.hasOwnProperty.call(body, 'notes')) {
      fields.push('notes = ?');
      values.push(body.notes ? String(body.notes).slice(0, 1000) : null);
    }
    if (Object.prototype.hasOwnProperty.call(body, 'excluded')) {
      fields.push('excluded = ?');
      values.push(body.excluded ? 1 : 0);
    }
    if (Object.prototype.hasOwnProperty.call(body, 'name')) {
      const name = String(body.name || '').trim();
      if (!name) throw badRequest('Description cannot be empty');
      fields.push('name = ?');
      values.push(name.slice(0, 200));
    }
    if (Object.prototype.hasOwnProperty.call(body, 'date')) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.date))) throw badRequest('Invalid date');
      fields.push('date = ?');
      values.push(body.date);
    }
    if (Object.prototype.hasOwnProperty.call(body, 'amount')) {
      const cents = parseAmountToCents(body.amount);
      if (cents === null) throw badRequest('Invalid amount');
      fields.push('amount_cents = ?');
      values.push(cents);
    }

    if (!fields.length) return res.json({ transaction });
    fields.push('updated_at = ?');
    values.push(nowISO(), transaction.id);
    db.prepare(`UPDATE transactions SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    res.json({
      transaction: db
        .prepare(
          `SELECT t.*, c.name AS category_name, c.color AS category_color, a.name AS account_name
           FROM transactions t JOIN accounts a ON a.id = t.account_id
           LEFT JOIN categories c ON c.id = t.category_id WHERE t.id = ?`,
        )
        .get(transaction.id),
    });
  }),
);

router.post(
  '/:id/rule',
  asyncHandler(async (req, res) => {
    const transaction = db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.id);
    if (!transaction) throw notFound('Transaction not found');
    const categoryId = Number(req.body?.categoryId || transaction.category_id);
    if (!categoryId) throw badRequest('Choose a category for this rule');
    const pattern = String(transaction.merchant_name || transaction.name || '').trim();
    if (!pattern) throw badRequest('This transaction has no usable description');
    db.prepare(
      "INSERT INTO rules (pattern, field, match_type, category_id, priority, created_at) VALUES (?, 'any', 'contains', ?, 10, ?)",
    ).run(pattern, categoryId, nowISO());
    invalidateRuleCache();
    const affected = recategorizeAutomatically();
    res.status(201).json({ ok: true, pattern, affected });
  }),
);

router.post(
  '/bulk',
  asyncHandler(async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Boolean) : [];
    if (!ids.length) throw badRequest('Select at least one transaction');
    const categoryId = req.body?.categoryId ? Number(req.body.categoryId) : null;
    if (categoryId && !db.prepare('SELECT id FROM categories WHERE id = ?').get(categoryId)) {
      throw badRequest('Category not found');
    }
    const update = db.prepare('UPDATE transactions SET category_id = ?, category_source = ?, updated_at = ? WHERE id = ?');
    const run = db.transaction(() => {
      for (const id of ids) update.run(categoryId, categoryId ? 'manual' : 'uncategorized', nowISO(), id);
    });
    run();
    res.json({ ok: true, updated: ids.length });
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const result = db.prepare('DELETE FROM transactions WHERE id = ?').run(req.params.id);
    if (!result.changes) throw notFound('Transaction not found');
    res.json({ ok: true });
  }),
);

export default router;
