import { Router } from 'express';
import { requireRole } from '../middleware/auth.js';
import {
  apAging, arAging, cashFlow, customerBalances, hourlySales, inventoryValuation,
  paymentMethodReport, salesByCashier, salesByCategory, salesByLocation, salesByProduct,
  salesSummary, stockMovements, supplierBalances, taxReport,
} from '../services/reports.js';
import { sessionSummary } from '../services/cash.js';
import { query } from '../db/index.js';
import { asyncHandler, rangeFromQuery } from '../utils.js';

const router = Router();
router.use(requireRole('admin', 'manager', 'accountant'));

router.get('/sales-summary', asyncHandler(async (req, res) => {
  const { from, to } = rangeFromQuery(req.query, 30);
  res.json({ ...(await salesSummary({ from, to, group: req.query.group || 'day' })), from, to });
}));

router.get('/sales-by-product', asyncHandler(async (req, res) => {
  const { from, to } = rangeFromQuery(req.query, 30);
  res.json({ products: await salesByProduct({ from, to, limit: req.query.limit }), from, to });
}));

router.get('/sales-by-category', asyncHandler(async (req, res) => {
  const { from, to } = rangeFromQuery(req.query, 30);
  res.json({ categories: await salesByCategory({ from, to }), from, to });
}));

router.get('/sales-by-cashier', asyncHandler(async (req, res) => {
  const { from, to } = rangeFromQuery(req.query, 30);
  res.json({ cashiers: await salesByCashier({ from, to }), from, to });
}));

router.get('/sales-by-location', asyncHandler(async (req, res) => {
  const { from, to } = rangeFromQuery(req.query, 30);
  res.json({ locations: await salesByLocation({ from, to }), from, to });
}));

router.get('/payment-methods', asyncHandler(async (req, res) => {
  const { from, to } = rangeFromQuery(req.query, 30);
  res.json({ methods: await paymentMethodReport({ from, to }), from, to });
}));

router.get('/tax', asyncHandler(async (req, res) => {
  const { from, to } = rangeFromQuery(req.query, 30);
  res.json({ ...(await taxReport({ from, to })), from, to });
}));

router.get('/hourly', asyncHandler(async (req, res) => {
  const { from, to } = rangeFromQuery(req.query, 1);
  res.json({ hours: await hourlySales({ from, to }), from, to });
}));

router.get('/inventory-valuation', asyncHandler(async (req, res) => {
  res.json(await inventoryValuation({ location_id: req.query.location_id }));
}));

router.get('/stock-movements', asyncHandler(async (req, res) => {
  res.json({
    movements: await stockMovements({
      product_id: req.query.product_id, from: req.query.from, to: req.query.to, limit: req.query.limit,
    }),
  });
}));

router.get('/customer-balances', asyncHandler(async (req, res) => {
  res.json({ customers: await customerBalances() });
}));

router.get('/supplier-balances', asyncHandler(async (req, res) => {
  res.json({ suppliers: await supplierBalances() });
}));

router.get('/ar-aging', asyncHandler(async (req, res) => {
  res.json({ aging: await arAging() });
}));

router.get('/ap-aging', asyncHandler(async (req, res) => {
  res.json({ aging: await apAging() });
}));

router.get('/cash-flow', asyncHandler(async (req, res) => {
  const { from, to } = rangeFromQuery(req.query, 30);
  res.json(await cashFlow({ from, to }));
}));

router.get('/z-report/:sessionId', asyncHandler(async (req, res) => {
  const id = Number(req.params.sessionId);
  const summary = await sessionSummary({ query: (t, p) => query(t, p) }, id);
  res.json({ report: summary });
}));

export default router;
