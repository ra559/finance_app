import crypto from 'node:crypto';
import { db } from './db.js';
import { config } from './config.js';
import { nowISO, randomToken, sha256 } from './util.js';

const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1 };
const COOKIE_NAME = 'cove_session';

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, SCRYPT_OPTIONS);
  return `scrypt$16384$8$1$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  try {
    const [scheme, n, r, p, saltHex, hashHex] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(password, salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function parseCookies(header = '') {
  const cookies = {};
  for (const part of String(header).split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

function isSecureRequest(req) {
  return req.secure || config.appUrl.startsWith('https://');
}

export function setSessionCookie(res, req, token) {
  const maxAge = config.sessionDays * 24 * 60 * 60;
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ];
  if (isSecureRequest(req)) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(res, req) {
  const parts = [`${COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (isSecureRequest(req)) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

export function createSession(userId, req) {
  const token = randomToken(32);
  const expires = new Date(Date.now() + config.sessionDays * 86_400_000).toISOString();
  db.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)').run(
    sha256(token),
    userId,
    nowISO(),
    expires,
    String(req.headers['user-agent'] || '').slice(0, 255),
  );
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(nowISO());
  return token;
}

export function destroySession(token) {
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sha256(token));
}

export function attachUser(req, _res, next) {
  const token = parseCookies(req.headers.cookie).cove_session;
  req.authToken = token;
  if (token) {
    const row = db
      .prepare(
        `SELECT s.id AS session_id, s.expires_at, u.id, u.name, u.email
         FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
      )
      .get(sha256(token));
    if (row && row.expires_at > nowISO()) {
      req.user = { id: row.id, name: row.name, email: row.email };
      req.sessionId = row.session_id;
    }
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not signed in' });
  next();
}

// Blocks cross-site state changes. The web client always sends the custom
// header, and cross-origin requests cannot set it without a CORS preflight.
export function requireSameOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.headers['x-cove-client'] === 'web') return next();
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host === req.headers.host) return next();
    } catch {
      // fall through
    }
  }
  return res.status(403).json({ error: 'Cross-site request blocked' });
}

// Simple in-memory limiter for login attempts.
const attempts = new Map();
export function loginRateLimit(req, res, next) {
  const key = req.ip || 'unknown';
  const now = Date.now();
  const entry = attempts.get(key) || { count: 0, reset: now + 15 * 60_000 };
  if (now > entry.reset) {
    entry.count = 0;
    entry.reset = now + 15 * 60_000;
  }
  entry.count += 1;
  attempts.set(key, entry);
  if (entry.count > 20) {
    return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  }
  next();
}

export { COOKIE_NAME };
