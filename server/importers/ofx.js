import { parseDateToISO } from './dates.js';

function decodeEntities(value) {
  return String(value)
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/g, "'");
}

function tagValue(block, tag) {
  const match = block.match(new RegExp(`<${tag}>\\s*([^<\\r\\n]*)`, 'i'));
  return match ? decodeEntities(match[1].trim()) : '';
}

function parseOfxAmount(value) {
  const number = Number.parseFloat(String(value).replace(/[^0-9.\-+]/g, ''));
  return Number.isFinite(number) ? Math.round(number * 100) : null;
}

/**
 * OFX/QFX parser that handles both OFX 1.x SGML (unclosed tags) and
 * OFX 2.x XML. Returns normalized transactions with FITIDs for deduping.
 */
export function parseOFX(content) {
  const text = String(content || '');
  if (!/<OFX>|OFXHEADER/i.test(text)) {
    throw new Error('This does not look like an OFX/QFX file (missing OFX header)');
  }

  const warnings = [];
  const currency = tagValue(text, 'CURDEF') || '';
  const bankId = tagValue(text, 'BANKID') || tagValue(text, 'BRANCHID');
  const accountId = tagValue(text, 'ACCTID');
  const isCreditCard = /<CCSTMTRS>/i.test(text);
  const format = /<OFX>\s*<\?xml/i.test(text) || /OFXHEADER="?2/.test(text) ? 'qfx' : 'ofx';

  const transactions = [];
  const blockPattern =
    /<STMTTRN>([\s\S]*?)(?:<\/STMTTRN>|(?=<STMTTRN>)|(?=<\/BANKTRANLIST>)|(?=<\/CCSTMTRS>)|(?=<\/STMTRS>)|(?=<\/OFX>)|$)/gi;
  let match;
  while ((match = blockPattern.exec(text)) !== null) {
    const block = match[1];
    const rawDate = tagValue(block, 'DTPOSTED');
    const date = parseDateToISO(rawDate.slice(0, 8));
    const amountCents = parseOfxAmount(tagValue(block, 'TRNAMT'));
    const fitid = tagValue(block, 'FITID');
    const trnType = tagValue(block, 'TRNTYPE').toUpperCase();
    let name = tagValue(block, 'NAME') || tagValue(block, 'PAYEE') || tagValue(block, 'MEMO') || 'Imported transaction';
    const memo = tagValue(block, 'MEMO');
    const merchantName = tagValue(block, 'PAYEE') || '';

    if (!date) {
      warnings.push(`Skipped a transaction with an unreadable date (${rawDate || 'empty'})`);
      continue;
    }
    if (amountCents === null) {
      warnings.push(`Skipped "${name}" — unreadable amount`);
      continue;
    }
    if (trnType === 'CREDIT' && amountCents < 0) amountCents = Math.abs(amountCents);
    if (['DEBIT', 'PAYMENT', 'FEE', 'CHECK'].includes(trnType) && amountCents > 0) {
      amountCents = -Math.abs(amountCents);
    }
    name = name.replace(/\s+/g, ' ').trim();
    if (!name) name = memo || 'Imported transaction';

    transactions.push({
      date,
      name,
      merchantName: merchantName || undefined,
      memo: memo && memo !== name ? memo : undefined,
      amountCents,
      fitid,
      type: trnType,
      raw: { fitid, trnType },
    });
  }

  if (!transactions.length) throw new Error('No transactions found in this OFX/QFX file');

  const dates = transactions.map((tx) => tx.date).sort();
  return {
    transactions,
    currency,
    format,
    warnings,
    meta: {
      bankId,
      accountId,
      isCreditCard,
      startDate: dates[0],
      endDate: dates[dates.length - 1],
      count: transactions.length,
    },
  };
}
