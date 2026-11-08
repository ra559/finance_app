const MINUS = '−';

function currencyFormatter(currency, { compact = false, decimals } = {}) {
  const options = {
    style: 'currency',
    currency: currency || 'USD',
    currencyDisplay: 'narrowSymbol',
    notation: compact ? 'compact' : 'standard',
    maximumFractionDigits: decimals ?? (compact ? 1 : 2),
    minimumFractionDigits: decimals ?? (compact ? 0 : 2),
  };
  try {
    return new Intl.NumberFormat('en-US', options);
  } catch {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  }
}

export function formatMoney(cents, currency = 'USD', options = {}) {
  const value = (Number(cents) || 0) / 100;
  const formatted = currencyFormatter(currency, options).format(Math.abs(value));
  if (value < 0) return `${MINUS}${formatted}`;
  return options.alwaysSign ? `+${formatted}` : formatted;
}

export function formatNumber(value, options = {}) {
  return new Intl.NumberFormat('en-US', options).format(Number(value) || 0);
}

export function formatPercent(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return `${(Number(value) * 100).toFixed(digits)}%`;
}

export function parseMoneyInput(value) {
  const number = Number.parseFloat(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
}

export function formatDate(iso, { includeYear = true, short = false } = {}) {
  if (!iso) return '—';
  const date = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-US', {
    month: short ? 'short' : 'long',
    day: 'numeric',
    ...(includeYear ? { year: 'numeric' } : {}),
  });
}

export function formatShortDate(iso) {
  if (!iso) return '—';
  const date = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function shiftMonth(month, delta) {
  const [year, mon] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, mon - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function monthLabel(month, { short = false } = {}) {
  if (!month) return '';
  const [year, mon] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, mon - 1, 1));
  return date.toLocaleDateString('en-US', {
    month: short ? 'short' : 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function monthShort(month) {
  if (!month) return '';
  const [year, mon] = month.split('-').map(Number);
  return new Date(Date.UTC(year, mon - 1, 1)).toLocaleDateString('en-US', {
    month: 'short',
    timeZone: 'UTC',
  });
}

export function todayISO() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export const cadenceLabels = {
  weekly: 'Weekly',
  biweekly: 'Every 2 weeks',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
};

export function cv(value) {
  return value ? 'true' : 'false';
}

export function initials(name = '', email = '') {
  const source = name.trim() || email;
  if (!source) return 'C';
  const parts = source.split(/\s+/);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : source.slice(0, 2)).toUpperCase();
}

export function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}
