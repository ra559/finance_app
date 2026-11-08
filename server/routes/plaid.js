import { Router } from 'express';
import { asyncHandler } from '../util.js';
import { badRequest } from '../errors.js';
import {
  createLinkToken,
  createSandboxPublicToken,
  exchangePublicToken,
  fetchInstitutionName,
  handleWebhook,
  listItems,
  plaidStatus,
  removeItem,
  syncAllItems,
  syncItemById,
} from '../plaid.js';

const router = Router();

router.get('/status', (req, res) => {
  res.json({ ...plaidStatus(), items: listItems() });
});

router.get('/items', (req, res) => {
  res.json({ items: listItems() });
});

router.post(
  '/link-token',
  asyncHandler(async (req, res) => {
    const token = await createLinkToken();
    res.json({ link_token: token });
  }),
);

router.post(
  '/exchange',
  asyncHandler(async (req, res) => {
    const { public_token: publicToken, institution } = req.body || {};
    if (!publicToken) throw badRequest('Missing Plaid public token');
    const result = await exchangePublicToken(publicToken, institution);
    res.json({ ok: true, ...result });
  }),
);

router.post(
  '/sandbox',
  asyncHandler(async (req, res) => {
    const publicToken = await createSandboxPublicToken();
    const result = await exchangePublicToken(publicToken, {
      institution_id: 'ins_109508',
      name: 'First Platypus Bank (Sandbox)',
    });
    res.json({ ok: true, ...result });
  }),
);

router.post(
  '/sync',
  asyncHandler(async (req, res) => {
    const itemId = Number(req.body?.itemId);
    if (itemId) {
      const result = await syncItemById(itemId);
      res.json({ ok: true, results: [{ itemId, ...result }] });
      return;
    }
    const results = await syncAllItems();
    res.json({ ok: true, results });
  }),
);

router.delete(
  '/items/:id',
  asyncHandler(async (req, res) => {
    removeItem(Number(req.params.id));
    res.json({ ok: true });
  }),
);

export default router;

export const plaidWebhookRouter = Router();

plaidWebhookRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const result = handleWebhook(req.body);
    res.json({ received: true, ...result });
  }),
);

export { fetchInstitutionName };
