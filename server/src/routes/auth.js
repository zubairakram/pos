import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../db/index.js';
import { authenticate, signToken } from '../middleware/auth.js';
import { getSettings } from '../services/settings.js';
import { ApiError, asyncHandler, assert, requireFields, audit } from '../utils.js';

const router = Router();

router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  requireFields(req.body || {}, ['email', 'password']);
  const { rows } = await query(
    `SELECT u.*, l.name AS location_name FROM users u LEFT JOIN locations l ON l.id = u.location_id
     WHERE lower(u.email) = lower($1)`,
    [email]
  );
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    throw new ApiError(401, 'Invalid email or password');
  }
  assert(user.is_active, 403, 'This account has been deactivated');
  await query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
  await audit({ query: (t, p) => query(t, p) }, req, 'auth.login', 'user', user.id, { email: user.email });
  const safe = { ...user };
  delete safe.password_hash;
  safe.location_name = user.location_name;
  res.json({ token: signToken(user), user: safe, settings: await getSettings() });
}));

router.get('/me', authenticate, asyncHandler(async (req, res) => {
  // authenticate is applied by the parent router; this endpoint is kept for convenience
  const { rows } = await query(
    `SELECT u.id, u.name, u.email, u.role, u.phone, u.location_id, u.is_active, u.last_login_at,
            l.name AS location_name
     FROM users u LEFT JOIN locations l ON l.id = u.location_id WHERE u.id = $1`,
    [req.user.id]
  );
  res.json({ user: rows[0], settings: await getSettings() });
}));

export default router;
