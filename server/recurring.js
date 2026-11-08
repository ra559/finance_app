import { db } from './db.js';
import { addDays, daysBetween, median, merchantKey, nowISO, todayISO } from './util.js';

const CADENCES = [
  { name: 'weekly', days: 7, tolerance: 3 },
  { name: 'biweekly', days: 14, tolerance: 4 },
  { name: 'monthly', days: 30, tolerance: 6 },
  { name: 'quarterly', days: 91, tolerance: 12 },
  { name: 'yearly', days: 365, tolerance: 25 },
];

function cadenceFor(interval) {
  for (const cadence of CADENCES) {
    if (Math.abs(interval - cadence.days) <= cadence.tolerance) return cadence;
  }
  return null;
}

function nextOccurrence(lastDate, interval, today) {
  let next = addDays(lastDate, interval);
  let guard = 0;
  while (next < today && guard < 240) {
    next = addDays(next, interval);
    guard += 1;
  }
  return next;
}

export function detectRecurring() {
  const today = todayISO();
  const rows = db
    .prepare(
      `SELECT t.id, t.name, t.merchant_name, t.amount_cents, t.date, t.account_id, t.category_id
       FROM transactions t JOIN accounts a ON a.id = t.account_id
       WHERE t.amount_cents < 0 AND t.pending = 0 AND t.excluded = 0 AND a.archived = 0
         AND t.date >= date('now', '-420 day')
       ORDER BY t.date ASC`,
    )
    .all();

  const groups = new Map();
  for (const row of rows) {
    const key = merchantKey(row.name, row.merchant_name);
    if (!key || key.length < 3) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const detected = [];
  for (const [key, items] of groups.entries()) {
    if (items.length < 3) continue;
    const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date));
    const gaps = [];
    for (let index = 1; index < sorted.length; index += 1) {
      gaps.push(daysBetween(sorted[index - 1].date, sorted[index].date));
    }
    const positiveGaps = gaps.filter((gap) => gap > 0);
    if (positiveGaps.length < 2) continue;
    const medianGap = median(positiveGaps);
    const cadence = cadenceFor(medianGap);
    if (!cadence) continue;

    const consistentGaps = positiveGaps.filter((gap) => Math.abs(gap - medianGap) <= cadence.tolerance).length;
    const regularity = consistentGaps / positiveGaps.length;
    if (regularity < 0.75) continue;

    const amounts = sorted.map((row) => Math.abs(row.amount_cents));
    const medianAmount = median(amounts);
    if (medianAmount < 100) continue;
    const stableAmounts = amounts.filter((amount) => Math.abs(amount - medianAmount) / medianAmount <= 0.35).length;
    const amountStability = stableAmounts / amounts.length;

    const countFactor = Math.min(sorted.length / 6, 1);
    const confidence = Math.round((regularity * 0.5 + amountStability * 0.3 + countFactor * 0.2) * 100) / 100;
    if (confidence < 0.62) continue;

    // Use the most common display name and the latest values for category.
    const mostRecent = sorted[sorted.length - 1];
    const displayName = mostRecent.merchant_name || mostRecent.name;
    const nextDate = nextOccurrence(sorted[sorted.length - 1].date, medianGap, today);

    detected.push({
      key,
      name: displayName,
      categoryId: mostRecent.category_id,
      accountId: mostRecent.account_id,
      amountCents: -medianAmount,
      cadence: cadence.name,
      intervalDays: Math.round(medianGap),
      lastDate: sorted[sorted.length - 1].date,
      nextDate,
      occurrences: sorted.length,
      confidence,
    });
  }

  const existing = db.prepare('SELECT merchant_key, status FROM recurring').all();
  const statusMap = new Map(existing.map((row) => [row.merchant_key, row.status]));
  const detectedKeys = new Set(detected.map((row) => row.key));

  const upsert = db.prepare(
    `INSERT INTO recurring (merchant_key, name, category_id, account_id, amount_cents, cadence, interval_days,
                            last_date, next_date, occurrences, confidence, status, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(merchant_key) DO UPDATE SET
       name = excluded.name, category_id = excluded.category_id, account_id = excluded.account_id,
       amount_cents = excluded.amount_cents, cadence = excluded.cadence, interval_days = excluded.interval_days,
       last_date = excluded.last_date, next_date = excluded.next_date, occurrences = excluded.occurrences,
       confidence = excluded.confidence, updated_at = excluded.updated_at`,
  );

  const run = db.transaction(() => {
    for (const row of detected) {
      upsert.run(
        row.key,
        row.name,
        row.categoryId,
        row.accountId,
        row.amountCents,
        row.cadence,
        row.intervalDays,
        row.lastDate,
        row.nextDate,
        row.occurrences,
        row.confidence,
        statusMap.get(row.key) || 'active',
        nowISO(),
      );
    }
    // Drop auto-detected rows that no longer look recurring, keep dismissed ones.
    for (const [key, status] of statusMap.entries()) {
      if (!detectedKeys.has(key) && status !== 'dismissed') {
        db.prepare('DELETE FROM recurring WHERE merchant_key = ?').run(key);
      }
    }
  });
  run();

  return listRecurring();
}

export function listRecurring({ includeDismissed = true } = {}) {
  const where = includeDismissed ? '' : "WHERE r.status = 'active'";
  const rows = db
    .prepare(
      `SELECT r.*, c.name AS category_name, c.color AS category_color, a.name AS account_name
       FROM recurring r
       LEFT JOIN categories c ON c.id = r.category_id
       LEFT JOIN accounts a ON a.id = r.account_id
       ${where} ORDER BY r.status = 'dismissed', r.next_date ASC`,
    )
    .all();
  const today = todayISO();
  return rows.map((row) => ({
    ...row,
    daysUntil: daysBetween(today, row.next_date),
    monthlyEquivalent:
      row.cadence === 'weekly'
        ? Math.round((row.amount_cents * 52) / 12)
        : row.cadence === 'biweekly'
          ? Math.round((row.amount_cents * 26) / 12)
          : row.cadence === 'quarterly'
            ? Math.round(row.amount_cents / 3)
            : row.cadence === 'yearly'
              ? Math.round(row.amount_cents / 12)
              : row.amount_cents,
  }));
}

export function setRecurringStatus(id, status) {
  db.prepare('UPDATE recurring SET status = ?, updated_at = ? WHERE id = ?').run(status, nowISO(), id);
}
