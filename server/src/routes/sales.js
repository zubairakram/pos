import { Router } from 'express';
import { query } from '../db/index.js';
import { requireRole } from '../middleware/auth.js';
import {
  createSale, createReturn, getSaleDetail, listSales, receiveCustomerPayment, voidSale,
} from '../services/sales.js';
import { asyncHandler, assert } from '../utils.js';

const router = Router();

router.get('/sales', asyncHandler(async (req, res) => {
  const filters = { ...req.query };
  if (req.user.role === 'cashier') filters.user_id = req.user.id;
  res.json(await listSales(filters));
}));

router.post('/sales', requireRole('admin', 'manager', 'cashier'), asyncHandler(async (req, res) => {
  const sale = await createSale(req.user, req.body || {});
  res.status(201).json({ sale });
}));

router.get('/sales/:id', asyncHandler(async (req, res) => {
  const sale = await getSaleDetail(null, Number(req.params.id));
  if (req.user.role === 'cashier' && sale.user_id !== req.user.id) {
    return res.status(403).json({ error: 'You can only view your own sales' });
  }
  res.json({ sale });
}));

router.post('/sales/:id/void', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
  const sale = await voidSale(req.user, Number(req.params.id));
  res.json({ sale });
}));

router.post('/sales/:id/returns', requireRole('admin', 'manager', 'cashier'), asyncHandler(async (req, res) => {
  const ret = await createReturn(req.user, Number(req.params.id), req.body || {});
  res.status(201).json({ return: ret });
}));

router.get('/returns', asyncHandler(async (req, res) => {
  const params = [];
  const where = [];
  if (req.query.from) { params.push(req.query.from); where.push(`r.created_at >= $${params.length}::date`); }
  if (req.query.to) { params.push(req.query.to); where.push(`r.created_at < ($${params.length}::date + interval '1 day')`); }
  if (req.user.role === 'cashier') { params.push(req.user.id); where.push(`r.user_id = $${params.length}`); }
  const { rows } = await query(
    `SELECT r.*, s.invoice_no, u.name AS user_name, c.name AS customer_name,
            pm.name AS method_name,
            (SELECT COUNT(*)::int FROM return_items ri WHERE ri.return_id = r.id) AS item_count
     FROM sale_returns r JOIN sales s ON s.id = r.sale_id JOIN users u ON u.id = r.user_id
     LEFT JOIN customers c ON c.id = r.customer_id LEFT JOIN payment_methods pm ON pm.id = r.method_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY r.created_at DESC, r.id DESC LIMIT 200`,
    params
  );
  res.json({ returns: rows });
}));

router.get('/returns/:id', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT r.*, s.invoice_no, c.name AS customer_name, u.name AS user_name, pm.name AS method_name
     FROM sale_returns r JOIN sales s ON s.id = r.sale_id LEFT JOIN customers c ON c.id = r.customer_id
     JOIN users u ON u.id = r.user_id LEFT JOIN payment_methods pm ON pm.id = r.method_id
     WHERE r.id = $1`,
    [Number(req.params.id)]
  );
  assert(rows.length, 404, 'Return not found');
  const { rows: items } = await query(
    `SELECT ri.*, p.name AS product_name, p.sku FROM return_items ri
     LEFT JOIN products p ON p.id = ri.product_id WHERE ri.return_id = $1`,
    [Number(req.params.id)]
  );
  res.json({ return: { ...rows[0], items } });
}));

router.post('/customer-payments', requireRole('admin', 'manager', 'cashier', 'accountant'), asyncHandler(async (req, res) => {
  res.status(201).json({ receipt: await receiveCustomerPayment(req.user, req.body || {}) });
}));

export default router;
