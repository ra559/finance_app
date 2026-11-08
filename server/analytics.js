import { db } from './db.js';
import {
  addDays,
  addMonths,
  currentMonth,
  daysBetween,
  lastMonths,
  monthRange,
  todayISO,
} from './util.js';

const LIABILITY_TYPES = new Set(['credit', 'loan']);

export const isLiability = (type) => LIABILITY_TYPES.has(String(type || '').toLowerCase());

export function listAccounts({ includeArchived = false } = {}) {
  const where = includeArchived ? '' : 'WHERE a.archived = 0';
  return db
    .prepare(
      `SELECT a.*, p.institution_name AS plaid_institution
       FROM accounts a LEFT JOIN plaid_items p ON p.id = a.plaid_item_id
       ${where} ORDER BY a.type, a.name`,
    )
    .all();
}

export function accountNetWorthCents(account) {
  return isLiability(account.type) ? -account.balance_cents : account.balance_cents;
}

export function netWorthSummary() {
  const accounts = listAccounts();
  let assets = 0;
  let liabilities = 0;
  for (const account of accounts) {
    if (!account.include_in_networth) continue;
    if (isLiability(account.type)) liabilities += account.balance_cents;
    else assets += account.balance_cents;
  }
  return { assets, liabilities, net: assets - liabilities, accounts };
}

export function monthTotals(month = currentMonth()) {
  const { start, end } = monthRange(month);
  const base = `
    SELECT COALESCE(SUM(ABS(t.amount_cents)), 0) AS total, COUNT(*) AS count
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id AND a.archived = 0
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE t.date BETWEEN ? AND ? AND t.pending = 0 AND t.excluded = 0`;
  const income = db
    .prepare(`${base} AND t.amount_cents > 0 AND c.kind = 'income'`)
    .get(start, end);
  const spending = db
    .prepare(`${base} AND t.amount_cents < 0 AND (c.kind = 'expense' OR c.id IS NULL)`)
    .get(start, end);
  const net = income.total - spending.total;
  return {
    month,
    income: income.total,
    incomeCount: income.count,
    spending: spending.total,
    spendingCount: spending.count,
    net,
    savingsRate: income.total > 0 ? net / income.total : null,
  };
}

export function spendingByCategory(startDate, endDate) {
  const rows = db
    .prepare(
      `SELECT c.id, c.name, c.color, c.icon, COALESCE(SUM(-t.amount_cents), 0) AS total, COUNT(*) AS count
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id AND a.archived = 0
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.date BETWEEN ? AND ? AND t.pending = 0 AND t.excluded = 0
         AND t.amount_cents < 0 AND (c.kind = 'expense' OR c.id IS NULL)
       GROUP BY c.id
       ORDER BY total DESC`,
    )
    .all(startDate, endDate);
  return rows.map((row) => ({
    categoryId: row.id,
    name: row.name || 'Uncategorized',
    color: row.color || '#64748b',
    icon: row.icon || 'dots',
    total: row.total,
    count: row.count,
  }));
}

export function incomeByCategory(startDate, endDate) {
  return db
    .prepare(
      `SELECT c.id AS categoryId, c.name, c.color, COALESCE(SUM(t.amount_cents), 0) AS total, COUNT(*) AS count
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id AND a.archived = 0
       JOIN categories c ON c.id = t.category_id AND c.kind = 'income'
       WHERE t.date BETWEEN ? AND ? AND t.pending = 0 AND t.excluded = 0 AND t.amount_cents > 0
       GROUP BY c.id ORDER BY total DESC`,
    )
    .all(startDate, endDate);
}

export function topMerchants(startDate, endDate, limit = 8) {
  return db
    .prepare(
      `SELECT COALESCE(NULLIF(TRIM(t.merchant_name), ''), t.name) AS merchant,
              COALESCE(SUM(-t.amount_cents), 0) AS total, COUNT(*) AS count
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id AND a.archived = 0
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.date BETWEEN ? AND ? AND t.pending = 0 AND t.excluded = 0
         AND t.amount_cents < 0 AND (c.kind = 'expense' OR c.id IS NULL)
       GROUP BY lower(COALESCE(NULLIF(TRIM(t.merchant_name), ''), t.name))
       ORDER BY total DESC LIMIT ?`,
    )
    .all(startDate, endDate, limit);
}

export function cashflowSeries(months = 12, endMonth = currentMonth()) {
  return lastMonths(months, endMonth).map((month) => {
    const totals = monthTotals(month);
    return {
      month,
      income: totals.income,
      spending: totals.spending,
      net: totals.net,
    };
  });
}

export function budgetStatus(month = currentMonth()) {
  const { start, end } = monthRange(month);
  const rows = db
    .prepare(
      `SELECT c.id, c.name, c.color, c.icon,
              COALESCE(b.amount_cents, 0) AS budget,
              COALESCE(SUM(CASE WHEN t.amount_cents < 0 THEN -t.amount_cents ELSE 0 END), 0) AS spent,
              COUNT(t.id) AS count
       FROM categories c
       LEFT JOIN budgets b ON b.category_id = c.id
       LEFT JOIN transactions t ON t.category_id = c.id
         AND t.date BETWEEN ? AND ? AND t.pending = 0 AND t.excluded = 0
       WHERE c.kind = 'expense'
       GROUP BY c.id
       HAVING budget > 0 OR spent > 0
       ORDER BY budget DESC, spent DESC`,
    )
    .all(start, end)
    .map((row) => {
      const percent = row.budget > 0 ? row.spent / row.budget : null;
      return {
        categoryId: row.id,
        name: row.name,
        color: row.color,
        icon: row.icon,
        budget: row.budget,
        spent: row.spent,
        remaining: row.budget - row.spent,
        percent,
        count: row.count,
      };
    });

  const totalBudget = rows.reduce((sum, row) => sum + row.budget, 0);
  const totalSpent = rows.reduce((sum, row) => sum + row.spent, 0);
  const unbudgeted = rows.filter((row) => row.budget === 0 && row.spent > 0).reduce((sum, row) => sum + row.spent, 0);
  return { month, rows, totalBudget, totalSpent, remaining: totalBudget - totalSpent, unbudgeted };
}

function transactionsByAccountAfter(startDate) {
  const rows = db
    .prepare(
      `SELECT account_id, date, SUM(amount_cents) AS cents
       FROM transactions WHERE date > ? AND pending = 0
       GROUP BY account_id, date ORDER BY date ASC`,
    )
    .all(startDate);
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.account_id)) map.set(row.account_id, []);
    map.get(row.account_id).push({ date: row.date, cents: row.cents });
  }
  return map;
}

function snapshotsBefore(date) {
  const rows = db
    .prepare('SELECT account_id, date, balance_cents FROM balance_snapshots WHERE date <= ? ORDER BY date ASC')
    .all(date);
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.account_id)) map.set(row.account_id, []);
    map.get(row.account_id).push({ date: row.date, balance: row.balance_cents });
  }
  return map;
}

function sumAfter(rows, date) {
  let total = 0;
  for (const row of rows || []) {
    if (row.date > date) total += row.cents;
    else continue;
  }
  return total;
}

function lastSnapshotAt(rows, date) {
  let value = null;
  for (const row of rows || []) {
    if (row.date <= date) value = row.balance;
    else break;
  }
  return value;
}

/**
 * Net worth history. Non-investment account balances are reconstructed by
 * rolling transactions back from today's balance; investment accounts use the
 * daily balance snapshots Cove records on each sync.
 */
export function netWorthSeries(months = 12, endMonth = currentMonth()) {
  const monthList = lastMonths(months, endMonth);
  const startDate = monthRange(monthList[0]).start;
  const accounts = listAccounts().filter((account) => account.include_in_networth);
  const txByAccount = transactionsByAccountAfter(startDate);
  const investmentAccounts = accounts.filter((account) => account.type === 'investment');
  const snapshotMap = investmentAccounts.length ? snapshotsBefore(todayISO()) : new Map();

  const samples = monthList.map((month) => {
    const { end } = monthRange(month);
    const isCurrent = month === currentMonth();
    return { month, date: isCurrent ? todayISO() : end };
  });

  return samples.map(({ month, date }) => {
    let assets = 0;
    let liabilities = 0;
    for (const account of accounts) {
      let balance;
      if (account.type === 'investment') {
        const snap = lastSnapshotAt(snapshotMap.get(account.id), date);
        balance = snap ?? account.balance_cents;
      } else {
        const delta = sumAfter(txByAccount.get(account.id), date);
        balance = isLiability(account.type) ? account.balance_cents + delta : account.balance_cents - delta;
      }
      if (isLiability(account.type)) liabilities += balance;
      else assets += balance;
    }
    return { month, date, assets, liabilities, net: assets - liabilities };
  });
}

export function monthEndNetWorth(month) {
  const series = netWorthSeries(2, month);
  return series.length ? series[series.length - 1] : null;
}

export function netWorthChange(months = 1) {
  const series = netWorthSeries(months + 1);
  if (series.length < 2) return { change: 0, percent: 0 };
  const previous = series[series.length - 2].net;
  const current = series[series.length - 1].net;
  return {
    change: current - previous,
    percent: previous !== 0 ? (current - previous) / Math.abs(previous) : null,
  };
}

export function queryTransactions(options = {}) {
  const {
    search = '',
    categoryId = null,
    categoryIds = null,
    uncategorized = false,
    accountId = null,
    from = null,
    to = null,
    kind = null,
    page = 1,
    limit = 50,
    sort = 'date_desc',
    includePending = true,
    includeExcluded = true,
  } = options;

  const where = [];
  const params = [];
  if (search) {
    where.push('(t.name LIKE ? OR t.merchant_name LIKE ? OR t.notes LIKE ? OR t.amount_cents = ?)');
    const like = `%${search}%`;
    const numeric = Number.parseFloat(String(search).replace(/[^0-9.-]/g, ''));
    params.push(like, like, like, Number.isFinite(numeric) ? Math.round(numeric * 100) : Number.MIN_SAFE_INTEGER);
  }
  if (uncategorized) where.push('t.category_id IS NULL');
  else if (Array.isArray(categoryIds) && categoryIds.length) {
    where.push(`t.category_id IN (${categoryIds.map(() => '?').join(',')})`);
    params.push(...categoryIds);
  } else if (categoryId) {
    where.push('t.category_id = ?');
    params.push(categoryId);
  }
  if (accountId) {
    where.push('t.account_id = ?');
    params.push(accountId);
  }
  if (from) {
    where.push('t.date >= ?');
    params.push(from);
  }
  if (to) {
    where.push('t.date <= ?');
    params.push(to);
  }
  if (kind === 'income') where.push('t.amount_cents > 0');
  if (kind === 'expense') where.push('t.amount_cents < 0');
  if (!includePending) where.push('t.pending = 0');
  if (!includeExcluded) where.push('t.excluded = 0');

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const orderSql =
    sort === 'date_asc'
      ? 'ORDER BY t.date ASC, t.id ASC'
      : sort === 'amount_desc'
        ? 'ORDER BY ABS(t.amount_cents) DESC, t.date DESC'
        : 'ORDER BY t.date DESC, t.id DESC';

  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 500);
  const safePage = Math.max(Number(page) || 1, 1);
  const offset = (safePage - 1) * safeLimit;

  const total = db
    .prepare(`SELECT COUNT(*) AS count FROM transactions t ${whereSql}`)
    .get(...params).count;

  const items = db
    .prepare(
      `SELECT t.*, c.name AS category_name, c.color AS category_color, c.kind AS category_kind,
              a.name AS account_name, a.type AS account_type, a.institution AS account_institution
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       LEFT JOIN categories c ON c.id = t.category_id
       ${whereSql} ${orderSql} LIMIT ? OFFSET ?`,
    )
    .all(...params, safeLimit, offset);

  const sum = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN t.amount_cents < 0 THEN -t.amount_cents ELSE 0 END), 0) AS outflow,
              COALESCE(SUM(CASE WHEN t.amount_cents > 0 THEN t.amount_cents ELSE 0 END), 0) AS inflow
       FROM transactions t ${whereSql}`,
    )
    .get(...params);

  return {
    items,
    total,
    page: safePage,
    limit: safeLimit,
    pages: Math.max(Math.ceil(total / safeLimit), 1),
    outflow: sum.outflow,
    inflow: sum.inflow,
  };
}

export function investmentSummary() {
  const holdings = db
    .prepare(
      `SELECT h.*, a.name AS account_name, a.institution
       FROM holdings h JOIN accounts a ON a.id = h.account_id
       WHERE a.archived = 0 ORDER BY h.value_cents DESC`,
    )
    .all();
  const totalValue = holdings.reduce((sum, row) => sum + row.value_cents, 0);
  const totalCost = holdings.reduce((sum, row) => sum + (row.cost_basis_cents ?? row.value_cents), 0);

  const byType = new Map();
  for (const holding of holdings) {
    const type = (holding.security_type || 'other').toLowerCase();
    const bucket = byType.get(type) || { type, value: 0, cost: 0, count: 0 };
    bucket.value += holding.value_cents;
    bucket.cost += holding.cost_basis_cents ?? holding.value_cents;
    bucket.count += 1;
    byType.set(type, bucket);
  }

  const series = db
    .prepare(
      `SELECT date, SUM(balance_cents) AS value FROM balance_snapshots
       WHERE account_id IN (SELECT id FROM accounts WHERE type = 'investment' AND archived = 0)
       GROUP BY date ORDER BY date ASC`,
    )
    .all();

  return {
    holdings,
    totalValue,
    totalCost,
    gain: totalValue - totalCost,
    gainPercent: totalCost > 0 ? (totalValue - totalCost) / totalCost : null,
    allocation: [...byType.values()].sort((a, b) => b.value - a.value),
    series,
  };
}

export function upcomingRecurring(limit = 6) {
  return db
    .prepare(
      `SELECT r.*, c.name AS category_name, c.color AS category_color
       FROM recurring r LEFT JOIN categories c ON c.id = r.category_id
       WHERE r.status = 'active' AND r.amount_cents < 0
       ORDER BY r.next_date ASC LIMIT ?`,
    )
    .all(limit);
}

export function recentTransactions(limit = 8) {
  return db
    .prepare(
      `SELECT t.*, c.name AS category_name, c.color AS category_color, a.name AS account_name
       FROM transactions t JOIN accounts a ON a.id = t.account_id
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.pending = 0 AND a.archived = 0
       ORDER BY t.date DESC, t.id DESC LIMIT ?`,
    )
    .all(limit);
}

export function dashboard(month = currentMonth()) {
  const netWorth = netWorthSummary();
  const totals = monthTotals(month);
  const previous = monthTotals(addMonths(month, -1));
  const series = netWorthSeries(12, month);
  const change = (() => {
    const index = series.findIndex((point) => point.month === month);
    const currentPoint = index >= 0 ? series[index] : series[series.length - 1];
    const previousPoint = index > 0 ? series[index - 1] : series[series.length - 2];
    if (!currentPoint || !previousPoint) return { change: 0, percent: null };
    return {
      change: currentPoint.net - previousPoint.net,
      percent:
        previousPoint.net !== 0
          ? (currentPoint.net - previousPoint.net) / Math.abs(previousPoint.net)
          : null,
    };
  })();

  const { start, end } = monthRange(month);
  return {
    month,
    totals,
    previous,
    netWorth: { assets: netWorth.assets, liabilities: netWorth.liabilities, net: netWorth.net, change },
    cashflow: cashflowSeries(12, month),
    netWorthSeries: series,
    spendingByCategory: spendingByCategory(start, end),
    topMerchants: topMerchants(start, end, 6),
    budgets: budgetStatus(month),
    recent: recentTransactions(8),
    upcoming: upcomingRecurring(6),
    accounts: netWorth.accounts,
    investments: investmentSummary(),
  };
}

export function spendingRangeSummary(startDate, endDate) {
  const categories = spendingByCategory(startDate, endDate);
  const total = categories.reduce((sum, row) => sum + row.total, 0);
  const days = Math.max(daysBetween(startDate, endDate) + 1, 1);
  return { startDate, endDate, total, categories, days, averagePerDay: Math.round(total / days) };
}

export function budgetLookup(month = currentMonth()) {
  const status = budgetStatus(month);
  return {
    month,
    totalBudget: status.totalBudget,
    totalSpent: status.totalSpent,
    unbudgeted: status.unbudgeted,
    categories: status.rows,
  };
}

export function dateRangeForMonths(months = 12, endMonth = currentMonth()) {
  const list = lastMonths(months, endMonth);
  return { start: monthRange(list[0]).start, end: addDays(monthRange(endMonth).end, 0), months: list };
}
