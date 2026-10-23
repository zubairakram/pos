import { assert, num, round2, round4 } from '../utils.js';

async function lockInventory(client, productId, locationId) {
  await client.query(
    `INSERT INTO inventory (product_id, location_id, quantity, avg_cost)
     VALUES ($1,$2,0,0) ON CONFLICT (product_id, location_id) DO NOTHING`,
    [productId, locationId]
  );
  const { rows } = await client.query(
    'SELECT * FROM inventory WHERE product_id = $1 AND location_id = $2 FOR UPDATE',
    [productId, locationId]
  );
  return rows[0];
}

export async function applyStockIn(client, {
  productId, locationId, quantity, unitCost, type, refType, refId, userId, note,
}) {
  const qty = num(quantity);
  assert(qty > 0, 400, 'Stock-in quantity must be positive');
  const cost = round4(unitCost || 0);
  const inv = await lockInventory(client, productId, locationId);
  const oldQty = num(inv.quantity);
  const oldAvg = num(inv.avg_cost);
  const newQty = round4(oldQty + qty);
  const newAvg = newQty > 0 ? round4((oldQty * oldAvg + qty * cost) / newQty) : cost;

  await client.query(
    'UPDATE inventory SET quantity = $1, avg_cost = $2 WHERE product_id = $3 AND location_id = $4',
    [newQty, newAvg, productId, locationId]
  );
  await client.query(
    `INSERT INTO stock_moves (product_id, location_id, type, quantity, unit_cost, total_cost, ref_type, ref_id, note, user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [productId, locationId, type, qty, cost, round2(qty * cost), refType || null, refId || null, note || null, userId || null]
  );
  return { quantity: newQty, avgCost: newAvg, oldQty, oldAvg };
}

export async function applyStockOut(client, {
  productId, locationId, quantity, type, refType, refId, userId, note, allowNegative = false,
}) {
  const qty = num(quantity);
  assert(qty > 0, 400, 'Stock-out quantity must be positive');
  const inv = await lockInventory(client, productId, locationId);
  const oldQty = num(inv.quantity);
  assert(allowNegative || oldQty + 0.0001 >= qty, 400, `Insufficient stock. Available: ${oldQty}`);

  const unitCost = round4(num(inv.avg_cost));
  const newQty = round4(oldQty - qty);
  await client.query(
    'UPDATE inventory SET quantity = $1 WHERE product_id = $2 AND location_id = $3',
    [newQty, productId, locationId]
  );
  await client.query(
    `INSERT INTO stock_moves (product_id, location_id, type, quantity, unit_cost, total_cost, ref_type, ref_id, note, user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [productId, locationId, type, -qty, unitCost, round2(qty * unitCost), refType || null, refId || null, note || null, userId || null]
  );
  return { unitCost, costTotal: round2(qty * unitCost), quantity: newQty, oldQty };
}

export async function getStock(client, productId, locationId) {
  const { rows } = await client.query(
    `SELECT i.*, p.name, p.sku FROM inventory i JOIN products p ON p.id = i.product_id
     WHERE i.product_id = $1 AND i.location_id = $2`,
    [productId, locationId]
  );
  return rows[0] || null;
}
