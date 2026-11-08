const FIELD_ALIASES = {
  date: [
    'date', 'transaction date', 'posted date', 'posting date', 'post date', 'booking date',
    'trans date', 'date posted', 'posted', 'value date',
  ],
  description: [
    'description', 'payee', 'name', 'details', 'memo', 'narrative', 'transaction',
    'transaction description', 'reference', 'particulars', 'original description',
  ],
  merchant: ['merchant', 'merchant name', 'payee name', 'counterparty', 'vendor'],
  amount: ['amount', 'transaction amount', 'value', 'amount (usd)', 'amount in usd'],
  debit: ['debit', 'withdrawal', 'withdrawals', 'money out', 'paid out', 'debit amount', 'outflow'],
  credit: ['credit', 'deposit', 'deposits', 'money in', 'paid in', 'credit amount', 'inflow'],
  category: ['category', 'categories', 'transaction category'],
  notes: ['notes', 'note', 'comments', 'comment'],
};

const normalizeHeader = (header) =>
  String(header || '')
    .toLowerCase()
    .replace(/[_*]/g, ' ')
    .replace(/[^a-z0-9 ().-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

function countDelimiters(line) {
  const counts = { ',': 0, ';': 0, '\t': 0, '|': 0 };
  let quoted = false;
  for (const char of line) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && counts[char] !== undefined) counts[char] += 1;
  }
  return counts;
}

export function parseCSV(text) {
  let content = String(text || '').replace(/^\uFEFF/, '');
  const firstLine = content.split(/\r?\n/).find((line) => line.trim()) || '';
  const counts = countDelimiters(firstLine);
  const delimiter = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] || ',';

  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (quoted) {
      if (char === '"') {
        if (content[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  const nonEmpty = rows.filter((cells) => cells.some((cell) => String(cell).trim() !== ''));
  if (!nonEmpty.length) return { headers: [], rows: [], delimiter };

  const headers = nonEmpty[0].map((header) => String(header).trim());
  const dataRows = nonEmpty
    .slice(1)
    .filter((cells) => cells.some((cell) => String(cell).trim() !== ''))
    .slice(0, 25_000)
    .map((cells) => headers.map((_, index) => String(cells[index] ?? '').trim()));

  return { headers, rows: dataRows, delimiter };
}

export function guessMapping(headers) {
  const normalized = headers.map(normalizeHeader);
  const used = new Set();
  const mapping = {
    date: '',
    description: '',
    merchant: '',
    amount: '',
    debit: '',
    credit: '',
    category: '',
    notes: '',
    amountMode: 'signed',
  };

  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    let best = null;
    for (const alias of aliases) {
      const index = normalized.findIndex(
        (header, i) => !used.has(i) && (header === alias || header.includes(alias)),
      );
      if (index !== -1) {
        best = index;
        break;
      }
    }
    if (best !== null) {
      mapping[field] = headers[best];
      used.add(best);
    }
  }

  if (!mapping.amount && mapping.debit) mapping.amountMode = 'debit_credit';
  if (mapping.debit && mapping.credit) mapping.amountMode = 'debit_credit';

  return mapping;
}
