import { db } from './db.js';
import { PLAID_CATEGORY_MAP } from './seed-data.js';
import { merchantKey, normalizeText, nowISO } from './util.js';

let ruleCache = null;

export function invalidateRuleCache() {
  ruleCache = null;
}

function loadRules() {
  if (!ruleCache) {
    ruleCache = db
      .prepare(
        `SELECT r.*, c.name AS category_name FROM rules r
         JOIN categories c ON c.id = r.category_id
         ORDER BY r.priority ASC, r.id ASC`,
      )
      .all();
  }
  return ruleCache;
}

export function getCategoryIdByName(name) {
  if (!name) return null;
  const row = db.prepare('SELECT id FROM categories WHERE lower(name) = lower(?)').get(name);
  return row ? row.id : null;
}

export function plaidCategoryToId(raw) {
  if (!raw) return null;
  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { detailed: raw };
    }
  }
  const detailed = parsed?.detailed || '';
  const primary = parsed?.primary || '';
  const name = PLAID_CATEGORY_MAP[detailed] || PLAID_CATEGORY_MAP[primary];
  return getCategoryIdByName(name);
}

function ruleMatches(rule, text, merchantText) {
  const fieldText =
    rule.field === 'merchant' ? merchantText : rule.field === 'description' ? text : `${text} ${merchantText}`;
  const pattern = rule.pattern;
  if (rule.match_type === 'regex') {
    try {
      return new RegExp(pattern, 'i').test(fieldText);
    } catch {
      return false;
    }
  }
  const normalizedPattern = normalizeText(pattern);
  if (!normalizedPattern) return false;
  if (rule.match_type === 'exact') {
    return fieldText === normalizedPattern;
  }
  return fieldText.includes(normalizedPattern);
}

/**
 * Decide a category for one transaction-like object.
 * @param {{name?: string, merchant_name?: string, merchant?: string, plaidCategory?: string|object}} input
 */
export function categorize(input) {
  const name = input.name || '';
  const merchant = input.merchant_name || input.merchant || '';
  const text = normalizeText(`${name} ${merchant}`);
  const merchantText = normalizeText(merchant);
  const key = merchantKey(name, merchant);

  if (key) {
    const learned = db.prepare('SELECT category_id FROM merchants WHERE key = ?').get(key);
    if (learned?.category_id) return { categoryId: learned.category_id, source: 'merchant' };
  }

  for (const rule of loadRules()) {
    if (ruleMatches(rule, text, merchantText)) {
      return { categoryId: rule.category_id, source: 'rule' };
    }
  }

  const plaidId = plaidCategoryToId(input.plaidCategory);
  if (plaidId) return { categoryId: plaidId, source: 'plaid' };

  return { categoryId: null, source: 'uncategorized' };
}

export function learnMerchant(name, merchant, categoryId) {
  const key = merchantKey(name, merchant);
  if (!key || !categoryId) return;
  db.prepare(
    `INSERT INTO merchants (key, display_name, category_id, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET category_id = excluded.category_id, updated_at = excluded.updated_at`,
  ).run(key, merchant || name, categoryId, nowISO());
}

export function forgetMerchant(name, merchant) {
  const key = merchantKey(name, merchant);
  if (!key) return;
  db.prepare('DELETE FROM merchants WHERE key = ?').run(key);
}

/**
 * Re-run categorization for transactions that were not categorized manually.
 * Used after a rule is added or removed.
 */
export function recategorizeAutomatically() {
  const rows = db
    .prepare(
      `SELECT id, name, merchant_name, raw FROM transactions
       WHERE category_source IS NULL OR category_source IN ('rule', 'plaid', 'merchant')`,
    )
    .all();
  const update = db.prepare('UPDATE transactions SET category_id = ?, category_source = ?, updated_at = ? WHERE id = ?');
  const run = db.transaction(() => {
    for (const row of rows) {
      let plaidCategory = null;
      if (row.raw) {
        try {
          plaidCategory = JSON.parse(row.raw)?.personal_finance_category || null;
        } catch {
          plaidCategory = null;
        }
      }
      const result = categorize({ name: row.name, merchant_name: row.merchant_name, plaidCategory });
      update.run(result.categoryId, result.source, nowISO(), row.id);
    }
  });
  run();
  invalidateRuleCache();
  return rows.length;
}

export function applyCategoryToSimilar(name, merchant, categoryId, source = 'manual') {
  const key = merchantKey(name, merchant);
  if (!key) return 0;
  const rows = db
    .prepare(`SELECT id, name, merchant_name FROM transactions WHERE category_id IS NULL OR category_source != 'manual'`)
    .all();
  const update = db.prepare('UPDATE transactions SET category_id = ?, category_source = ?, updated_at = ? WHERE id = ?');
  let changed = 0;
  for (const row of rows) {
    if (merchantKey(row.name, row.merchant_name) === key) {
      update.run(categoryId, source, nowISO(), row.id);
      changed += 1;
    }
  }
  return changed;
}
