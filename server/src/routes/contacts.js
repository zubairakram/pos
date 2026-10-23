import { Router } from 'express';
import { query, withTransaction } from '../db/index.js';
import { requireRole } from '../middleware/auth.js';
import { getMappings, postJournal } from '../services/accounting.js';
import { nextDoc } from '../services/documents.js';
import { customerStatement, supplierStatement } from '../services/reports.js';
import { audit, asyncHandler, assert, num, requireFields, round2 } from '../utils.js';

const router = Router();

/* ------------------------------- customers ------------------------------ */

router.get('/customers', asyncHandler(async (req, res) => {
  const maps = await getMappings({ query: (t, p) => query(t, p) });
  const params = [maps.ar];
  let search = '';
  if (req.query.search) {
    params.push(`%${req.query.search}%`);
    search = `AND (c.name ILIKE $${params.length} OR c.phone ILIKE $${params.length} OR c.code ILIKE $${params.length})`;
  }
  const { rows } = await query(
    `SELECT c.*, ROUND(COALESCE(SUM(jl.debit - jl.credit),0),2) AS balance,
            (SELECT COUNT(*)::int FROM sales s WHERE s.customer_id = c.id) AS order_count,
            (SELECT MAX(s.created_at) FROM sales s WHERE s.customer_id = c.id) AS last_sale
     FROM customers c
     LEFT JOIN journal_lines jl ON jl.customer_id = c.id AND jl.account_id = $1
     WHERE 1=1 ${search}
     GROUP BY c.id ORDER BY c.name`,
    params
  );
  res.json({ customers: rows });
}));

router.get('/customers/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { rows } = await query('SELECT * FROM customers WHERE id = $1', [id]);
  assert(rows.length, 404, 'Customer not found');
  const { rows: sales } = await query(
    `SELECT id, invoice_no, total, paid, due, status, created_at FROM sales
     WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 20`,
    [id]
  );
  const statement = await customerStatement(id, {});
  res.json({ customer: rows[0], sales, statement });
}));

router.get('/customers/:id/statement', asyncHandler(async (req, res) => {
  res.json(await customerStatement(Number(req.params.id), req.query));
}));

router.post('/customers', requireRole('admin', 'manager', 'cashier', 'accountant'), asyncHandler(async (req, res) => {
  const b = req.body || {};
  requireFields(b, ['name']);
  const customer = await withTransaction(async (client) => {
    const code = b.code || await nextDoc(client, 'customer', 'CUS');
    const opening = round2(num(b.opening_balance));
    const { rows } = await client.query(
      `INSERT INTO customers (code, name, email, phone, address, tax_number, credit_limit, opening_balance, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [code, b.name, b.email || null, b.phone || null, b.address || null, b.tax_number || null,
        num(b.credit_limit), opening, b.notes || null]
    );
    if (opening !== 0) {
      const maps = await getMappings(client);
      await postJournal(client, {
        date: b.opening_date || new Date().toISOString().slice(0, 10),
        memo: `Opening balance — ${rows[0].name}`,
        sourceType: 'opening_balance', sourceId: rows[0].id,
        locationId: req.user.location_id, userId: req.user.id,
        lines: opening > 0
          ? [
            { account_id: maps.ar, debit: opening, description: `Opening AR — ${rows[0].name}`, customer_id: rows[0].id },
            { account_id: maps.opening_balance_equity, credit: opening, description: `Opening equity — ${rows[0].name}` },
          ]
          : [
            { account_id: maps.ar, credit: -opening, description: `Opening credit — ${rows[0].name}`, customer_id: rows[0].id },
            { account_id: maps.opening_balance_equity, debit: -opening, description: `Opening equity — ${rows[0].name}` },
          ],
      });
    }
    await audit(client, req, 'customer.create', 'customer', rows[0].id, { name: rows[0].name });
    return rows[0];
  });
  res.status(201).json({ customer });
}));

router.put('/customers/:id', requireRole('admin', 'manager', 'cashier', 'accountant'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const b = req.body || {};
  const { rows: old } = await query('SELECT * FROM customers WHERE id = $1', [id]);
  assert(old.length, 404, 'Customer not found');
  const o = old[0];
  const { rows } = await query(
    `UPDATE customers SET name=$1, email=$2, phone=$3, address=$4, tax_number=$5, credit_limit=$6, notes=$7, is_active=$8
     WHERE id=$9 RETURNING *`,
    [b.name ?? o.name, b.email ?? o.email, b.phone ?? o.phone, b.address ?? o.address,
      b.tax_number ?? o.tax_number, num(b.credit_limit ?? o.credit_limit), b.notes ?? o.notes,
      b.is_active ?? o.is_active, id]
  );
  res.json({ customer: rows[0] });
}));

/* ------------------------------- suppliers ------------------------------ */

router.get('/suppliers', asyncHandler(async (req, res) => {
  const maps = await getMappings({ query: (t, p) => query(t, p) });
  const params = [maps.ap];
  let search = '';
  if (req.query.search) {
    params.push(`%${req.query.search}%`);
    search = `AND (s.name ILIKE $${params.length} OR s.phone ILIKE $${params.length} OR s.code ILIKE $${params.length})`;
  }
  const { rows } = await query(
    `SELECT s.*, ROUND(COALESCE(SUM(jl.credit - jl.debit),0),2) AS balance,
            (SELECT COUNT(*)::int FROM purchases p WHERE p.supplier_id = s.id) AS purchase_count,
            (SELECT MAX(p.created_at) FROM purchases p WHERE p.supplier_id = s.id) AS last_purchase
     FROM suppliers s
     LEFT JOIN journal_lines jl ON jl.supplier_id = s.id AND jl.account_id = $1
     WHERE 1=1 ${search}
     GROUP BY s.id ORDER BY s.name`,
    params
  );
  res.json({ suppliers: rows });
}));

router.get('/suppliers/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { rows } = await query('SELECT * FROM suppliers WHERE id = $1', [id]);
  assert(rows.length, 404, 'Supplier not found');
  const { rows: purchases } = await query(
    `SELECT id, bill_no, total, paid, due, status, created_at FROM purchases
     WHERE supplier_id = $1 ORDER BY created_at DESC LIMIT 20`,
    [id]
  );
  const statement = await supplierStatement(id);
  res.json({ supplier: rows[0], purchases, statement });
}));

router.get('/suppliers/:id/statement', asyncHandler(async (req, res) => {
  res.json(await supplierStatement(Number(req.params.id)));
}));

router.post('/suppliers', requireRole('admin', 'manager', 'storekeeper', 'accountant'), asyncHandler(async (req, res) => {
  const b = req.body || {};
  requireFields(b, ['name']);
  const supplier = await withTransaction(async (client) => {
    const code = b.code || await nextDoc(client, 'supplier', 'SUP');
    const opening = round2(num(b.opening_balance));
    const { rows } = await client.query(
      `INSERT INTO suppliers (code, name, email, phone, address, tax_number, opening_balance, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [code, b.name, b.email || null, b.phone || null, b.address || null, b.tax_number || null, opening, b.notes || null]
    );
    if (opening !== 0) {
      const maps = await getMappings(client);
      await postJournal(client, {
        date: b.opening_date || new Date().toISOString().slice(0, 10),
        memo: `Opening balance — ${rows[0].name}`,
        sourceType: 'opening_balance', sourceId: rows[0].id,
        locationId: req.user.location_id, userId: req.user.id,
        lines: opening > 0
          ? [
            { account_id: maps.opening_balance_equity, debit: opening, description: `Opening equity — ${rows[0].name}` },
            { account_id: maps.ap, credit: opening, description: `Opening AP — ${rows[0].name}`, supplier_id: rows[0].id },
          ]
          : [
            { account_id: maps.ap, debit: -opening, description: `Opening AP — ${rows[0].name}`, supplier_id: rows[0].id },
            { account_id: maps.opening_balance_equity, credit: -opening, description: `Opening equity — ${rows[0].name}` },
          ],
      });
    }
    await audit(client, req, 'supplier.create', 'supplier', rows[0].id, { name: rows[0].name });
    return rows[0];
  });
  res.status(201).json({ supplier });
}));

router.put('/suppliers/:id', requireRole('admin', 'manager', 'storekeeper', 'accountant'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const b = req.body || {};
  const { rows: old } = await query('SELECT * FROM suppliers WHERE id = $1', [id]);
  assert(old.length, 404, 'Supplier not found');
  const o = old[0];
  const { rows } = await query(
    `UPDATE suppliers SET name=$1, email=$2, phone=$3, address=$4, tax_number=$5, notes=$6, is_active=$7
     WHERE id=$8 RETURNING *`,
    [b.name ?? o.name, b.email ?? o.email, b.phone ?? o.phone, b.address ?? o.address,
      b.tax_number ?? o.tax_number, b.notes ?? o.notes, b.is_active ?? o.is_active, id]
  );
  res.json({ supplier: rows[0] });
}));

export default router;
