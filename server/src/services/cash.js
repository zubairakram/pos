import { assert, num, round2, todayISO } from '../utils.js';

export async function getOpenSession(client, registerId, forUpdate = false) {
  const { rows } = await client.query(
    `SELECT s.*, r.name AS register_name, r.account_id, r.location_id AS register_location_id, u.name AS cashier_name
     FROM cash_sessions s
     JOIN cash_registers r ON r.id = s.register_id
     JOIN users u ON u.id = s.user_id
     WHERE s.register_id = $1 AND s.status = 'open'
     ${forUpdate ? 'FOR UPDATE OF s' : ''}`,
    [registerId]
  );
  return rows[0] || null;
}

export async function getSession(client, sessionId, forUpdate = false) {
  const { rows } = await client.query(
    `SELECT s.*, r.name AS register_name, r.account_id, r.location_id AS register_location_id, u.name AS cashier_name
     FROM cash_sessions s
     JOIN cash_registers r ON r.id = s.register_id
     JOIN users u ON u.id = s.user_id
     WHERE s.id = $1 ${forUpdate ? 'FOR UPDATE OF s' : ''}`,
    [sessionId]
  );
  return rows[0] || null;
}

export async function sessionExpectedCash(client, session) {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(amount),0) AS movements FROM cash_movements WHERE session_id = $1`,
    [session.id]
  );
  return round2(num(session.opening_float) + num(rows[0].movements));
}

export async function recordCashMovement(client, {
  sessionId, type, amount, reason, refType, refId, userId,
}) {
  assert(sessionId, 400, 'A cash drawer session is required for cash movements');
  const value = round2(amount);
  assert(value !== 0, 400, 'Cash movement amount cannot be zero');
  const { rows } = await client.query(
    `INSERT INTO cash_movements (session_id, type, amount, reason, ref_type, ref_id, user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [sessionId, type, value, reason || null, refType || null, refId || null, userId || null]
  );
  return rows[0];
}

export async function sessionSummary(client, sessionId) {
  const session = await getSession(client, sessionId);
  assert(session, 404, 'Cash session not found');
  const expected = await sessionExpectedCash(client, session);
  const { rows: movs } = await client.query(
    'SELECT * FROM cash_movements WHERE session_id = $1 ORDER BY created_at, id',
    [sessionId]
  );
  const { rows: sales } = await client.query(
    `SELECT
       COUNT(*)::int AS transactions,
       COALESCE(SUM(total),0) AS gross_sales,
       COALESCE(SUM(discount),0) AS discounts,
       COALESCE(SUM(tax),0) AS tax,
       COALESCE(SUM(paid),0) AS collected
     FROM sales WHERE session_id = $1 AND status <> 'voided'`,
    [sessionId]
  );
  const { rows: refunds } = await client.query(
    `SELECT COALESCE(SUM(total),0) AS refunds, COUNT(*)::int AS returns
     FROM sale_returns WHERE session_id = $1`,
    [sessionId]
  );
  const { rows: methods } = await client.query(
    `SELECT pm.name, pm.type, pm.code, COALESCE(SUM(p.amount),0) AS amount
     FROM payments p JOIN payment_methods pm ON pm.id = p.method_id
     JOIN sales s ON s.id = p.sale_id
     WHERE s.session_id = $1 AND s.status <> 'voided' AND p.type = 'sale'
     GROUP BY pm.name, pm.type, pm.code ORDER BY amount DESC`,
    [sessionId]
  );
  const { rows: byType } = await client.query(
    `SELECT type, COALESCE(SUM(amount),0) AS amount FROM cash_movements
     WHERE session_id = $1 GROUP BY type`,
    [sessionId]
  );
  return {
    ...session,
    expected_cash: session.status === 'closed' ? num(session.expected_cash) : expected,
    computed_expected: expected,
    movements: movs,
    movement_totals: Object.fromEntries(byType.map((r) => [r.type, num(r.amount)])),
    payment_totals: methods,
    sales: { ...sales[0], gross_sales: num(sales[0].gross_sales), discounts: num(sales[0].discounts), tax: num(sales[0].tax), collected: num(sales[0].collected) },
    returns: { ...refunds[0], refunds: num(refunds[0].refunds) },
    difference: session.status === 'closed' ? num(session.variance) : null,
    as_of: todayISO(),
  };
}
