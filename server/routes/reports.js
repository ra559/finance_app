import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../util.js';
import { badRequest } from '../errors.js';
import {
  budgetStatus,
  cashflowSeries,
  dashboard,
  incomeByCategory,
  investmentSummary,
  netWorthSeries,
  netWorthSummary,
  queryTransactions,
  spendingByCategory,
  topMerchants,
} from '../analytics.js';
import { detectRecurring, listRecurring, setRecurringStatus } from '../recurring.js';
import { currentMonth, isISODate, isMonth, monthRange, todayISO } from '../util.js';

const router = Router();

const rangeFromQuery = (query) => {
  const month = isMonth(query.month) ? query.month : currentMonth();
  const fallback = monthRange(month);
  return {
    from: isISODate(query.from) ? query.from : fallback.start,
    to: isISODate(query.to) ? query.to : fallback.end,
  };
};

router.get('/dashboard', (req, res) => {
  const month = isMonth(req.query.month) ? req.query.month : currentMonth();
  res.json(dashboard(month));
});

router.get('/reports/spending', (req, res) => {
  const { from, to } = rangeFromQuery(req.query);
  const group = ['category', 'merchant', 'month'].includes(req.query.group) ? req.query.group : 'category';
  if (group === 'merchant') {
    const merchants = topMerchants(from, to, 50);
    res.json({
      from,
      to,
      group,
      total: merchants.reduce((sum, row) => sum + row.total, 0),
      merchants,
    });
    return;
  }
  const categories = spendingByCategory(from, to);
  res.json({
    from,
    to,
    group,
    total: categories.reduce((sum, row) => sum + row.total, 0),
    categories,
  });
});

router.get('/reports/income', (req, res) => {
  const { from, to } = rangeFromQuery(req.query);
  const categories = incomeByCategory(from, to);
  res.json({ from, to, total: categories.reduce((sum, row) => sum + row.total, 0), categories });
});

router.get('/reports/cashflow', (req, res) => {
  const months = Math.min(Math.max(Number(req.query.months) || 12, 1), 36);
  res.json({ months: cashflowSeries(months) });
});

router.get('/reports/networth', (req, res) => {
  const months = Math.min(Math.max(Number(req.query.months) || 12, 1), 36);
  res.json({ summary: netWorthSummary(), series: netWorthSeries(months) });
});

router.get('/reports/budgets', (req, res) => {
  res.json(budgetStatus(isMonth(req.query.month) ? req.query.month : currentMonth()));
});

router.get('/investments', (req, res) => {
  res.json(investmentSummary());
});

router.get('/recurring', (req, res) => {
  res.json({ bills: listRecurring({ includeDismissed: req.query.dismissed !== '0' }) });
});

router.post(
  '/recurring/detect',
  asyncHandler(async (req, res) => {
    res.json({ bills: detectRecurring() });
  }),
);

router.patch(
  '/recurring/:id',
  asyncHandler(async (req, res) => {
    const status = req.body?.status === 'dismissed' ? 'dismissed' : 'active';
    const result = db.prepare('SELECT id FROM recurring WHERE id = ?').get(req.params.id);
    if (!result) throw badRequest('Bill not found');
    setRecurringStatus(result.id, status);
    res.json({ ok: true, status });
  }),
);

const csvEscape = (value) => {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

router.get(
  '/export/transactions.csv',
  asyncHandler(async (req, res) => {
    const result = queryTransactions({
      search: req.query.search || '',
      categoryId: req.query.category ? Number(req.query.category) : null,
      accountId: req.query.account ? Number(req.query.account) : null,
      from: isISODate(req.query.from) ? req.query.from : null,
      to: isISODate(req.query.to) ? req.query.to : null,
      limit: 500,
      page: 1,
    });
    const rows = [['Date', 'Description', 'Merchant', 'Category', 'Account', 'Amount', 'Currency', 'Pending', 'Notes']];
    for (const tx of result.items) {
      rows.push([
        tx.date,
        tx.name,
        tx.merchant_name || '',
        tx.category_name || 'Uncategorized',
        tx.account_name,
        (tx.amount_cents / 100).toFixed(2),
        tx.currency,
        tx.pending ? 'yes' : 'no',
        tx.notes || '',
      ]);
    }
    const csv = rows.map((row) => row.map(csvEscape).join(',')).join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="cove-transactions-${todayISO()}.csv"`);
    res.send(csv);
  }),
);

export default router;
