import { Router } from 'express';
import { query, withTransaction } from '../db/index.js';
import { requireRole } from '../middleware/auth.js';
import { getMappings, postJournal } from '../services/accounting.js';
import { applyStockIn, applyStockOut } from '../services/inventory.js';
import { nextDoc } from '../services/documents.js';
import { stockMovements } from '../services/reports.js';
import { audit, asyncHandler, assert, num, requireFields, round2, todayISO } from '../utils.js';

const router = Router();

router.get('/inventory', asyncHandler(async (req, res) => {
  const params = [];
  const where = ['p.is_active = true'];
  if (req.query.location_id) { params.push(Number(req.query.location_id)); where.push(`i.location_id = $${params.length}`); }
  if (req.query.search) {
    params.push(`%${req.query.search}%`);
    where.push(`(p.name ILIKE $${params.length} OR p.sku ILIKE $${params.length})`);
  }
  if (req.query.low_stock === 'true') where.push('i.quantity <= p.reorder_level');
  if (req.query.category_id) { params.push(Number(req.query.category_id)); where.push(`p.category_id = $${params.length}`); }
  const { rows } = await query(
    `SELECT i.product_id, i.location_id, i.quantity, i.avg_cost,
            ROUND(i.quantity * i.avg_cost,2) AS cost_value,
            ROUND(i.quantity * p.sale_price,2) AS retail_value,
            p.name, p.sku, p.barcode, p.sale_price, p.reorder_level, p.track_inventory,
            c.name AS category_name, l.name AS location_name,
            CASE WHEN i.quantity <= p.reorder_level THEN true ELSE false END AS low_stock
     FROM inventory i JOIN products p ON p.id = i.product_id JOIN locations l ON l.id = i.location_id
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE ${where.join(' AND ')} ORDER BY p.name`,
    params
  );
  res.json({ inventory: rows });
}));

router.get('/inventory/movements', asyncHandler(async (req, res) => {
  res.json({ movements: await stockMovements({
    product_id: req.query.product_id, from: req.query.from, to: req.query.to, limit: req.query.limit,
  }) });
}));

router.get('/inventory/transfers', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT t.*, f.name AS from_location, d.name AS to_location, u.name AS user_name,
       (SELECT COUNT(*)::int FROM stock_transfer_items ti WHERE ti.transfer_id = t.id) AS item_count,
       (SELECT COALESCE(SUM(quantity),0) FROM stock_transfer_items ti WHERE ti.transfer_id = t.id) AS total_quantity
     FROM stock_transfers t JOIN locations f ON f.id = t.from_location_id JOIN locations d ON d.id = t.to_location_id
     LEFT JOIN users u ON u.id = t.user_id ORDER BY t.created_at DESC LIMIT 100`
  );
  res.json({ transfers: rows });
}));

router.post('/inventory/adjust', requireRole('admin', 'manager', 'storekeeper'), asyncHandler(async (req, res) => {
  const b = req.body || {};
  requireFields(b, ['product_id', 'quantity_delta', 'reason']);
  const delta = num(b.quantity_delta);
  assert(delta !== 0, 400, 'Adjustment quantity cannot be zero');
  const locationId = Number(b.location_id || req.user.location_id);
  assert(locationId, 400, 'Location is required');

  const result = await withTransaction(async (client) => {
    const { rows: products } = await client.query('SELECT * FROM products WHERE id = $1 AND is_active = true FOR UPDATE', [b.product_id]);
    assert(products.length, 404, 'Product not found');
    const product = products[0];
    assert(product.track_inventory, 400, 'This product does not track inventory');
    assert(!(delta < 0) || b.reason, 400, 'A reason is required for stock reductions');

    let value;
    let stock;
    if (delta > 0) {
      const unitCost = round2(num(b.unit_cost || product.cost_price));
      stock = await applyStockIn(client, {
        productId: product.id, locationId, quantity: delta, unitCost,
        type: 'adjustment', refType: 'adjustment', userId: req.user.id, note: b.reason,
      });
      value = round2(delta * unitCost);
    } else {
      stock = await applyStockOut(client, {
        productId: product.id, locationId, quantity: Math.abs(delta),
        type: 'adjustment', refType: 'adjustment', userId: req.user.id, note: b.reason,
        allowNegative: true,
      });
      value = stock.costTotal;
    }

    if (value > 0) {
      const maps = await getMappings(client);
      await postJournal(client, {
        date: b.date || todayISO(),
        memo: `Stock adjustment — ${product.name}: ${b.reason}`,
        sourceType: 'stock_adjustment', sourceId: product.id,
        locationId, userId: req.user.id,
        lines: delta > 0
          ? [
            { account_id: maps.inventory, debit: value, description: `Stock increase — ${product.name}` },
            { account_id: maps.inventory_adjustment, credit: value, description: `Adjustment gain — ${b.reason}` },
          ]
          : [
            { account_id: maps.inventory_adjustment, debit: value, description: `Adjustment loss — ${b.reason}` },
            { account_id: maps.inventory, credit: value, description: `Stock decrease — ${product.name}` },
          ],
      });
    }
    await audit(client, req, 'inventory.adjust', 'product', product.id, { delta, locationId, reason: b.reason });
    return { product: product.name, delta, quantity: stock.quantity, value };
  });

  res.json({ adjustment: result });
}));

router.post('/inventory/transfer', requireRole('admin', 'manager', 'storekeeper'), asyncHandler(async (req, res) => {
  const b = req.body || {};
  const from = Number(b.from_location_id);
  const to = Number(b.to_location_id);
  requireFields(b, ['from_location_id', 'to_location_id', 'items']);
  assert(from && to && from !== to, 400, 'Choose two different locations');
  assert(Array.isArray(b.items) && b.items.length > 0, 400, 'Add at least one item');

  const transfer = await withTransaction(async (client) => {
    const transferNo = await nextDoc(client, 'transfer', 'TRF');
    const { rows } = await client.query(
      `INSERT INTO stock_transfers (transfer_no, from_location_id, to_location_id, notes, user_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [transferNo, from, to, b.notes || null, req.user.id]
    );
    const t = rows[0];
    for (const item of b.items) {
      const qty = num(item.quantity);
      assert(qty > 0, 400, 'Transfer quantity must be greater than zero');
      const { rows: prod } = await client.query('SELECT * FROM products WHERE id = $1 AND is_active = true', [item.product_id]);
      assert(prod.length, 404, 'Product not found');
      assert(prod[0].track_inventory, 400, `${prod[0].name} does not track inventory`);
      const out = await applyStockOut(client, {
        productId: prod[0].id, locationId: from, quantity: qty, type: 'transfer_out',
        refType: 'transfer', refId: t.id, userId: req.user.id, note: transferNo,
      });
      await applyStockIn(client, {
        productId: prod[0].id, locationId: to, quantity: qty, unitCost: out.unitCost,
        type: 'transfer_in', refType: 'transfer', refId: t.id, userId: req.user.id, note: transferNo,
      });
      await client.query(
        'INSERT INTO stock_transfer_items (transfer_id, product_id, quantity, unit_cost) VALUES ($1,$2,$3,$4)',
        [t.id, prod[0].id, qty, out.unitCost]
      );
    }
    await audit(client, req, 'inventory.transfer', 'stock_transfer', t.id, { transferNo, from, to });
    return t;
  });
  res.status(201).json({ transfer });
}));

export default router;
