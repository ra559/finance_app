import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

import { config, ROOT } from './config.js';
import { db } from './db.js';
import { attachUser, requireAuth, requireSameOrigin } from './auth.js';
import authRoutes from './routes/auth.js';
import accountRoutes from './routes/accounts.js';
import transactionRoutes from './routes/transactions.js';
import categoryRoutes, { budgetsRouter } from './routes/categories.js';
import reportRoutes from './routes/reports.js';
import importRoutes from './routes/imports.js';
import plaidRoutes, { plaidWebhookRouter } from './routes/plaid.js';
import chatRoutes from './routes/chat.js';
import settingsRoutes from './routes/settings.js';
import mcpRoutes from './routes/mcp.js';
import { snapshotAllBalances, syncAllItems } from './plaid.js';
import { detectRecurring } from './recurring.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy ? 1 : false);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "img-src 'self' data:",
      "font-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self' https://cdn.plaid.com https://*.plaid.com",
      "connect-src 'self' https://*.plaid.com",
      "frame-src https://*.plaid.com",
      "form-action 'self'",
    ].join('; '),
  );
  if (config.isProduction && config.appUrl.startsWith('https://')) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

app.use(express.json({ limit: '30mb' }));
app.use(attachUser);

app.get('/api/health', (req, res) => {
  try {
    db.prepare('SELECT 1').get();
    res.json({ ok: true, version: '1.0.0', time: new Date().toISOString() });
  } catch (error) {
    res.status(503).json({ ok: false, error: error.message });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/plaid/webhook', plaidWebhookRouter);
app.use('/api/mcp', mcpRoutes);
app.use('/mcp', mcpRoutes);

const api = express.Router();
api.use(requireAuth, requireSameOrigin);
api.use('/accounts', accountRoutes);
api.use('/transactions', transactionRoutes);
api.use('/categories', categoryRoutes);
api.use('/budgets', budgetsRouter);
api.use(reportRoutes);
api.use('/import', importRoutes);
api.use('/plaid', plaidRoutes);
api.use('/chat', chatRoutes);
api.use('/settings', settingsRoutes);
app.use('/api', api);

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

const dist = path.join(ROOT, 'dist');
const hasBuild = fs.existsSync(path.join(dist, 'index.html'));

if (hasBuild) {
  app.use(
    '/assets',
    express.static(path.join(dist, 'assets'), { immutable: true, maxAge: '1y' }),
  );
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get('*', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(dist, 'index.html'));
  });
} else {
  app.get('/', (req, res) => {
    res
      .status(200)
      .type('html')
      .send(
        `<!doctype html><html><body style="font-family:system-ui;background:#0a0f0d;color:#e8efe9;padding:48px;line-height:1.6">
         <h1>Cove API is running</h1>
         <p>The web interface has not been built yet.</p>
         <p>Run <code style="background:#182420;padding:2px 6px;border-radius:4px">npm run build</code> and restart, or use <code style="background:#182420;padding:2px 6px;border-radius:4px">npm run dev</code> for the Vite dev server on port 5173.</p>
         <p><a style="color:#34d399" href="/api/health">API health</a></p>
        </body></html>`,
      );
  });
}

app.use((err, req, res, _next) => {
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'That file is too large (30 MB limit)' });
  }
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
  const status = err.status || 500;
  if (status >= 500) console.error('[error]', err);
  res.status(status).json({ error: err.message || 'Something went wrong' });
});

async function runMaintenance() {
  try {
    snapshotAllBalances();
  } catch (error) {
    console.error('[maintenance] snapshot failed:', error.message);
  }
  try {
    detectRecurring();
  } catch (error) {
    console.error('[maintenance] recurring detection failed:', error.message);
  }
  if (config.plaid.configured) {
    try {
      const results = await syncAllItems();
      if (results.length) console.log(`[plaid] synced ${results.length} connection(s)`);
    } catch (error) {
      console.error('[plaid] scheduled sync failed:', error.message);
    }
  }
}

if (!process.env.COVE_DISABLE_JOBS) {
  setTimeout(runMaintenance, 12_000).unref?.();
  if (config.syncIntervalHours > 0) {
    setInterval(runMaintenance, config.syncIntervalHours * 3_600_000).unref?.();
  }
  setInterval(() => {
    try {
      detectRecurring();
    } catch (error) {
      console.error('[maintenance] recurring detection failed:', error.message);
    }
  }, 24 * 3_600_000).unref?.();
}

const server = app.listen(config.port, config.host, () => {
  console.log(`\n  Cove is running at ${config.appUrl}`);
  console.log(`  Listening on ${config.host}:${config.port}`);
  console.log(`  Data directory: ${config.dataDir}`);
  console.log(`  Plaid: ${config.plaid.configured ? config.plaid.envName : 'not configured (CSV/OFX import available)'}`);
  console.log(`  Web build: ${hasBuild ? 'found' : 'not built yet'}\n`);
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[${signal}] shutting down…`);
  server.close(() => {
    try {
      db.close();
    } catch {
      // ignore
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref?.();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

export default app;
