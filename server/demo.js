import { db, getCategoryByName } from './db.js';
import { addMonths, currentMonth, monthRange, nowISO, todayISO } from './util.js';
import { detectRecurring } from './recurring.js';

const DEMO_INSTITUTION = 'Cove Demo';

function rng(seed) {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = rng(20261108);
const between = (min, max) => min + random() * (max - min);
const centsBetween = (min, max) => Math.round(between(min, max)) * 100;
const pick = (items) => items[Math.floor(random() * items.length)];

const categoryId = (name) => getCategoryByName(name)?.id ?? null;

export function removeDemoData() {
  const accounts = db.prepare('SELECT id FROM accounts WHERE institution = ?').all(DEMO_INSTITUTION);
  if (!accounts.length) return { removed: 0 };
  const ids = accounts.map((row) => row.id);
  const placeholders = ids.map(() => '?').join(',');
  const run = db.transaction(() => {
    db.prepare(`DELETE FROM recurring WHERE account_id IN (${placeholders})`).run(...ids);
    db.prepare(`DELETE FROM accounts WHERE id IN (${placeholders})`).run(...ids);
  });
  run();
  return { removed: ids.length };
}

export function seedDemoData() {
  removeDemoData();

  const insertAccount = db.prepare(
    `INSERT INTO accounts (name, official_name, type, subtype, mask, institution, currency, balance_cents,
       available_cents, balance_updated_at, is_manual, include_in_networth, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'USD', ?, ?, ?, 1, 1, ?)`,
  );

  const checkingId = Number(
    insertAccount.run(
      'Everyday Checking',
      'Everyday Checking',
      'checking',
      'checking',
      '4412',
      DEMO_INSTITUTION,
      2_284_019,
      2_284_019,
      nowISO(),
      nowISO(),
    ).lastInsertRowid,
  );
  const savingsId = Number(
    insertAccount.run(
      'High-Yield Savings',
      'High-Yield Savings',
      'savings',
      'savings',
      '9087',
      DEMO_INSTITUTION,
      2_640_000,
      2_640_000,
      nowISO(),
      nowISO(),
    ).lastInsertRowid,
  );
  const creditId = Number(
    insertAccount.run(
      'Voyager Card',
      'Voyager Rewards Card',
      'credit',
      'credit card',
      '7731',
      DEMO_INSTITUTION,
      128_432,
      null,
      nowISO(),
      nowISO(),
    ).lastInsertRowid,
  );
  const brokerageId = Number(
    insertAccount.run(
      'Brokerage',
      'Self-directed Brokerage',
      'investment',
      'brokerage',
      '5520',
      DEMO_INSTITUTION,
      0,
      null,
      nowISO(),
      nowISO(),
    ).lastInsertRowid,
  );

  const insertTx = db.prepare(
    `INSERT INTO transactions
      (account_id, date, name, merchant_name, amount_cents, currency, category_id, category_source,
       pending, excluded, dedupe_key, created_at)
     VALUES (?, ?, ?, ?, ?, 'USD', ?, 'demo', 0, 0, ?, ?)`,
  );

  let counter = 0;
  const addTx = ({ accountId, date, name, merchant, cents, category }) => {
    if (date > todayISO()) return;
    counter += 1;
    insertTx.run(
      accountId,
      date,
      name,
      merchant || name,
      Math.round(cents),
      categoryId(category),
      `demo:${counter}`,
      nowISO(),
    );
  };

  const startMonth = addMonths(currentMonth(), -13);
  const months = [];
  let cursor = startMonth;
  while (cursor <= currentMonth()) {
    months.push(cursor);
    cursor = addMonths(cursor, 1);
  }

  const groceries = ["Whole Foods Market", "Trader Joe's", 'Safeway', 'Costco Wholesale'];
  const dining = ['Blue Bottle Coffee', 'Chipotle', 'DoorDash', 'Sweetgreen', 'Tartine Bakery'];
  const gasStations = ['Shell', 'Chevron'];
  const shops = ['Amazon', 'Target', 'Best Buy', 'IKEA'];
  const cardMerchants = ['Amazon', 'DoorDash', 'Target', 'Sweetgreen', 'Best Buy'];

  for (const [index, month] of months.entries()) {
    const { end } = monthRange(month);
    const day = (value) => `${month}-${String(value).padStart(2, '0')}`;

    addTx({ accountId: checkingId, date: day(1), name: 'Acme Corp Payroll', merchant: 'Acme Corp', cents: 395_000, category: 'Salary' });
    addTx({ accountId: checkingId, date: day(15), name: 'Acme Corp Payroll', merchant: 'Acme Corp', cents: 395_000, category: 'Salary' });
    addTx({ accountId: checkingId, date: day(1), name: 'Skyline Property Management Rent', merchant: 'Skyline Property Management', cents: -215_000, category: 'Housing' });
    addTx({ accountId: checkingId, date: day(5), name: 'Pacific Gas & Electric', merchant: 'Pacific Gas & Electric', cents: -centsBetween(95, 155), category: 'Utilities' });
    addTx({ accountId: checkingId, date: day(8), name: 'Comcast Internet', merchant: 'Comcast', cents: -7_999, category: 'Utilities' });
    addTx({ accountId: checkingId, date: day(12), name: 'T-Mobile', merchant: 'T-Mobile', cents: -6_500, category: 'Utilities' });
    addTx({ accountId: checkingId, date: day(20), name: 'Geico Auto Insurance', merchant: 'Geico', cents: -14_250, category: 'Insurance' });
    addTx({ accountId: checkingId, date: day(18), name: 'Netflix', merchant: 'Netflix', cents: -2_299, category: 'Subscriptions' });
    addTx({ accountId: checkingId, date: day(22), name: 'Spotify Premium', merchant: 'Spotify', cents: -1_199, category: 'Subscriptions' });
    addTx({ accountId: checkingId, date: day(3), name: 'Equinox Membership', merchant: 'Equinox', cents: -4_500, category: 'Health & Fitness' });
    addTx({ accountId: checkingId, date: day(28), name: 'Transfer to High-Yield Savings', merchant: 'Cove Transfer', cents: -75_000, category: 'Internal Transfer' });
    addTx({ accountId: savingsId, date: day(28), name: 'Transfer from Everyday Checking', merchant: 'Cove Transfer', cents: 75_000, category: 'Internal Transfer' });
    addTx({ accountId: checkingId, date: day(26), name: 'Voyager Card Payment', merchant: 'Voyager Card', cents: -110_000, category: 'Credit Card Payment' });
    addTx({ accountId: creditId, date: day(26), name: 'Payment Thank You', merchant: 'Voyager Card', cents: 110_000, category: 'Credit Card Payment' });
    addTx({ accountId: checkingId, date: day(27), name: 'Transfer to Brokerage', merchant: 'Cove Transfer', cents: -50_000, category: 'Investments' });
    addTx({ accountId: savingsId, date: end, name: 'Monthly Interest', merchant: 'Cove Bank', cents: centsBetween(62, 88), category: 'Interest & Dividends' });

    for (let i = 0; i < 5; i += 1) {
      const groceryDay = Math.min(2 + Math.floor(between(0, 26)), 28);
      addTx({ accountId: checkingId, date: day(groceryDay), name: pick(groceries), cents: -centsBetween(38, 165), category: 'Groceries' });
    }
    for (let i = 0; i < 7; i += 1) {
      const diningDay = Math.min(1 + Math.floor(between(0, 27)), 28);
      const isCoffee = random() > 0.55;
      addTx({
        accountId: checkingId,
        date: day(diningDay),
        name: isCoffee ? 'Blue Bottle Coffee' : pick(dining),
        cents: -centsBetween(isCoffee ? 5 : 14, isCoffee ? 11 : 62),
        category: 'Dining & Coffee',
      });
    }
    for (let i = 0; i < 3; i += 1) {
      addTx({
        accountId: checkingId,
        date: day(Math.min(4 + Math.floor(between(0, 24)), 28)),
        name: pick(gasStations),
        cents: -centsBetween(38, 72),
        category: 'Transportation',
      });
    }
    for (let i = 0; i < 3; i += 1) {
      addTx({
        accountId: creditId,
        date: day(Math.min(2 + Math.floor(between(0, 26)), 28)),
        name: pick(cardMerchants),
        cents: -centsBetween(18, 185),
        category: pick(['Shopping', 'Shopping', 'Dining & Coffee']),
      });
    }
    addTx({
      accountId: creditId,
      date: day(Math.min(9 + Math.floor(between(0, 15)), 28)),
      name: pick(shops),
      cents: -centsBetween(25, 220),
      category: 'Shopping',
    });
    if (index % 3 === 0) {
      addTx({ accountId: checkingId, date: day(16), name: 'CVS Pharmacy', merchant: 'CVS', cents: -centsBetween(12, 65), category: 'Health & Fitness' });
    }
    if (index % 4 === 1) {
      addTx({ accountId: creditId, date: day(21), name: 'AMC Theatres', cents: -centsBetween(18, 46), category: 'Entertainment' });
    }
    if (index === months.length - 5) {
      addTx({ accountId: creditId, date: day(12), name: 'Delta Air Lines', cents: -38_400, category: 'Travel' });
      addTx({ accountId: creditId, date: day(14), name: 'Airbnb', cents: -56_200, category: 'Travel' });
    }
    if (index === months.length - 10) {
      addTx({ accountId: creditId, date: day(7), name: 'Marriott', cents: -42_800, category: 'Travel' });
    }
  }

  const budgetAmounts = {
    Housing: 215_000,
    Groceries: 65_000,
    'Dining & Coffee': 45_000,
    Transportation: 20_000,
    Shopping: 30_000,
    Subscriptions: 4_000,
    Utilities: 20_000,
    'Health & Fitness': 12_000,
    Insurance: 15_000,
    Entertainment: 8_000,
    Travel: 20_000,
  };
  const upsertBudget = db.prepare(
    `INSERT INTO budgets (category_id, amount_cents, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(category_id) DO UPDATE SET amount_cents = excluded.amount_cents, updated_at = excluded.updated_at`,
  );
  for (const [name, amount] of Object.entries(budgetAmounts)) {
    const id = categoryId(name);
    if (id) upsertBudget.run(id, amount, nowISO());
  }

  const holdings = [
    { ticker: 'VTI', name: 'Vanguard Total Stock Market ETF', type: 'etf', quantity: 148, price: 285.4, cost: 3_200_000 },
    { ticker: 'VXUS', name: 'Vanguard Total International Stock ETF', type: 'etf', quantity: 90, price: 61.2, cost: 500_000 },
    { ticker: 'BND', name: 'Vanguard Total Bond Market ETF', type: 'etf', quantity: 40, price: 72.5, cost: 300_000 },
    { ticker: 'AAPL', name: 'Apple Inc.', type: 'equity', quantity: 18, price: 232.1, cost: 280_000 },
    { ticker: 'MSFT', name: 'Microsoft Corp.', type: 'equity', quantity: 15, price: 415.2, cost: 340_000 },
  ];
  const insertHolding = db.prepare(
    `INSERT INTO holdings (account_id, security_id, ticker, name, security_type, quantity, price_cents,
       value_cents, cost_basis_cents, currency, as_of)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'USD', ?)`,
  );
  let totalValue = 0;
  for (const holding of holdings) {
    const value = Math.round(holding.quantity * holding.price * 100);
    totalValue += value;
    insertHolding.run(
      brokerageId,
      `demo-${holding.ticker}`,
      holding.ticker,
      holding.name,
      holding.type,
      holding.quantity,
      Math.round(holding.price * 100),
      value,
      holding.cost,
      todayISO(),
    );
  }
  db.prepare('UPDATE accounts SET balance_cents = ?, balance_updated_at = ? WHERE id = ?').run(
    totalValue,
    nowISO(),
    brokerageId,
  );

  const insertSnapshot = db.prepare(
    `INSERT INTO balance_snapshots (account_id, date, balance_cents) VALUES (?, ?, ?)
     ON CONFLICT(account_id, date) DO UPDATE SET balance_cents = excluded.balance_cents`,
  );
  const snapshots = db.transaction(() => {
    const startPortfolio = Math.round(totalValue * 0.72);
    for (const [index, month] of months.entries()) {
      const last = index === months.length - 1;
      const progress = last ? 1 : (index + 1) / (months.length - 1);
      const trend = startPortfolio + (totalValue - startPortfolio) * progress;
      const noise = last ? 0 : Math.round(trend * between(-0.014, 0.014));
      const date = last ? todayISO() : monthRange(month).end;
      insertSnapshot.run(brokerageId, date, last ? totalValue : Math.max(trend + noise, 0));
      insertSnapshot.run(savingsId, date, 1_385_000 + index * 90_000);
    }
    insertSnapshot.run(savingsId, todayISO(), 2_640_000);
    insertSnapshot.run(checkingId, todayISO(), 2_284_019);
    insertSnapshot.run(creditId, todayISO(), 128_432);
  });
  snapshots();
  detectRecurring();

  return {
    accounts: 4,
    transactions: counter,
    budgets: Object.keys(budgetAmounts).length,
    holdings: holdings.length,
  };
}
