import crypto from 'node:crypto';

export const nowISO = () => new Date().toISOString();

export function localISO(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export const todayISO = () => localISO();
export const currentMonth = () => todayISO().slice(0, 7);

export const isISODate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
export const isMonth = (value) => typeof value === 'string' && /^\d{4}-\d{2}$/.test(value);

export function monthRange(month) {
  const [year, mon] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  return {
    start: `${month}-01`,
    end: `${month}-${String(lastDay).padStart(2, '0')}`,
    lastDay,
  };
}

export function addMonths(month, delta) {
  const [year, mon] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, mon - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function lastMonths(count, endMonth = currentMonth()) {
  const months = [];
  for (let i = count - 1; i >= 0; i -= 1) months.push(addMonths(endMonth, -i));
  return months;
}

export function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function daysBetween(a, b) {
  const first = Date.parse(`${a}T12:00:00Z`);
  const second = Date.parse(`${b}T12:00:00Z`);
  return Math.round((second - first) / 86_400_000);
}

export function parseAmountToCents(input) {
  if (input === null || input === undefined) return null;
  let text = String(input).trim();
  if (!text) return null;
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  text = text.replace(/[^0-9.,\-+]/g, '');
  if (text.startsWith('-')) {
    negative = true;
    text = text.slice(1);
  }
  text = text.replace(/\+/g, '');
  if (text.includes(',') && text.includes('.')) text = text.replace(/,/g, '');
  else if (text.includes(',') && !text.includes('.')) text = text.replace(/,/g, '.');
  if (!text) return null;
  const value = Number.parseFloat(text);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100) * (negative ? -1 : 1);
}

export function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[’']/g, '')
    .replace(/\b(pos|debit|credit card purchase|purchase|payment|pymt|ach|ppd|web|tel|checkcard|visa|mastercard|amex|recur|autopay)\b/g, ' ')
    .replace(/\b(sq|tst|sp|pp|paypal|stripe)\s*\*/g, ' ')
    .replace(/[^a-z0-9.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function merchantKey(name, merchantName) {
  const source = merchantName && String(merchantName).trim() ? merchantName : name;
  return normalizeText(source)
    .replace(/\b\d{4,}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 6)
    .join(' ');
}

export function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

export function toInt(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function titleCase(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/(^|\s|-)\w/g, (match) => match.toUpperCase());
}

export function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
