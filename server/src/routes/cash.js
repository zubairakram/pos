import { Router } from 'express';
import { query, withTransaction } from '../db/index.js';
import { requireRole } from '../middleware/auth.js';
import { getMappings, postJournal } from '../services/accounting.js';
import {
  getOpenSession, getSession, recordCashMovement, sessionExpectedCash, sessionSummary,
} from '../services/cash.js';
import { audit, asyncHandler, assert, num, requireFields, round2, todayISO } from '../utils.js';

const router = Router();

async function loadSessionForUser(client, id, user, { forUpdate = true, allowClosed = false } = {}) {
  const session = await getSession(client, id, forUpdate);
  assert(session, 404, 'Cash session not found');
  if (user.role === 'cashier') assert(session.user_id === user.id, 403, 'You can only manage your own drawer');
  if (!allowClosed) assert(session.status === 'open', 400, 'This drawer session is closed');
  return session;
}

router.get('/cash/registers', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT r.*, a.name AS account_name, a.code AS account_code, l.name AS location_name,
       os.id AS open_session_id, os.opened_at, os.opening_float, os.cashier_name,
       CASE WHEN os.id IS NOT NULL THEN
         ROUND(os.opening_float + COALESCE((SELECT SUM(cm.amount) FROM cash_movements cm WHERE cm.session_id = os.id),0),2)
       END AS expected_cash
     FROM cash_registers r
     JOIN accounts a ON a.id = r.account_id JOIN locations l ON l.id = r.location_id
     LEFT JOIN LATERAL (
       SELECT cs.id, cs.opened_at, cs.opening_float, u.name AS cashier_name
       FROM cash_sessions cs JOIN users u ON u.id = cs.user_id
       WHERE cs.register_id = r.id AND cs.status = 'open' ORDER BY cs.opened_at DESC LIMIT 1
     ) os ON true
     WHERE r.is_active = true ORDER BY l.name, r.name`
  );
  res.json({ registers: rows });
}));

router.post('/cash/registers', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
  const b = req.body || {};
  requireFields(b, ['name', 'location_id', 'account_id']);
  const { rows } = await query(
    'INSERT INTO cash_registers (name, location_id, account_id, is_active) VALUES ($1,$2,$3,$4) RETURNING *',
    [b.name, Number(b.location_id), Number(b.account_id), b.is_active !== false]
  );
  res.status(201).json({ register: rows[0] });
}));

router.get('/cash/sessions', asyncHandler(async (req, res) => {
  const params = [];
  const where = [];
  if (req.query.status) { params.push(req.query.status); where.push(`s.status = $${params.length}`); }
  if (req.query.register_id) { params.push(Number(req.query.register_id)); where.push(`s.register_id = $${params.length}`); }
  if (req.query.from) { params.push(req.query.from); where.push(`s.opened_at >= $${params.length}::date`); }
  if (req.query.to) { params.push(req.query.to); where.push(`s.opened_at < ($${params.length}::date + interval '1 day')`); }
  if (req.user.role === 'cashier') { params.push(req.user.id); where.push(`s.user_id = $${params.length}`); }
  const { rows } = await query(
    `SELECT s.*, r.name AS register_name, l.name AS location_name, u.name AS cashier_name,
       ROUND(s.opening_float + COALESCE((SELECT SUM(cm.amount) FROM cash_movements cm WHERE cm.session_id = s.id),0),2) AS computed_expected,
       (SELECT COUNT(*)::int FROM sales sa WHERE sa.session_id = s.id AND sa.status <> 'voided') AS transactions
     FROM cash_sessions s JOIN cash_registers r ON r.id = s.register_id JOIN locations l ON l.id = r.location_id
     JOIN users u ON u.id = s.user_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY s.opened_at DESC LIMIT 200`,
    params
  );
  res.json({ sessions: rows });
}));

router.get('/cash/sessions/current', asyncHandler(async (req, res) => {
  const registerId = req.query.register_id ? Number(req.query.register_id) : null;
  let row = null;
  if (registerId) {
    const { rows } = await query(
      `SELECT cs.*, r.name AS register_name FROM cash_sessions cs
       JOIN cash_registers r ON r.id = cs.register_id
       WHERE cs.register_id = $1 AND cs.status = 'open'
       ORDER BY cs.opened_at DESC LIMIT 1`,
      [registerId]
    );
    row = rows[0] || null;
  } else {
    const { rows } = await query(
      `SELECT cs.*, r.name AS register_name FROM cash_sessions cs
       JOIN cash_registers r ON r.id = cs.register_id
       WHERE cs.user_id = $1 AND cs.status = 'open' ORDER BY cs.opened_at DESC LIMIT 1`,
      [req.user.id]
    );
    row = rows[0] || null;
  }
  if (!row) return res.json({ session: null });
  const summary = await sessionSummary({ query: (t, p) => query(t, p) }, row.id);
  res.json({ session: summary });
}));

router.get('/cash/sessions/:id/summary', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { rows } = await query('SELECT * FROM cash_sessions WHERE id = $1', [id]);
  assert(rows.length, 404, 'Cash session not found');
  if (req.user.role === 'cashier') assert(rows[0].user_id === req.user.id, 403, 'You can only view your own drawer');
  res.json({ session: await sessionSummary({ query: (t, p) => query(t, p) }, id) });
}));

router.post('/cash/sessions/open', requireRole('admin', 'manager', 'cashier'), asyncHandler(async (req, res) => {
  const b = req.body || {};
  requireFields(b, ['register_id']);
  const registerId = Number(b.register_id);
  const openingFloat = round2(num(b.opening_float));
  assert(openingFloat >= 0, 400, 'Opening float cannot be negative');
  const session = await withTransaction(async (client) => {
    const { rows: regs } = await client.query('SELECT * FROM cash_registers WHERE id = $1 AND is_active = true', [registerId]);
    assert(regs.length, 404, 'Cash register not found');
    const existing = await getOpenSession(client, registerId, true);
    assert(!existing, 400, `Register is already open by ${existing?.cashier_name || 'another user'}`);
    const { rows } = await client.query(
      `INSERT INTO cash_sessions (register_id, user_id, opening_float, opening_note)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [registerId, req.user.id, openingFloat, b.note || null]
    );
    await audit(client, req, 'cash.open', 'cash_session', rows[0].id, { registerId, openingFloat });
    return rows[0];
  });
  res.status(201).json({ session });
}));

router.post('/cash/sessions/:id/close', requireRole('admin', 'manager', 'cashier'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const b = req.body || {};
  assert(b.counted_cash !== undefined, 400, 'Counted cash is required');
  const counted = round2(num(b.counted_cash));
  assert(counted >= 0, 400, 'Counted cash cannot be negative');

  const result = await withTransaction(async (client) => {
    const session = await loadSessionForUser(client, id, req.user);
    const expected = await sessionExpectedCash(client, session);
    const variance = round2(counted - expected);
    const { rows } = await client.query(
      `UPDATE cash_sessions SET status='closed', expected_cash=$1, counted_cash=$2, variance=$3,
         denominations=$4, closing_note=$5, closed_at=now() WHERE id=$6 RETURNING *`,
      [expected, counted, variance, b.denominations ? JSON.stringify(b.denominations) : null, b.note || null, id]
    );

    if (variance !== 0) {
      const maps = await getMappings(client);
      await postJournal(client, {
        date: b.date || todayISO(),
        memo: `Cash drawer ${variance > 0 ? 'overage' : 'shortage'} — ${session.register_name}`,
        sourceType: 'cash_variance',
        sourceId: session.id,
        locationId: session.register_location_id,
        userId: req.user.id,
        lines: variance > 0
          ? [
            { account_id: session.account_id, debit: variance, description: 'Cash drawer overage' },
            { account_id: maps.cash_over_short, credit: variance, description: 'Cash over/short' },
          ]
          : [
            { account_id: maps.cash_over_short, debit: Math.abs(variance), description: 'Cash over/short' },
            { account_id: session.account_id, credit: Math.abs(variance), description: 'Cash drawer shortage' },
          ],
      });
    }

    await audit(client, req, 'cash.close', 'cash_session', id, { expected, counted, variance });
    return { ...rows[0], expected_cash: expected, variance };
  });
  res.json({ session: result, summary: await sessionSummary({ query: (t, p) => query(t, p) }, id) });
}));

router.post('/cash/sessions/:id/movements', requireRole('admin', 'manager', 'cashier'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const b = req.body || {};
  requireFields(b, ['type', 'amount', 'reason']);
  assert(['cash_in', 'cash_out'].includes(b.type), 400, 'Movement type must be cash_in or cash_out');
  const amount = round2(num(b.amount));
  assert(amount > 0, 400, 'Amount must be greater than zero');

  const result = await withTransaction(async (client) => {
    const session = await loadSessionForUser(client, id, req.user);
    const maps = await getMappings(client);
    const signed = b.type === 'cash_in' ? amount : -amount;
    const movement = await recordCashMovement(client, {
      sessionId: session.id,
      type: b.type,
      amount: signed,
      reason: b.reason,
      refType: 'cash_movement',
      userId: req.user.id,
    });
    await postJournal(client, {
      date: b.date || todayISO(),
      memo: `${b.type === 'cash_in' ? 'Cash in' : 'Cash out'} — ${session.register_name}: ${b.reason}`,
      sourceType: b.type,
      sourceId: movement.id,
      locationId: session.register_location_id,
      userId: req.user.id,
      lines: b.type === 'cash_in'
        ? [
          { account_id: session.account_id, debit: amount, description: b.reason },
          { account_id: maps.owner_capital, credit: amount, description: b.reason },
        ]
        : [
          { account_id: maps.owner_drawings, debit: amount, description: b.reason },
          { account_id: session.account_id, credit: amount, description: b.reason },
        ],
    });
    await audit(client, req, `cash.${b.type}`, 'cash_session', id, { amount, reason: b.reason });
    return movement;
  });
  res.status(201).json({ movement: result });
}));

export default router;
