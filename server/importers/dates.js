const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function pad(value) {
  return String(value).padStart(2, '0');
}

/** Parse a date cell from a bank CSV into YYYY-MM-DD. */
export function parseDateToISO(input, format = 'auto') {
  if (!input) return null;
  const text = String(input).trim();
  if (!text) return null;

  // ISO first: 2025-01-31 or 2025/01/31
  const iso = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return valid(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  // Compact 20250131
  const compact = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return valid(Number(compact[1]), Number(compact[2]), Number(compact[3]));

  // Slash or dot separated, with 2- or 4-digit year
  const split = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (split) {
    let first = Number(split[1]);
    let second = Number(split[2]);
    let year = Number(split[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    if (format === 'DD/MM/YYYY') return valid(year, second, first);
    if (format === 'MM/DD/YYYY') return valid(year, first, second);
    // Auto: if the first part cannot be a month, it must be a day.
    if (first > 12) return valid(year, second, first);
    return valid(year, first, second);
  }

  // Textual month: "Jan 5, 2025", "5 Jan 2025"
  const lower = text.toLowerCase();
  const monthIndex = MONTHS.findIndex((month) => lower.includes(month));
  if (monthIndex !== -1) {
    const yearMatch = text.match(/\b(19|20)\d{2}\b/);
    const numbers = text.match(/\b\d{1,2}\b/g) || [];
    const year = yearMatch ? Number(yearMatch[0]) : new Date().getFullYear();
    const day = numbers.map(Number).find((value) => value >= 1 && value <= 31 && value !== year);
    if (day) return valid(year, monthIndex + 1, day);
  }

  const parsed = Date.parse(text);
  if (Number.isFinite(parsed)) {
    const date = new Date(parsed);
    return valid(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }
  return null;
}

function valid(year, month, day) {
  if (!year || !month || !day) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1) return null;
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}
