import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { query, withTransaction } from '../db/index.js';
import { requireRole } from '../middleware/auth.js';
import { audit, asyncHandler, assert, requireFields } from '../utils.js';

const router = Router();

router.get('/', requireRole('admin', 'manager', 'accountant'), asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT u.id, u.name, u.email, u.role, u.phone, u.location_id, u.is_active, u.last_login_at, u.created_at,
            l.name AS location_name
     FROM users u LEFT JOIN locations l ON l.id = u.location_id ORDER BY u.name`
  );
  res.json({ users: rows, roles: ['admin', 'manager', 'accountant', 'cashier', 'storekeeper'] });
}));

router.post('/', requireRole('admin'), asyncHandler(async (req, res) => {
  const body = req.body || {};
  requireFields(body, ['name', 'email', 'password', 'role']);
  assert(String(body.password).length >= 6, 400, 'Password must be at least 6 characters');
  assert(['admin', 'manager', 'accountant', 'cashier', 'storekeeper'].includes(body.role), 400, 'Invalid role');
  const hash = await bcrypt.hash(body.password, 10);
  const result = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO users (name, email, password_hash, role, phone, location_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, name, email, role, phone, location_id, is_active, created_at`,
      [body.name, String(body.email).toLowerCase(), hash, body.role, body.phone || null, body.location_id || null]
    );
    await audit(client, req, 'user.create', 'user', rows[0].id, { email: rows[0].email, role: rows[0].role });
    return rows[0];
  });
  res.status(201).json({ user: result });
}));

router.put('/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const body = req.body || {};
  const result = await withTransaction(async (client) => {
    const { rows: existing } = await client.query('SELECT * FROM users WHERE id = $1', [id]);
    assert(existing.length, 404, 'User not found');
    const passwordHash = body.password ? await bcrypt.hash(body.password, 10) : existing[0].password_hash;
    const { rows } = await client.query(
      `UPDATE users SET name=$1, email=$2, role=$3, phone=$4, location_id=$5, is_active=$6, password_hash=$7
       WHERE id=$8 RETURNING id, name, email, role, phone, location_id, is_active`,
      [
        body.name ?? existing[0].name,
        body.email ? String(body.email).toLowerCase() : existing[0].email,
        body.role ?? existing[0].role,
        body.phone ?? existing[0].phone,
        body.location_id ?? existing[0].location_id,
        body.is_active ?? existing[0].is_active,
        passwordHash, id,
      ]
    );
    await audit(client, req, 'user.update', 'user', id, { role: rows[0].role, active: rows[0].is_active });
    return rows[0];
  });
  res.json({ user: result });
}));

export default router;
