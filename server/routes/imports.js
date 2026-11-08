import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../util.js';
import { badRequest } from '../errors.js';
import { importCsv, importOfx, previewCsv } from '../importers/index.js';

const router = Router();

router.post(
  '/csv/preview',
  asyncHandler(async (req, res) => {
    const content = String(req.body?.content || '');
    if (!content.trim()) throw badRequest('Choose a CSV file first');
    if (content.length > 20_000_000) throw badRequest('File is too large (max 20 MB)');
    res.json(previewCsv(content));
  }),
);

router.post(
  '/csv',
  asyncHandler(async (req, res) => {
    const { accountId, content, mapping, filename } = req.body || {};
    if (!accountId) throw badRequest('Choose an account to import into');
    if (!content) throw badRequest('Choose a CSV file first');
    if (!mapping?.date || (!mapping.amount && !(mapping.debit || mapping.credit))) {
      throw badRequest('Map both a date and an amount column');
    }
    const result = importCsv(Number(accountId), content, mapping, filename || '');
    res.json(result);
  }),
);

router.post(
  '/ofx',
  asyncHandler(async (req, res) => {
    const { accountId, content, filename } = req.body || {};
    if (!accountId) throw badRequest('Choose an account to import into');
    if (!content) throw badRequest('Choose an OFX or QFX file first');
    if (content.length > 20_000_000) throw badRequest('File is too large (max 20 MB)');
    const result = importOfx(Number(accountId), content, filename || '');
    res.json(result);
  }),
);

router.get('/history', (req, res) => {
  res.json({
    batches: db.prepare('SELECT * FROM import_batches ORDER BY id DESC LIMIT 25').all(),
  });
});

export default router;
