import { Router } from 'express';
import { requireRole } from '../middleware/auth.js';
import {
  createPurchase, getPurchaseDetail, listPurchases, paySupplier,
} from '../services/purchases.js';
import { asyncHandler } from '../utils.js';

const router = Router();

router.get('/purchases', asyncHandler(async (req, res) => {
  res.json(await listPurchases(req.query));
}));

router.post('/purchases', requireRole('admin', 'manager', 'storekeeper', 'accountant'), asyncHandler(async (req, res) => {
  res.status(201).json({ purchase: await createPurchase(req.user, req.body || {}) });
}));

router.get('/purchases/:id', asyncHandler(async (req, res) => {
  res.json({ purchase: await getPurchaseDetail(null, Number(req.params.id)) });
}));

router.post('/purchases/:id/pay', requireRole('admin', 'manager', 'accountant'), asyncHandler(async (req, res) => {
  const purchase = await getPurchaseDetail(null, Number(req.params.id));
  const result = await paySupplier(req.user, {
    ...req.body,
    supplier_id: purchase.supplier_id,
    purchase_id: purchase.id,
  });
  res.status(201).json({ payment: result });
}));

router.post('/supplier-payments', requireRole('admin', 'manager', 'accountant'), asyncHandler(async (req, res) => {
  res.status(201).json({ payment: await paySupplier(req.user, req.body || {}) });
}));

export default router;
