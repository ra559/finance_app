import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler, nowISO } from '../util.js';
import { badRequest } from '../errors.js';
import { invalidateRuleCache } from '../categorize.js';
import { budgetStatus } from '../analytics.js';
import { currentMonth, isMonth } from '../util.js';

const router = Router();

router.get('/', (req, res) => {
  const month = isMonth(req.query.month) ? req.query.month : currentMonth();
  const status = budgetStatus(month);
  const categories = db
    .prepare(
      `SELECT c.*, COALESCE(b.amount_cents, 0) AS budget,
              (SELECT COUNT(*) FROM transactions t WHERE t.category_id = c.id) AS transaction_count
       FROM categories c LEFT JOIN budgets b ON b.category_id = c.id
       ORDER BY c.kind, c.name`,
    )
    .all();
  res.json({ categories, month, budgetSummary: status });
});

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const name = String(body.name || '').trim();
    if (!name) throw badRequest('Category name is required');
    if (!['expense', 'income', 'transfer'].includes(body.kind)) throw badRequest('Invalid category type');
    if (db.prepare('SELECT id FROM categories WHERE lower(name) = lower(?)').get(name)) {
      throw badRequest('A category with that name already exists');
    }
    const result = db
      .prepare('INSERT INTO categories (name, kind, color, icon, sort, is_system) VALUES (?, ?, ?, ?, 100, 0)')
      .run(
        name.slice(0, 60),
        body.kind,
        /^#[0-9a-f]{6}$/i.test(body.color || '') ? body.color : '#6b7280',
        body.icon ? String(body.icon).slice(0, 20) : 'dots',
      );
    res.status(201).json({ category: db.prepare('SELECT * FROM categories WHERE id = ?').get(Number(result.lastInsertRowid)) });
  }),
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
    if (!category) throw badRequest('Category not found');
    const body = req.body || {};
    const fields = [];
    const values = [];
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) throw badRequest('Name cannot be empty');
      fields.push('name = ?');
      values.push(name.slice(0, 60));
    }
    if (body.color !== undefined && /^#[0-9a-f]{6}$/i.test(body.color)) {
      fields.push('color = ?');
      values.push(body.color);
    }
    if (!fields.length) return res.json({ category });
    values.push(category.id);
    db.prepare(`UPDATE categories SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    invalidateRuleCache();
    res.json({ category: db.prepare('SELECT * FROM categories WHERE id = ?').get(category.id) });
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
    if (!category) throw badRequest('Category not found');
    const budget = db.prepare('SELECT 1 FROM budgets WHERE category_id = ?').get(category.id);
    if (budget && req.query.force !== '1') {
      return res.status(409).json({ error: 'This category has a budget. Remove it first or pass force=1.' });
    }
    db.prepare('DELETE FROM categories WHERE id = ?').run(category.id);
    res.json({ ok: true });
  }),
);

router.get('/budgets/status', (req, res) => {
  const month = isMonth(req.query.month) ? req.query.month : currentMonth();
  res.json(budgetStatus(month));
});

export default router;

export const budgetsRouter = Router();

budgetsRouter.get('/', (req, res) => {
  const month = isMonth(req.query.month) ? req.query.month : currentMonth();
  res.json(budgetStatus(month));
});

budgetsRouter.put(
  '/',
  asyncHandler(async (req, res) => {
    const items = Array.isArray(req.body?.items) ? req.body.items : null;
    if (!items) throw badRequest('Expected an items array');
    const upsert = db.prepare(
      `INSERT INTO budgets (category_id, amount_cents, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(category_id) DO UPDATE SET amount_cents = excluded.amount_cents, updated_at = excluded.updated_at`,
    );
    const remove = db.prepare('DELETE FROM budgets WHERE category_id = ?');
    const run = db.transaction(() => {
      for (const item of items) {
        const categoryId = Number(item.categoryId);
        const amount = Math.max(Math.round(Number(item.amountCents) || 0), 0);
        const category = db.prepare("SELECT id FROM categories WHERE id = ? AND kind = 'expense'").get(categoryId);
        if (!category) continue;
        if (amount > 0) upsert.run(categoryId, amount, nowISO());
        else remove.run(categoryId);
      }
    });
    run();
    res.json(budgetStatus(isMonth(req.body?.month) ? req.body.month : currentMonth()));
  }),
);
