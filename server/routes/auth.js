import { Router } from 'express';
import {
  clearSessionCookie,
  createSession,
  destroySession,
  hashPassword,
  loginRateLimit,
  requireAuth,
  setSessionCookie,
  verifyPassword,
} from '../auth.js';
import { countUsers, db } from '../db.js';
import { asyncHandler, nowISO } from '../util.js';
import { badRequest } from '../errors.js';

const router = Router();
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.get('/status', (req, res) => {
  res.json({
    setupRequired: countUsers() === 0,
    authenticated: Boolean(req.user),
    user: req.user || null,
  });
});

router.post(
  '/setup',
  asyncHandler(async (req, res) => {
    if (countUsers() > 0) return res.status(409).json({ error: 'Setup has already been completed' });
    const { name = '', email = '', password = '' } = req.body || {};
    if (!emailPattern.test(String(email))) throw badRequest('Enter a valid email address');
    if (String(password).length < 10) throw badRequest('Password must be at least 10 characters');

    const result = db
      .prepare('INSERT INTO users (name, email, password_hash, created_at) VALUES (?, ?, ?, ?)')
      .run(String(name).trim().slice(0, 80), String(email).trim().toLowerCase(), hashPassword(password), nowISO());
    const userId = Number(result.lastInsertRowid);
    const token = createSession(userId, req);
    setSessionCookie(res, req, token);
    res.json({ user: { id: userId, name: String(name).trim(), email: String(email).trim().toLowerCase() } });
  }),
);

router.post(
  '/login',
  loginRateLimit,
  asyncHandler(async (req, res) => {
    const { email = '', password = '' } = req.body || {};
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).trim().toLowerCase());
    if (!user || !verifyPassword(String(password), user.password_hash)) {
      return res.status(401).json({ error: 'Incorrect email or password' });
    }
    const token = createSession(user.id, req);
    setSessionCookie(res, req, token);
    res.json({ user: { id: user.id, name: user.name, email: user.email } });
  }),
);

router.post('/logout', (req, res) => {
  destroySession(req.authToken);
  clearSessionCookie(res, req);
  res.json({ ok: true });
});

router.post(
  '/password',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { currentPassword = '', newPassword = '' } = req.body || {};
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!user || !verifyPassword(String(currentPassword), user.password_hash)) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    if (String(newPassword).length < 10) throw badRequest('New password must be at least 10 characters');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), user.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(user.id, req.sessionId);
    res.json({ ok: true });
  }),
);

export default router;
