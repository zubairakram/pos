import { Router } from 'express';
import { query, withTransaction } from '../db/index.js';
import { requireRole } from '../middleware/auth.js';
import { getMappings, postJournal } from '../services/accounting.js';
import { recordCashMovement, getSession } from '../services/cash.js';
import {
  accountLedger, apAging, arAging, balanceSheet, cashFlow, customerStatement,
  profitAndLoss, supplierStatement, trialBalance,
} from '../services/reports.js';
import {
  audit, asyncHandler, assert, cleanDate, num, pagination, rangeFromQuery, requireFields,
  round2, todayISO,
} from '../utils.js';

const router = Router();
const accountingRoles = requireRole('admin', 'manager', 'accountant');

/* ------------------------------- accounts ------------------------------- */

router.get('/accounting/accounts', accountingRoles, asyncHandler(async (req, res) => {
  const balances = req.query.balances === 'true';
  const { rows } = await query(
    `SELECT a.*, p.name AS parent_name, p.code AS parent_code,
       ${balances ? `ROUND(COALESCE((SELECT SUM(jl.debit - jl.credit) FROM journal_lines jl
          JOIN journal_entries je ON je.id = jl.entry_id
          WHERE jl.account_id = a.id AND je.entry_date <= CURRENT_DATE),0),2)` : '0'} AS balance
     FROM accounts a LEFT JOIN accounts p ON p.id = a.parent_id
     ORDER BY a.code`
  );
  res.json({ accounts: rows });
}));

router.post('/accounting/accounts', requireRole('admin', 'accountant'), asyncHandler(async (req, res) => {
  const b = req.body || {};
  requireFields(b, ['code', 'name', 'type']);
  assert(['asset', 'liability', 'equity', 'revenue', 'expense'].includes(b.type), 400, 'Invalid account type');
  const { rows } = await query(
    `INSERT INTO accounts (code, name, type, subtype, parent_id, description, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [b.code, b.name, b.type, b.subtype || null, b.parent_id || null, b.description || null, b.is_active !== false]
  );
  res.status(201).json({ account: rows[0] });
}));

router.put('/accounting/accounts/:id', requireRole('admin', 'accountant'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const b = req.body || {};
  const { rows: old } = await query('SELECT * FROM accounts WHERE id = $1', [id]);
  assert(old.length, 404, 'Account not found');
  const o = old[0];
  if (o.is_system) {
    assert((b.type ?? o.type) === o.type && (b.code ?? o.code) === o.code, 400, 'System account code and type cannot be changed');
  }
  const { rows } = await query(
    `UPDATE accounts SET code=$1, name=$2, type=$3, subtype=$4, parent_id=$5, description=$6, is_active=$7
     WHERE id=$8 RETURNING *`,
    [b.code ?? o.code, b.name ?? o.name, b.type ?? o.type, b.subtype ?? o.subtype,
      b.parent_id === undefined ? o.parent_id : b.parent_id, b.description ?? o.description,
      b.is_active ?? o.is_active, id]
  );
  res.json({ account: rows[0] });
}));

router.get('/accounting/mappings', accountingRoles, asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT m.key, m.account_id, a.code, a.name, a.type
     FROM account_mappings m JOIN accounts a ON a.id = m.account_id ORDER BY m.key`
  );
  res.json({ mappings: rows });
}));

router.put('/accounting/mappings', requireRole('admin'), asyncHandler(async (req, res) => {
  const updates = req.body?.mappings;
  assert(updates && typeof updates === 'object', 400, 'Mappings object is required');
  await withTransaction(async (client) => {
    for (const [key, accountId] of Object.entries(updates)) {
      const { rows } = await client.query('SELECT id FROM accounts WHERE id = $1 AND is_active = true', [accountId]);
      assert(rows.length, 400, `Invalid account for mapping "${key}"`);
      await client.query(
        `INSERT INTO account_mappings (key, account_id) VALUES ($1,$2)
         ON CONFLICT (key) DO UPDATE SET account_id = EXCLUDED.account_id`,
        [key, accountId]
      );
    }
    await audit(client, req, 'accounting.mappings.update', 'account_mappings', null, updates);
  });
  res.json({ ok: true });
}));

/* -------------------------------- journal ------------------------------- */

router.get('/accounting/journal', accountingRoles, asyncHandler(async (req, res) => {
  const { limit, offset } = pagination(req.query, 50, 500);
  const params = [];
  const where = [];
  if (req.query.from) { params.push(req.query.from); where.push(`je.entry_date >= $${params.length}`); }
  if (req.query.to) { params.push(req.query.to); where.push(`je.entry_date <= $${params.length}`); }
  if (req.query.source_type) { params.push(req.query.source_type); where.push(`je.source_type = $${params.length}`); }
  if (req.query.account_id) {
    params.push(Number(req.query.account_id));
    where.push(`EXISTS (SELECT 1 FROM journal_lines jl2 WHERE jl2.entry_id = je.id AND jl2.account_id = $${params.length})`);
  }
  if (req.query.q) {
    params.push(`%${req.query.q}%`);
    where.push(`(je.entry_no ILIKE $${params.length} OR je.memo ILIKE $${params.length})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [{ rows }, { rows: totals }] = await Promise.all([
    query(
      `SELECT je.*, u.name AS user_name, l.name AS location_name,
              ROUND(COALESCE(SUM(jl.debit),0),2) AS total_debit,
              ROUND(COALESCE(SUM(jl.credit),0),2) AS total_credit,
              COUNT(jl.id)::int AS line_count
       FROM journal_entries je LEFT JOIN journal_lines jl ON jl.entry_id = je.id
       LEFT JOIN users u ON u.id = je.user_id LEFT JOIN locations l ON l.id = je.location_id
       ${whereSql} GROUP BY je.id, u.name, l.name
       ORDER BY je.entry_date DESC, je.id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    ),
    query(`SELECT COUNT(*)::int AS count FROM journal_entries je ${whereSql}`, params),
  ]);
  res.json({ entries: rows, total: totals[0].count, limit, offset });
}));

router.get('/accounting/journal/:id', accountingRoles, asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT je.*, u.name AS user_name, l.name AS location_name
     FROM journal_entries je LEFT JOIN users u ON u.id = je.user_id
     LEFT JOIN locations l ON l.id = je.location_id WHERE je.id = $1`,
    [Number(req.params.id)]
  );
  assert(rows.length, 404, 'Journal entry not found');
  const { rows: lines } = await query(
    `SELECT jl.*, a.code AS account_code, a.name AS account_name, a.type AS account_type,
       c.name AS customer_name, s.name AS supplier_name
     FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
     LEFT JOIN customers c ON c.id = jl.customer_id LEFT JOIN suppliers s ON s.id = jl.supplier_id
     WHERE jl.entry_id = $1 ORDER BY jl.id`,
    [Number(req.params.id)]
  );
  res.json({ entry: { ...rows[0], lines } });
}));

router.post('/accounting/journal', requireRole('admin', 'accountant'), asyncHandler(async (req, res) => {
  const b = req.body || {};
  requireFields(b, ['date', 'memo', 'lines']);
  assert(Array.isArray(b.lines) && b.lines.length >= 2, 400, 'A journal entry needs at least two lines');
  const entry = await withTransaction(async (client) => {
    for (const line of b.lines) {
      const { rows } = await client.query('SELECT id FROM accounts WHERE id = $1 AND is_active = true', [line.account_id]);
      assert(rows.length, 400, `Invalid account on journal line`);
    }
    const created = await postJournal(client, {
      date: cleanDate(b.date),
      memo: b.memo,
      sourceType: 'manual',
      locationId: b.location_id || req.user.location_id,
      userId: req.user.id,
      lines: b.lines,
    });
    await audit(client, req, 'journal.create', 'journal_entry', created.id, { memo: b.memo, lines: b.lines.length });
    return created;
  });
  res.status(201).json({ entry });
}));

/* ---------------------------- financial reports -------------------------- */

router.get('/accounting/trial-balance', accountingRoles, asyncHandler(async (req, res) => {
  const { from, to } = rangeFromQuery(req.query, 30);
  res.json(await trialBalance({ from, to }));
}));

router.get('/accounting/ledger/:accountId', accountingRoles, asyncHandler(async (req, res) => {
  const { from, to } = rangeFromQuery(req.query, 30);
  const { rows } = await query('SELECT * FROM accounts WHERE id = $1', [Number(req.params.accountId)]);
  assert(rows.length, 404, 'Account not found');
  res.json({ account: rows[0], ...(await accountLedger(Number(req.params.accountId), { from, to })), from, to });
}));

router.get('/accounting/pnl', accountingRoles, asyncHandler(async (req, res) => {
  const { from, to } = rangeFromQuery(req.query, 30);
  res.json({ ...(await profitAndLoss({ from, to })), from, to });
}));

router.get('/accounting/balance-sheet', accountingRoles, asyncHandler(async (req, res) => {
  const asOf = cleanDate(req.query.as_of) || todayISO();
  res.json(await balanceSheet({ asOf }));
}));

router.get('/accounting/cash-flow', accountingRoles, asyncHandler(async (req, res) => {
  const { from, to } = rangeFromQuery(req.query, 30);
  res.json(await cashFlow({ from, to }));
}));

router.get('/accounting/ar-aging', accountingRoles, asyncHandler(async (req, res) => {
  res.json({ aging: await arAging() });
}));

router.get('/accounting/ap-aging', accountingRoles, asyncHandler(async (req, res) => {
  res.json({ aging: await apAging() });
}));

router.get('/accounting/customer-statement/:id', accountingRoles, asyncHandler(async (req, res) => {
  res.json(await customerStatement(Number(req.params.id), req.query));
}));

router.get('/accounting/supplier-statement/:id', accountingRoles, asyncHandler(async (req, res) => {
  res.json(await supplierStatement(Number(req.params.id)));
}));

/* ------------------------------- expenses ------------------------------- */

router.get('/accounting/expenses', accountingRoles, asyncHandler(async (req, res) => {
  const { from, to } = rangeFromQuery(req.query, 30);
  const { rows } = await query(
    `SELECT e.*, a.code AS account_code, a.name AS account_name, pm.name AS method_name,
            u.name AS user_name, je.entry_no
     FROM expenses e JOIN accounts a ON a.id = e.account_id
     JOIN payment_methods pm ON pm.id = e.method_id
     LEFT JOIN users u ON u.id = e.user_id LEFT JOIN journal_entries je ON je.id = e.journal_entry_id
     WHERE e.entry_date BETWEEN $1 AND $2 ORDER BY e.entry_date DESC, e.id DESC`,
    [from, to]
  );
  const total = round2(rows.reduce((s, r) => s + num(r.amount), 0));
  res.json({ expenses: rows, total, from, to });
}));

router.post('/accounting/expenses', requireRole('admin', 'manager', 'accountant'), asyncHandler(async (req, res) => {
  const b = req.body || {};
  requireFields(b, ['account_id', 'amount', 'method_id']);
  const amount = round2(num(b.amount));
  assert(amount > 0, 400, 'Expense amount must be greater than zero');
  const expense = await withTransaction(async (client) => {
    const { rows: accounts } = await client.query('SELECT * FROM accounts WHERE id = $1 AND is_active = true', [b.account_id]);
    assert(accounts.length, 400, 'Expense account not found');
    assert(accounts[0].type === 'expense', 400, 'Choose an expense account');
    const { rows: methods } = await client.query('SELECT * FROM payment_methods WHERE id = $1 AND is_active = true', [b.method_id]);
    assert(methods.length, 400, 'Payment method not found');
    const method = methods[0];

    let session = null;
    if (method.type === 'cash') {
      assert(b.session_id, 400, 'Open a cash drawer session before recording a cash expense');
      session = await getSession(client, b.session_id, true);
      assert(session, 404, 'Cash session not found');
      assert(session.status === 'open', 400, 'Cash session is closed');
    }

    const entryDate = b.date || todayISO();
    const accountId = method.type === 'cash' && session ? session.account_id : method.account_id;
    const journal = await postJournal(client, {
      date: entryDate,
      memo: `Expense — ${accounts[0].name}${b.notes ? `: ${b.notes}` : ''}`,
      sourceType: 'expense',
      locationId: b.location_id || req.user.location_id,
      userId: req.user.id,
      lines: [
        { account_id: accounts[0].id, debit: amount, description: b.notes || accounts[0].name },
        { account_id: accountId, credit: amount, description: `Payment — ${method.name}` },
      ],
    });
    const { rows } = await client.query(
      `INSERT INTO expenses (entry_date, account_id, amount, method_id, location_id, session_id, reference,
         notes, user_id, journal_entry_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [entryDate, accounts[0].id, amount, method.id, b.location_id || req.user.location_id,
        session?.id || null, b.reference || null, b.notes || null, req.user.id, journal.id]
    );
    if (method.type === 'cash' && session) {
      await recordCashMovement(client, {
        sessionId: session.id,
        type: 'payment',
        amount: -amount,
        reason: `Expense — ${accounts[0].name}`,
        refType: 'expense',
        refId: rows[0].id,
        userId: req.user.id,
      });
    }
    await audit(client, req, 'expense.create', 'expense', rows[0].id, { amount, account: accounts[0].name });
    return rows[0];
  });
  res.status(201).json({ expense });
}));

export default router;
