import { Router } from 'express';
import { db, getSetting, setSetting } from '../db.js';
import { config } from '../config.js';
import { asyncHandler } from '../util.js';
import { badRequest } from '../errors.js';
import { decryptSecret, encryptSecret, maskSecret } from '../secrets.js';
import { getAiConfig, testAiConnection } from '../ai.js';
import { plaidStatus, listItems } from '../plaid.js';
import { createMcpToken, listMcpTokens, revokeMcpToken } from '../mcp.js';
import { seedDemoData, removeDemoData } from '../demo.js';

const router = Router();

router.get('/', (req, res) => {
  const ai = getAiConfig();
  const user = db.prepare('SELECT id, name, email, created_at FROM users WHERE id = ?').get(req.user.id);
  const stats = {
    accounts: db.prepare('SELECT COUNT(*) AS count FROM accounts WHERE archived = 0').get().count,
    transactions: db.prepare('SELECT COUNT(*) AS count FROM transactions').get().count,
    categories: db.prepare('SELECT COUNT(*) AS count FROM categories').get().count,
    lastSync: getSetting('last_sync_at', ''),
  };
  res.json({
    profile: user,
    preferences: {
      currency: getSetting('currency', 'USD'),
      locale: getSetting('locale', 'en-US'),
    },
    ai: {
      baseUrl: ai.baseUrl,
      model: ai.model,
      hasKey: Boolean(ai.apiKey),
      maskedKey: ai.apiKey ? maskSecret(ai.apiKey) : '',
      configured: ai.configured,
      envOverrides: ai.envOverrides,
    },
    plaid: { ...plaidStatus(), items: listItems() },
    mcp: {
      tokens: listMcpTokens(),
      endpoint: `${config.appUrl}/api/mcp`,
    },
    app: {
      version: '1.0.0',
      appUrl: config.appUrl,
      dataDir: config.dataDir,
      node: process.version,
    },
    stats,
  });
});

router.put(
  '/ai',
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    if (body.baseUrl !== undefined) {
      const baseUrl = String(body.baseUrl).trim().replace(/\/+$/, '');
      if (baseUrl && !/^https?:\/\/[^\s]+$/i.test(baseUrl)) throw badRequest('Base URL must start with http:// or https://');
      setSetting('ai_base_url', baseUrl);
    }
    if (body.model !== undefined) setSetting('ai_model', String(body.model).trim().slice(0, 120));
    if (body.clearKey) setSetting('ai_api_key', '');
    else if (body.apiKey) setSetting('ai_api_key', encryptSecret(String(body.apiKey).trim()));

    const ai = getAiConfig();
    res.json({
      ok: true,
      ai: {
        baseUrl: ai.baseUrl,
        model: ai.model,
        hasKey: Boolean(ai.apiKey),
        maskedKey: ai.apiKey ? maskSecret(ai.apiKey) : '',
        configured: ai.configured,
        envOverrides: ai.envOverrides,
      },
    });
  }),
);

router.post(
  '/ai/test',
  asyncHandler(async (req, res) => {
    const result = await testAiConnection();
    res.json(result);
  }),
);

router.patch(
  '/profile',
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const fields = [];
    const values = [];
    if (body.name !== undefined) {
      fields.push('name = ?');
      values.push(String(body.name).trim().slice(0, 80));
    }
    if (body.email !== undefined) {
      const email = String(body.email).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest('Enter a valid email address');
      const existing = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email, req.user.id);
      if (existing) throw badRequest('That email is already in use');
      fields.push('email = ?');
      values.push(email);
    }
    if (fields.length) {
      values.push(req.user.id);
      db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }
    res.json({ profile: db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(req.user.id) });
  }),
);

router.put(
  '/preferences',
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    if (body.currency !== undefined) {
      const currency = String(body.currency).trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) throw badRequest('Currency must be a 3-letter code');
      setSetting('currency', currency);
    }
    if (body.locale !== undefined) setSetting('locale', String(body.locale).slice(0, 16));
    res.json({
      preferences: { currency: getSetting('currency', 'USD'), locale: getSetting('locale', 'en-US') },
    });
  }),
);

router.post(
  '/mcp-tokens',
  asyncHandler(async (req, res) => {
    const name = String(req.body?.name || '').trim() || 'MCP client';
    const token = createMcpToken(name.slice(0, 80));
    res.status(201).json({ token, tokens: listMcpTokens() });
  }),
);

router.delete(
  '/mcp-tokens/:id',
  asyncHandler(async (req, res) => {
    revokeMcpToken(Number(req.params.id));
    res.json({ ok: true, tokens: listMcpTokens() });
  }),
);

router.post(
  '/demo',
  asyncHandler(async (req, res) => {
    const result = seedDemoData();
    res.json({ ok: true, ...result });
  }),
);

router.delete(
  '/demo',
  asyncHandler(async (req, res) => {
    const result = removeDemoData();
    res.json({ ok: true, ...result });
  }),
);

export { decryptSecret };
export default router;
