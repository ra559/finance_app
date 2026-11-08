import { parseCSV, guessMapping } from './csv.js';
import { parseOFX } from './ofx.js';
import { parseDateToISO } from './dates.js';
import { db } from '../db.js';
import { categorize, learnMerchant } from '../categorize.js';
import { normalizeText, nowISO, parseAmountToCents, sha256 } from '../util.js';

function insertTransaction(row) {
  return db
    .prepare(
      `INSERT INTO transactions
        (account_id, date, name, merchant_name, amount_cents, currency, category_id, category_source,
         pending, excluded, notes, dedupe_key, raw, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?)`,
    )
    .run(
      row.accountId,
      row.date,
      row.name,
      row.merchantName || null,
      row.amountCents,
      row.currency || 'USD',
      row.categoryId,
      row.categorySource,
      row.notes || null,
      row.dedupeKey,
      row.raw ? JSON.stringify(row.raw) : null,
      nowISO(),
    );
}

/**
 * Import normalized transactions. Duplicate rows are skipped using a
 * deterministic key, so re-importing the same statement is safe.
 */
export function importTransactions(accountId, transactions, { filename = '', format = 'csv' } = {}) {
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
  if (!account) throw new Error('Account not found');

  const findExisting = db.prepare('SELECT 1 FROM transactions WHERE dedupe_key = ?');
  const keysSeen = new Map();
  let imported = 0;
  let duplicates = 0;
  const errors = [];

  const run = db.transaction(() => {
    for (const [index, tx] of transactions.entries()) {
      try {
        if (!tx.date || !/^\d{4}-\d{2}-\d{2}$/.test(tx.date)) {
          errors.push(`Row ${index + 1}: invalid date`);
          continue;
        }
        if (!Number.isFinite(tx.amountCents) || tx.amountCents === 0) {
          errors.push(`Row ${index + 1}: invalid amount`);
          continue;
        }

        const base =
          tx.dedupeKey ||
          `csv:${accountId}:${tx.date}:${tx.amountCents}:${sha256(normalizeText(tx.name)).slice(0, 12)}`;
        const sequence = keysSeen.get(base) || 0;
        keysSeen.set(base, sequence + 1);
        const dedupeKey = `${base}#${sequence}`;

        if (findExisting.get(dedupeKey)) {
          duplicates += 1;
          continue;
        }

        const result = categorize({
          name: tx.name,
          merchant_name: tx.merchantName,
          plaidCategory: tx.plaidCategory,
        });
        let categoryId = result.categoryId;
        let categorySource = result.source;
        if (!categoryId && tx.categoryName) {
          const named = db
            .prepare('SELECT id FROM categories WHERE lower(name) = lower(?)')
            .get(String(tx.categoryName).trim());
          if (named) {
            categoryId = named.id;
            categorySource = 'imported';
          }
        }

        insertTransaction({
          accountId,
          date: tx.date,
          name: tx.name || 'Imported transaction',
          merchantName: tx.merchantName,
          amountCents: tx.amountCents,
          currency: tx.currency || account.currency,
          categoryId,
          categorySource,
          notes: tx.notes,
          dedupeKey,
          raw: tx.raw,
        });
        imported += 1;
      } catch (error) {
        errors.push(`Row ${index + 1}: ${error.message}`);
      }
    }

    db.prepare(
      'INSERT INTO import_batches (filename, format, imported, duplicates, failed, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(filename, format, imported, duplicates, errors.length, nowISO());
  });
  run();

  return { imported, duplicates, failed: errors.length, errors: errors.slice(0, 25), accountName: account.name };
}

export function previewCsv(content) {
  const parsed = parseCSV(content);
  const mapping = guessMapping(parsed.headers);
  return {
    headers: parsed.headers,
    delimiter: parsed.delimiter,
    totalRows: parsed.rows.length,
    sample: parsed.rows.slice(0, 6),
    mapping,
    amountModes: ['signed', 'debit_credit', 'positive_expense'],
  };
}

export function importCsv(accountId, content, mapping, filename = '') {
  const parsed = parseCSV(content);
  if (!parsed.headers.length) throw new Error('Could not find a header row in this CSV file');
  const { amountMode = 'signed', dateFormat = 'auto' } = mapping || {};

  const transactions = [];
  for (const row of parsed.rows) {
    const get = (column) => (column ? row[parsed.headers.indexOf(column)] ?? '' : '');
    const date = parseDateToISO(get(mapping.date), dateFormat);
    if (!date) continue;

    let amountCents = 0;
    if (amountMode === 'debit_credit') {
      const debit = parseAmountToCents(get(mapping.debit));
      const credit = parseAmountToCents(get(mapping.credit));
      if (debit) amountCents = -Math.abs(debit);
      else if (credit) amountCents = Math.abs(credit);
    } else {
      const parsedAmount = parseAmountToCents(get(mapping.amount));
      if (parsedAmount === null) continue;
      amountCents = amountMode === 'positive_expense' ? -Math.abs(parsedAmount) : parsedAmount;
    }
    if (!amountCents) continue;

    const name = String(get(mapping.description) || get(mapping.merchant) || 'Imported transaction').trim();
    transactions.push({
      date,
      name,
      merchantName: mapping.merchant ? String(get(mapping.merchant)).trim() : '',
      amountCents,
      categoryName: mapping.category ? String(get(mapping.category)).trim() : '',
      notes: mapping.notes ? String(get(mapping.notes)).trim() : '',
      currency: 'USD',
    });
  }

  if (!transactions.length) throw new Error('No valid rows found. Check the column mapping and amount mode.');
  return importTransactions(accountId, transactions, { filename, format: 'csv' });
}

export function importOfx(accountId, content, filename = '') {
  const parsed = parseOFX(content);
  const account = db.prepare('SELECT currency FROM accounts WHERE id = ?').get(accountId);
  const transactions = parsed.transactions.map((tx) => ({
    date: tx.date,
    name: tx.name,
    merchantName: tx.merchantName,
    amountCents: tx.amountCents,
    notes: tx.memo,
    currency: parsed.currency || account?.currency || 'USD',
    dedupeKey: `ofx:${accountId}:${
      tx.fitid || sha256(`${tx.date}:${tx.amountCents}:${tx.name}`).slice(0, 16)
    }`,
    raw: tx.raw,
  }));
  const result = importTransactions(accountId, transactions, { filename, format: parsed.format });
  return { ...result, meta: parsed.meta, warnings: parsed.warnings };
}

export { guessMapping };

/** Second pass: learn merchant mappings from an import's new rows. */
export function autoCategorizeAfterImport(accountId) {
  const rows = db
    .prepare('SELECT id, name, merchant_name, category_id FROM transactions WHERE account_id = ? AND category_id IS NOT NULL')
    .all(accountId);
  for (const row of rows) {
    learnMerchant(row.name, row.merchant_name, row.category_id);
  }
}
