import { db, getSetting } from './db.js';
import {
  budgetStatus,
  cashflowSeries,
  incomeByCategory,
  investmentSummary,
  listAccounts,
  monthTotals,
  netWorthSeries,
  netWorthSummary,
  queryTransactions,
  spendingByCategory,
  spendingRangeSummary,
  topMerchants,
} from './analytics.js';
import { listRecurring } from './recurring.js';
import { currentMonth, isISODate, isMonth, lastMonths, monthRange, todayISO } from './util.js';

const MAX_LIMIT = 100;

const dollars = (cents) => Math.round((Number(cents) || 0)) / 100;
const currency = () => getSetting('currency', 'USD');

function resolveRange(args = {}) {
  const end = isISODate(args.end_date) ? args.end_date : todayISO();
  const start = isISODate(args.start_date) ? args.start_date : monthRange(currentMonth()).start;
  if (start > end) return { start: end, end: start };
  return { start, end };
}

function resolveMonth(value) {
  return isMonth(value) ? value : currentMonth();
}

function findCategory(name) {
  if (!name) return null;
  return (
    db.prepare('SELECT * FROM categories WHERE lower(name) = lower(?)').get(name) ||
    db.prepare("SELECT * FROM categories WHERE name LIKE ? ORDER BY length(name) LIMIT 1").get(`%${name}%`) ||
    null
  );
}

function categoryRows(rows) {
  return rows.map((row) => ({
    category: row.name || 'Uncategorized',
    amount: dollars(row.total),
    transactions: row.count ?? undefined,
  }));
}

const tools = [
  {
    name: 'get_financial_overview',
    description:
      'High-level snapshot: net worth, assets, liabilities, this month income and spending, budget totals, top spending categories and upcoming bills.',
    schema: { type: 'object', properties: {}, required: [] },
    handler: () => {
      const netWorth = netWorthSummary();
      const month = monthTotals();
      const spending = spendingByCategory(monthRange(currentMonth()).start, todayISO());
      const budgets = budgetStatus();
      const upcoming = listRecurring({ includeDismissed: false }).slice(0, 6);
      return {
        currency: currency(),
        as_of: todayISO(),
        month: currentMonth(),
        net_worth: dollars(netWorth.net),
        assets: dollars(netWorth.assets),
        liabilities: dollars(netWorth.liabilities),
        month_income: dollars(month.income),
        month_spending: dollars(month.spending),
        month_net_cashflow: dollars(month.net),
        savings_rate: month.savingsRate,
        budget: {
          total_budget: dollars(budgets.totalBudget),
          spent: dollars(budgets.totalSpent),
          remaining: dollars(budgets.remaining),
          unbudgeted_spending: dollars(budgets.unbudgeted),
        },
        top_spending_categories: categoryRows(spending.slice(0, 6)),
        upcoming_bills: upcoming.map((bill) => ({
          name: bill.name,
          amount: dollars(Math.abs(bill.amount_cents)),
          next_date: bill.next_date,
          cadence: bill.cadence,
        })),
        accounts: netWorth.accounts.length,
      };
    },
  },
  {
    name: 'get_spending',
    description:
      'Spending over a date range, broken down by category, merchant, or month. Use this to answer questions like "how much did I spend on dining last month".',
    schema: {
      type: 'object',
      properties: {
        start_date: { type: 'string', description: 'Start date YYYY-MM-DD. Defaults to the first of the current month.' },
        end_date: { type: 'string', description: 'End date YYYY-MM-DD. Defaults to today.' },
        category: { type: 'string', description: 'Optional category name filter, e.g. "Dining & Coffee".' },
        group_by: {
          type: 'string',
          enum: ['category', 'merchant', 'month'],
          description: 'How to break down the results. Defaults to category.',
        },
      },
      required: [],
    },
    handler: (args) => {
      const { start, end } = resolveRange(args);
      const groupBy = args.group_by || 'category';
      const category = findCategory(args.category);

      if (groupBy === 'merchant') {
        const items = topMerchants(start, end, MAX_LIMIT)
          .filter((row) => !args.category || row.merchant.toLowerCase().includes(String(args.category).toLowerCase()))
          .map((row) => ({ merchant: row.merchant, amount: dollars(row.total), transactions: row.count }));
        return {
          currency: currency(),
          start_date: start,
          end_date: end,
          total: dollars(items.reduce((sum, row) => sum + row.amount * 100, 0)),
          merchants: items,
        };
      }

      if (groupBy === 'month') {
        const months = lastMonths(24).filter((month) => {
          const { start: monthStart, end: monthEnd } = monthRange(month);
          return monthEnd >= start && monthStart <= end;
        });
        const rows = months.map((month) => {
          const { start: monthStart, end: monthEnd } = monthRange(month);
          const rowsForMonth = spendingByCategory(monthStart, monthEnd);
          const total = category
            ? (rowsForMonth.find((row) => row.name.toLowerCase() === category.name.toLowerCase())?.total ?? 0)
            : rowsForMonth.reduce((sum, row) => sum + row.total, 0);
          return { month, amount: dollars(total) };
        });
        return { currency: currency(), start_date: start, end_date: end, months: rows };
      }

      const summary = spendingRangeSummary(start, end);
      const rows = category
        ? summary.categories.filter((row) => row.categoryId === category.id)
        : summary.categories;
      return {
        currency: currency(),
        start_date: start,
        end_date: end,
        total: dollars(rows.reduce((sum, row) => sum + row.total, 0)),
        average_per_day: dollars(Math.round((rows.reduce((sum, row) => sum + row.total, 0)) / summary.days)),
        categories: categoryRows(rows),
      };
    },
  },
  {
    name: 'list_transactions',
    description: 'Search individual transactions with filters. Amounts are positive for money in and negative for money out.',
    schema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Text to match in description, merchant or notes.' },
        start_date: { type: 'string', description: 'YYYY-MM-DD' },
        end_date: { type: 'string', description: 'YYYY-MM-DD' },
        category: { type: 'string', description: 'Category name filter.' },
        account: { type: 'string', description: 'Account name filter.' },
        limit: { type: 'integer', description: 'Max rows, default 25, max 100.' },
      },
      required: [],
    },
    handler: (args) => {
      const category = findCategory(args.category);
      const accounts = listAccounts();
      const account = args.account
        ? accounts.find((row) => row.name.toLowerCase().includes(String(args.account).toLowerCase()))
        : null;
      const result = queryTransactions({
        search: args.search || '',
        categoryId: category?.id || null,
        accountId: account?.id || null,
        from: isISODate(args.start_date) ? args.start_date : null,
        to: isISODate(args.end_date) ? args.end_date : null,
        limit: Math.min(Number(args.limit) || 25, MAX_LIMIT),
        page: 1,
      });
      return {
        currency: currency(),
        count: result.total,
        total_outflow: dollars(result.outflow),
        total_inflow: dollars(result.inflow),
        transactions: result.items.map((tx) => ({
          date: tx.date,
          description: tx.name,
          merchant: tx.merchant_name || undefined,
          amount: dollars(tx.amount_cents),
          category: tx.category_name || 'Uncategorized',
          account: tx.account_name,
          pending: Boolean(tx.pending),
        })),
      };
    },
  },
  {
    name: 'get_budget_status',
    description: 'Budget progress by category for a month, including spent, remaining and percent used.',
    schema: {
      type: 'object',
      properties: {
        month: { type: 'string', description: 'Month as YYYY-MM. Defaults to the current month.' },
      },
      required: [],
    },
    handler: (args) => {
      const month = resolveMonth(args.month);
      const status = budgetStatus(month);
      return {
        currency: currency(),
        month,
        total_budget: dollars(status.totalBudget),
        total_spent: dollars(status.totalSpent),
        remaining: dollars(status.remaining),
        unbudgeted_spending: dollars(status.unbudgeted),
        categories: status.rows.map((row) => ({
          category: row.name,
          budget: dollars(row.budget),
          spent: dollars(row.spent),
          remaining: dollars(row.remaining),
          percent_used: row.percent != null ? Math.round(row.percent * 1000) / 10 : null,
          over_budget: row.budget > 0 && row.spent > row.budget,
        })),
      };
    },
  },
  {
    name: 'get_cashflow',
    description: 'Monthly income, spending and net cash flow for the last N months.',
    schema: {
      type: 'object',
      properties: {
        months: { type: 'integer', description: 'Number of months, 1-36. Default 6.' },
      },
      required: [],
    },
    handler: (args) => {
      const months = Math.min(Math.max(Number(args.months) || 6, 1), 36);
      const series = cashflowSeries(months);
      return {
        currency: currency(),
        months: series.map((row) => ({
          month: row.month,
          income: dollars(row.income),
          spending: dollars(row.spending),
          net: dollars(row.net),
        })),
        total_net: dollars(series.reduce((sum, row) => sum + row.net, 0)),
      };
    },
  },
  {
    name: 'get_net_worth',
    description: 'Current net worth plus its monthly history and the accounts that make it up.',
    schema: {
      type: 'object',
      properties: {
        months: { type: 'integer', description: 'Months of history, default 12, max 36.' },
      },
      required: [],
    },
    handler: (args) => {
      const months = Math.min(Math.max(Number(args.months) || 12, 1), 36);
      const summary = netWorthSummary();
      return {
        currency: currency(),
        net_worth: dollars(summary.net),
        assets: dollars(summary.assets),
        liabilities: dollars(summary.liabilities),
        history: netWorthSeries(months).map((row) => ({
          date: row.date,
          net_worth: dollars(row.net),
          assets: dollars(row.assets),
          liabilities: dollars(row.liabilities),
        })),
        accounts: summary.accounts
          .filter((account) => account.include_in_networth)
          .map((account) => ({
            name: account.name,
            type: account.type,
            balance: dollars(account.balance_cents),
            institution: account.institution || undefined,
          })),
      };
    },
  },
  {
    name: 'get_recurring_bills',
    description: 'Detected recurring bills and subscriptions with amounts, cadence and next due date.',
    schema: { type: 'object', properties: {}, required: [] },
    handler: () => ({
      currency: currency(),
      bills: listRecurring({ includeDismissed: false }).map((row) => ({
        name: row.name,
        amount: dollars(Math.abs(row.amount_cents)),
        cadence: row.cadence,
        next_date: row.next_date,
        days_until: row.daysUntil,
        monthly_equivalent: dollars(Math.abs(row.monthlyEquivalent)),
        category: row.category_name || 'Uncategorized',
        confidence: row.confidence,
      })),
    }),
  },
  {
    name: 'get_investments',
    description: 'Investment holdings, portfolio value, cost basis, unrealized gain and allocation.',
    schema: { type: 'object', properties: {}, required: [] },
    handler: () => {
      const summary = investmentSummary();
      return {
        currency: currency(),
        total_value: dollars(summary.totalValue),
        total_cost_basis: dollars(summary.totalCost),
        unrealized_gain: dollars(summary.gain),
        gain_percent: summary.gainPercent != null ? Math.round(summary.gainPercent * 1000) / 10 : null,
        allocation: summary.allocation.map((row) => ({
          type: row.type,
          value: dollars(row.value),
          percent: summary.totalValue > 0 ? Math.round((row.value / summary.totalValue) * 1000) / 10 : 0,
        })),
        holdings: summary.holdings.map((row) => ({
          ticker: row.ticker || undefined,
          name: row.name,
          account: row.account_name,
          quantity: row.quantity,
          price: dollars(row.price_cents),
          value: dollars(row.value_cents),
          cost_basis: row.cost_basis_cents != null ? dollars(row.cost_basis_cents) : null,
        })),
      };
    },
  },
  {
    name: 'get_income',
    description: 'Income received over a date range, grouped by income category.',
    schema: {
      type: 'object',
      properties: {
        start_date: { type: 'string', description: 'YYYY-MM-DD, defaults to the first of the current month.' },
        end_date: { type: 'string', description: 'YYYY-MM-DD, defaults to today.' },
      },
      required: [],
    },
    handler: (args) => {
      const { start, end } = resolveRange(args);
      const rows = incomeByCategory(start, end);
      return {
        currency: currency(),
        start_date: start,
        end_date: end,
        total: dollars(rows.reduce((sum, row) => sum + row.total, 0)),
        categories: rows.map((row) => ({
          category: row.name,
          amount: dollars(row.total),
          transactions: row.count,
        })),
      };
    },
  },
  {
    name: 'get_accounts',
    description: 'List all accounts with balances, type, institution and last four digits.',
    schema: { type: 'object', properties: {}, required: [] },
    handler: () => ({
      currency: currency(),
      accounts: listAccounts().map((account) => ({
        name: account.name,
        type: account.type,
        institution: account.institution || undefined,
        mask: account.mask || undefined,
        balance: dollars(account.balance_cents),
        available: account.available_cents != null ? dollars(account.available_cents) : undefined,
        included_in_net_worth: Boolean(account.include_in_networth),
      })),
    }),
  },
  {
    name: 'list_categories',
    description: 'List the available transaction categories and their type (expense, income or transfer).',
    schema: { type: 'object', properties: {}, required: [] },
    handler: () => ({
      categories: db
        .prepare('SELECT name, kind FROM categories ORDER BY kind, name')
        .all()
        .map((row) => ({ name: row.name, type: row.kind })),
    }),
  },
];

function normalizeArguments(schema, args) {
  const output = {};
  if (!args || typeof args !== 'object' || Array.isArray(args)) args = {};
  const properties = schema.properties || {};
  for (const [key, definition] of Object.entries(properties)) {
    let value = args[key];
    if (value === undefined || value === null || value === '') continue;
    if (definition.type === 'integer' || definition.type === 'number') {
      const number = Number(value);
      if (!Number.isFinite(number)) throw new Error(`"${key}" must be a number`);
      value = definition.type === 'integer' ? Math.round(number) : number;
    }
    if (definition.type === 'boolean') value = Boolean(value);
    if (definition.type === 'string' && typeof value !== 'string') value = String(value).slice(0, 400);
    if (definition.enum && !definition.enum.includes(value)) {
      throw new Error(`"${key}" must be one of: ${definition.enum.join(', ')}`);
    }
    output[key] = value;
  }
  for (const required of schema.required || []) {
    if (output[required] === undefined) throw new Error(`Missing required argument "${required}"`);
  }
  return output;
}

export async function runTool(name, args) {
  const tool = tools.find((entry) => entry.name === name);
  if (!tool) throw new Error(`Unknown tool "${name}"`);
  try {
    const normalized = normalizeArguments(tool.schema, args);
    return await tool.handler(normalized);
  } catch (error) {
    return { error: error.message };
  }
}

export function toolDescriptors() {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.schema,
  }));
}

export function openAiTools() {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.schema,
    },
  }));
}
