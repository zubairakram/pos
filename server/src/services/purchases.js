import { query, withTransaction } from '../db/index.js';
import { getMappings, postJournal } from './accounting.js';
import { applyStockIn } from './inventory.js';
import { getSession, recordCashMovement } from './cash.js';
import { getSettings } from './settings.js';
import { nextDoc } from './documents.js';
import {
  ApiError, addDaysISO, assert, audit, num, round2, round4, todayISO,
} from '../utils.js';

function methodAccount(method, session) {
  return method.type === 'cash' && session ? session.account_id : method.account_id;
}

export async function createPurchase(user, input) {
  return withTransaction(async (client) => {
    const settings = await getSettings(client);
    const locationId = Number(input.location_id || user.location_id);
    assert(locationId, 400, 'Location is required');
    const { rows: supplierRows } = await client.query(
      'SELECT * FROM suppliers WHERE id = $1 AND is_active = true',
      [input.supplier_id]
    );
    assert(supplierRows.length, 400, 'Supplier not found or inactive');
    const supplier = supplierRows[0];

    const rawItems = Array.isArray(input.items) ? input.items : [];
    assert(rawItems.length, 400, 'A purchase needs at least one item');
    const date = input.date ? String(input.date).slice(0, 10) : todayISO();

    const computed = [];
    let subtotal = 0;
    let taxTotal = 0;
    for (const item of rawItems) {
      const productId = Number(item.product_id);
      const qty = num(item.quantity);
      assert(productId, 400, 'Each purchase line needs a product');
      assert(qty > 0, 400, 'Purchase quantity must be greater than zero');
      const { rows } = await client.query(
        `SELECT p.*, tr.rate AS tax_rate_value FROM products p
         LEFT JOIN tax_rates tr ON tr.id = p.tax_rate_id WHERE p.id = $1 FOR UPDATE OF p`,
        [productId]
      );
      assert(rows.length, 400, `Product ${productId} not found`);
      const p = rows[0];
      const unitCost = round4(item.unit_cost ?? p.cost_price);
      assert(unitCost >= 0, 400, 'Unit cost cannot be negative');
      const discount = round2(item.discount || 0);
      assert(discount >= 0, 400, 'Discount cannot be negative');
      const net = round2(qty * unitCost - discount);
      assert(net >= 0, 400, 'Discount exceeds the line amount');
      const rate = item.tax_rate !== undefined ? num(item.tax_rate) : num(p.tax_rate_value);
      const tax = round2(net * (rate / 100));
      const lineTotal = round2(net + tax);
      subtotal = round2(subtotal + net);
      taxTotal = round2(taxTotal + tax);
      computed.push({ product: p, qty, unitCost, discount, rate, tax, net, lineTotal });
    }

    const orderDiscount = round2(input.discount || 0);
    assert(orderDiscount >= 0, 400, 'Discount cannot be negative');
    assert(orderDiscount <= round2(subtotal + taxTotal), 400, 'Discount exceeds the purchase total');
    const total = round2(subtotal + taxTotal - orderDiscount);
    const inventoryValue = round2(subtotal - orderDiscount);

    const billNo = input.bill_no || await nextDoc(client, 'purchase', settings.pos.purchase_prefix, new Date(`${date}T12:00:00Z`));
    const { rows: purRows } = await client.query(
      `INSERT INTO purchases (bill_no, supplier_id, location_id, user_id, status, subtotal, discount, tax,
         total, paid, due, due_date, notes, created_at, received_at)
       VALUES ($1,$2,$3,$4,'received',$5,$6,$7,$8,0,$8,$9,$10,$11,now()) RETURNING *`,
      [
        billNo, supplier.id, locationId, user.id, subtotal, orderDiscount, taxTotal, total,
        input.due_date || addDaysISO(date, num(settings.pos.default_due_days) || 30),
        input.notes || null,
        input.created_at || `${date}T${new Date().toISOString().slice(11, 19)}Z`,
      ]
    );
    const purchase = purRows[0];

    for (const line of computed) {
      await client.query(
        `INSERT INTO purchase_items (purchase_id, product_id, description, quantity, unit_cost, discount,
           tax_rate, tax_amount, line_total)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [purchase.id, line.product.id, line.product.name, line.qty, line.unitCost, line.discount, line.rate, line.tax, line.lineTotal]
      );
      if (line.product.track_inventory) {
        await applyStockIn(client, {
          productId: line.product.id,
          locationId,
          quantity: line.qty,
          unitCost: line.unitCost,
          type: 'purchase',
          refType: 'purchase',
          refId: purchase.id,
          userId: user.id,
          note: `Purchase ${billNo}`,
        });
      }
      await client.query('UPDATE products SET cost_price = $1, updated_at = now() WHERE id = $2', [
        line.unitCost,
        line.product.id,
      ]);
    }

    const maps = await getMappings(client);
    const lines = [
      { account_id: maps.inventory, debit: inventoryValue, description: `Inventory — ${billNo}` },
    ];
    if (taxTotal > 0) lines.push({ account_id: maps.tax_receivable, debit: taxTotal, description: `Input tax — ${billNo}` });
    lines.push({ account_id: maps.ap, credit: total, description: `AP — ${supplier.name}`, supplier_id: supplier.id });
    await postJournal(client, {
      date,
      memo: `Purchase ${billNo} — ${supplier.name}`,
      sourceType: 'purchase',
      sourceId: purchase.id,
      locationId,
      userId: user.id,
      lines,
    });

    await audit(client, { user }, 'purchase.create', 'purchase', purchase.id, { billNo, total });
    return getPurchaseDetail(client, purchase.id);
  });
}

export async function getPurchaseDetail(clientOrNull, id) {
  const runner = clientOrNull || { query: (t, p) => query(t, p) };
  const { rows } = await runner.query(
    `SELECT p.*, s.name AS supplier_name, s.phone AS supplier_phone, u.name AS user_name, l.name AS location_name
     FROM purchases p JOIN suppliers s ON s.id = p.supplier_id
     JOIN users u ON u.id = p.user_id JOIN locations l ON l.id = p.location_id
     WHERE p.id = $1`,
    [id]
  );
  if (!rows.length) throw new ApiError(404, 'Purchase not found');
  const { rows: items } = await runner.query(
    `SELECT pi.*, pr.sku FROM purchase_items pi JOIN products pr ON pr.id = pi.product_id
     WHERE pi.purchase_id = $1 ORDER BY pi.id`,
    [id]
  );
  const { rows: payments } = await runner.query(
    `SELECT p.*, pm.name AS method_name FROM payments p JOIN payment_methods pm ON pm.id = p.method_id
     WHERE p.purchase_id = $1 ORDER BY p.id`,
    [id]
  );
  return { ...rows[0], items, payments };
}

export async function listPurchases(filters = {}) {
  const where = [];
  const params = [];
  const add = (sql, value) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (filters.from) add('p.created_at >= ?::date', filters.from);
  if (filters.to) add("p.created_at < (?::date + interval '1 day')", filters.to);
  if (filters.supplier_id) add('p.supplier_id = ?', Number(filters.supplier_id));
  if (filters.status) add('p.status = ?', filters.status);
  if (filters.q) {
    params.push(`%${filters.q}%`);
    where.push(`(p.bill_no ILIKE $${params.length} OR s.name ILIKE $${params.length})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(Number(filters.limit) || 50, 500);
  const offset = Math.max(Number(filters.offset) || 0, 0);
  const [{ rows }, { rows: totals }] = await Promise.all([
    query(
      `SELECT p.*, s.name AS supplier_name, l.name AS location_name, u.name AS user_name
       FROM purchases p JOIN suppliers s ON s.id = p.supplier_id
       JOIN locations l ON l.id = p.location_id JOIN users u ON u.id = p.user_id
       ${whereSql} ORDER BY p.created_at DESC, p.id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    ),
    query(
      `SELECT COUNT(*)::int AS count, COALESCE(SUM(p.total),0) AS total,
              COALESCE(SUM(p.paid),0) AS paid, COALESCE(SUM(p.due),0) AS due
       FROM purchases p JOIN suppliers s ON s.id = p.supplier_id ${whereSql}`,
      params
    ),
  ]);
  return { purchases: rows, totals: totals[0], limit, offset };
}

export async function paySupplier(user, input) {
  return withTransaction(async (client) => {
    const supplierId = Number(input.supplier_id);
    const amount = round2(input.amount);
    assert(supplierId, 400, 'Supplier is required');
    assert(amount > 0, 400, 'Amount must be greater than zero');
    const { rows: supRows } = await client.query('SELECT * FROM suppliers WHERE id = $1 AND is_active = true', [supplierId]);
    assert(supRows.length, 404, 'Supplier not found');
    const supplier = supRows[0];
    const { rows: methodRows } = await client.query('SELECT * FROM payment_methods WHERE id = $1 AND is_active = true', [input.method_id]);
    assert(methodRows.length, 400, 'Invalid payment method');
    const method = methodRows[0];

    let session = null;
    if (method.type === 'cash') {
      const locationId = Number(input.location_id || user.location_id);
      assert(input.session_id, 400, 'Open a cash drawer session before paying cash');
      session = await getSession(client, input.session_id, true);
      assert(session, 404, 'Cash session not found');
      assert(session.status === 'open', 400, 'Cash session is closed');
      assert(session.register_location_id === locationId, 400, 'Cash drawer belongs to another location');
    }

    const { rows: openPurchases } = await client.query(
      `SELECT * FROM purchases WHERE supplier_id = $1 AND due > 0 AND status = 'received'
       ORDER BY created_at, id ${input.purchase_id ? 'FOR UPDATE' : ''}`,
      [supplierId]
    );
    let unallocated = amount;
    const allocations = [];
    const ordered = input.purchase_id ? openPurchases.filter((p) => p.id === Number(input.purchase_id)) : openPurchases;
    for (const pur of ordered) {
      if (unallocated <= 0) break;
      const apply = round2(Math.min(unallocated, num(pur.due)));
      if (apply <= 0) continue;
      await client.query('UPDATE purchases SET paid = paid + $1, due = due - $1 WHERE id = $2', [apply, pur.id]);
      allocations.push({ purchase_id: pur.id, bill_no: pur.bill_no, amount: apply });
      unallocated = round2(unallocated - apply);
    }

    for (const a of allocations) {
      await client.query(
        `INSERT INTO payments (type, method_id, amount, reference, purchase_id, supplier_id, session_id, user_id)
         VALUES ('supplier_payment',$1,$2,$3,$4,$5,$6,$7)`,
        [method.id, a.amount, input.reference || null, a.purchase_id, supplierId, session?.id || null, user.id]
      );
    }

    const maps = await getMappings(client);
    await postJournal(client, {
      date: input.date || todayISO(),
      memo: `Supplier payment — ${supplier.name}`,
      sourceType: 'supplier_payment',
      sourceId: supplierId,
      locationId: Number(input.location_id || user.location_id),
      userId: user.id,
      lines: [
        { account_id: maps.ap, debit: amount, description: `AP — ${supplier.name}`, supplier_id: supplierId },
        { account_id: methodAccount(method, session), credit: amount, description: `Payment — ${supplier.name}` },
      ],
    });

    if (method.type === 'cash' && session) {
      await recordCashMovement(client, {
        sessionId: session.id,
        type: 'payment',
        amount: -amount,
        reason: `Supplier payment — ${supplier.name}`,
        refType: 'supplier_payment',
        refId: supplierId,
        userId: user.id,
      });
    }

    await audit(client, { user }, 'supplier.payment', 'supplier', supplierId, { amount, allocations });
    return { amount, allocations, unallocated, supplier_id: supplierId };
  });
}
