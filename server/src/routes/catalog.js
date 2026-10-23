import { Router } from 'express';
import { query, withTransaction } from '../db/index.js';
import { requireRole } from '../middleware/auth.js';
import { getMappings, postJournal } from '../services/accounting.js';
import { applyStockIn } from '../services/inventory.js';
import { nextDoc } from '../services/documents.js';
import { audit, asyncHandler, assert, num, requireFields, round2 } from '../utils.js';

const router = Router();
const manager = requireRole('admin', 'manager');

/* ------------------------------- products ------------------------------- */

router.get('/products', asyncHandler(async (req, res) => {
  const { search, category_id, barcode, include_inactive, low_stock } = req.query;
  const locationId = Number(req.query.location_id || req.user.location_id || 0);
  const params = [];
  const where = [];
  if (!include_inactive) where.push('p.is_active = true');
  if (search) {
    params.push(`%${search}%`);
    where.push(`(p.name ILIKE $${params.length} OR p.sku ILIKE $${params.length} OR p.barcode ILIKE $${params.length})`);
  }
  if (barcode) { params.push(barcode); where.push(`p.barcode = $${params.length}`); }
  if (category_id) { params.push(Number(category_id)); where.push(`p.category_id = $${params.length}`); }
  if (low_stock === 'true') where.push('i.quantity <= p.reorder_level');
  params.push(locationId);
  const { rows } = await query(
    `SELECT p.*, c.name AS category_name, u.short_name AS unit_short,
            tr.rate AS tax_rate, tr.is_inclusive,
            COALESCE(i.quantity,0) AS quantity, COALESCE(i.avg_cost,0) AS avg_cost
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     LEFT JOIN units u ON u.id = p.unit_id
     LEFT JOIN tax_rates tr ON tr.id = p.tax_rate_id
     LEFT JOIN inventory i ON i.product_id = p.id AND i.location_id = $${params.length}
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY p.name LIMIT 1000`,
    params
  );
  res.json({ products: rows });
}));

router.get('/products/barcode/:code', asyncHandler(async (req, res) => {
  const locationId = Number(req.query.location_id || req.user.location_id || 0);
  const { rows } = await query(
    `SELECT p.*, tr.rate AS tax_rate, tr.is_inclusive,
            COALESCE(i.quantity,0) AS quantity, COALESCE(i.avg_cost,0) AS avg_cost
     FROM products p LEFT JOIN tax_rates tr ON tr.id = p.tax_rate_id
     LEFT JOIN inventory i ON i.product_id = p.id AND i.location_id = $2
     WHERE (p.barcode = $1 OR p.sku = $1) AND p.is_active = true`,
    [req.params.code, locationId]
  );
  assert(rows.length, 404, 'Product not found for that barcode');
  res.json({ product: rows[0] });
}));

router.post('/products', requireRole('admin', 'manager', 'storekeeper'), asyncHandler(async (req, res) => {
  const b = req.body || {};
  requireFields(b, ['name']);
  const product = await withTransaction(async (client) => {
    const sku = b.sku || await nextDoc(client, 'product', 'SKU');
    const { rows } = await client.query(
      `INSERT INTO products (sku, barcode, name, description, category_id, unit_id, cost_price, sale_price,
         tax_rate_id, track_inventory, reorder_level, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        sku, b.barcode || null, b.name, b.description || null, b.category_id || null, b.unit_id || null,
        num(b.cost_price), num(b.sale_price), b.tax_rate_id || null,
        b.track_inventory !== false, num(b.reorder_level), b.is_active !== false,
      ]
    );
    const p = rows[0];
    const locationId = Number(b.location_id || req.user.location_id || 1);
    if (p.track_inventory && num(b.opening_stock) > 0) {
      await applyStockIn(client, {
        productId: p.id, locationId, quantity: num(b.opening_stock), unitCost: num(b.cost_price),
        type: 'opening', refType: 'product', refId: p.id, userId: req.user.id, note: 'Opening stock',
      });
      const maps = await getMappings(client);
      const value = round2(num(b.opening_stock) * num(b.cost_price));
      if (value > 0) {
        await postJournal(client, {
          date: b.opening_date || new Date().toISOString().slice(0, 10),
          memo: `Opening stock — ${p.name}`,
          sourceType: 'opening_stock', sourceId: p.id, locationId, userId: req.user.id,
          lines: [
            { account_id: maps.inventory, debit: value, description: `Opening inventory — ${p.name}` },
            { account_id: maps.opening_balance_equity, credit: value, description: `Opening balance — ${p.name}` },
          ],
        });
      }
    }
    await audit(client, req, 'product.create', 'product', p.id, { name: p.name, sku: p.sku });
    return p;
  });
  res.status(201).json({ product });
}));

router.put('/products/:id', requireRole('admin', 'manager', 'storekeeper'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const b = req.body || {};
  const { rows: oldRows } = await query('SELECT * FROM products WHERE id = $1', [id]);
  assert(oldRows.length, 404, 'Product not found');
  const o = oldRows[0];
  const { rows } = await query(
    `UPDATE products SET sku=$1, barcode=$2, name=$3, description=$4, category_id=$5, unit_id=$6,
       cost_price=$7, sale_price=$8, tax_rate_id=$9, track_inventory=$10, reorder_level=$11,
       is_active=$12, updated_at=now()
     WHERE id=$13 RETURNING *`,
    [
      b.sku ?? o.sku, b.barcode === undefined ? o.barcode : b.barcode, b.name ?? o.name,
      b.description ?? o.description, b.category_id === undefined ? o.category_id : b.category_id,
      b.unit_id === undefined ? o.unit_id : b.unit_id, num(b.cost_price ?? o.cost_price),
      num(b.sale_price ?? o.sale_price), b.tax_rate_id === undefined ? o.tax_rate_id : b.tax_rate_id,
      b.track_inventory ?? o.track_inventory, num(b.reorder_level ?? o.reorder_level),
      b.is_active ?? o.is_active, id,
    ]
  );
  res.json({ product: rows[0] });
}));

router.delete('/products/:id', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
  const { rows } = await query('UPDATE products SET is_active = false WHERE id = $1 RETURNING id', [Number(req.params.id)]);
  assert(rows.length, 404, 'Product not found');
  res.json({ ok: true });
}));

/* ------------------------------ categories ------------------------------ */

router.get('/categories', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT c.*, (SELECT COUNT(*)::int FROM products p WHERE p.category_id = c.id AND p.is_active = true) AS product_count
     FROM categories c ORDER BY c.name`
  );
  res.json({ categories: rows });
}));
router.post('/categories', manager, asyncHandler(async (req, res) => {
  requireFields(req.body || {}, ['name']);
  const { rows } = await query('INSERT INTO categories (name, parent_id) VALUES ($1,$2) RETURNING *', [
    req.body.name, req.body.parent_id || null,
  ]);
  res.status(201).json({ category: rows[0] });
}));
router.put('/categories/:id', manager, asyncHandler(async (req, res) => {
  const { rows } = await query('UPDATE categories SET name=$1, is_active=$2 WHERE id=$3 RETURNING *', [
    req.body.name, req.body.is_active !== false, Number(req.params.id),
  ]);
  assert(rows.length, 404, 'Category not found');
  res.json({ category: rows[0] });
}));

/* --------------------------------- units -------------------------------- */

router.get('/units', asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM units ORDER BY name');
  res.json({ units: rows });
}));
router.post('/units', manager, asyncHandler(async (req, res) => {
  requireFields(req.body || {}, ['name', 'short_name']);
  const { rows } = await query('INSERT INTO units (name, short_name) VALUES ($1,$2) RETURNING *', [
    req.body.name, req.body.short_name,
  ]);
  res.status(201).json({ unit: rows[0] });
}));

/* ------------------------------- tax rates ------------------------------ */

router.get('/tax-rates', asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM tax_rates ORDER BY rate DESC');
  res.json({ tax_rates: rows });
}));
router.post('/tax-rates', manager, asyncHandler(async (req, res) => {
  requireFields(req.body || {}, ['name', 'rate']);
  const { rows } = await query(
    'INSERT INTO tax_rates (name, rate, is_inclusive, is_active) VALUES ($1,$2,$3,$4) RETURNING *',
    [req.body.name, num(req.body.rate), !!req.body.is_inclusive, req.body.is_active !== false]
  );
  res.status(201).json({ tax_rate: rows[0] });
}));
router.put('/tax-rates/:id', manager, asyncHandler(async (req, res) => {
  const { rows } = await query(
    'UPDATE tax_rates SET name=$1, rate=$2, is_inclusive=$3, is_active=$4 WHERE id=$5 RETURNING *',
    [req.body.name, num(req.body.rate), !!req.body.is_inclusive, req.body.is_active !== false, Number(req.params.id)]
  );
  assert(rows.length, 404, 'Tax rate not found');
  res.json({ tax_rate: rows[0] });
}));

/* ---------------------------- payment methods --------------------------- */

router.get('/payment-methods', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT pm.*, a.code AS account_code, a.name AS account_name
     FROM payment_methods pm JOIN accounts a ON a.id = pm.account_id
     ORDER BY pm.id`
  );
  res.json({ payment_methods: rows });
}));
router.post('/payment-methods', manager, asyncHandler(async (req, res) => {
  const b = req.body || {};
  requireFields(b, ['code', 'name', 'type', 'account_id']);
  assert(['cash', 'bank', 'card', 'wallet'].includes(b.type), 400, 'Invalid payment type');
  const { rows } = await query(
    `INSERT INTO payment_methods (code, name, type, account_id, requires_reference, is_active)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [b.code, b.name, b.type, Number(b.account_id), !!b.requires_reference, b.is_active !== false]
  );
  res.status(201).json({ payment_method: rows[0] });
}));
router.put('/payment-methods/:id', manager, asyncHandler(async (req, res) => {
  const { rows } = await query(
    `UPDATE payment_methods SET code=$1, name=$2, type=$3, account_id=$4, requires_reference=$5, is_active=$6
     WHERE id=$7 RETURNING *`,
    [req.body.code, req.body.name, req.body.type, Number(req.body.account_id), !!req.body.requires_reference, req.body.is_active !== false, Number(req.params.id)]
  );
  assert(rows.length, 404, 'Payment method not found');
  res.json({ payment_method: rows[0] });
}));

/* ------------------------------- locations ------------------------------ */

router.get('/locations', asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM locations ORDER BY name');
  res.json({ locations: rows });
}));
router.post('/locations', manager, asyncHandler(async (req, res) => {
  const b = req.body || {};
  requireFields(b, ['code', 'name']);
  const { rows } = await query(
    'INSERT INTO locations (code, name, type, address, phone, is_active) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [b.code, b.name, b.type || 'store', b.address || null, b.phone || null, b.is_active !== false]
  );
  res.status(201).json({ location: rows[0] });
}));
router.put('/locations/:id', manager, asyncHandler(async (req, res) => {
  const b = req.body || {};
  const { rows } = await query(
    'UPDATE locations SET code=$1, name=$2, type=$3, address=$4, phone=$5, is_active=$6 WHERE id=$7 RETURNING *',
    [b.code, b.name, b.type, b.address || null, b.phone || null, b.is_active !== false, Number(req.params.id)]
  );
  assert(rows.length, 404, 'Location not found');
  res.json({ location: rows[0] });
}));

export default router;
