import { query, withTransaction } from '../db/index.js';
import { getMappings, mapping, postJournal, reverseJournalsFor } from './accounting.js';
import { applyStockIn, applyStockOut } from './inventory.js';
import { getOpenSession, getSession, recordCashMovement } from './cash.js';
import { getSettings } from './settings.js';
import { nextDoc } from './documents.js';
import {
  ApiError, addDaysISO, assert, audit, num, round2, round4, todayISO,
} from '../utils.js';

function methodAccount(method, session) {
  return method.type === 'cash' && session ? session.account_id : method.account_id;
}

async function loadMethods(client, ids) {
  const unique = [...new Set(ids)];
  if (!unique.length) return {};
  const { rows } = await client.query(
    'SELECT * FROM payment_methods WHERE id = ANY($1::int[]) AND is_active = true',
    [unique]
  );
  return Object.fromEntries(rows.map((r) => [r.id, r]));
}

async function assertCashSession(client, sessionId, user, locationId, { required = false } = {}) {
  if (!sessionId) {
    assert(!required, 400, 'Open a cash drawer session before taking cash');
    return null;
  }
  const session = await getSession(client, sessionId, true);
  assert(session, 404, 'Cash session not found');
  assert(session.status === 'open', 400, 'This cash session is already closed');
  assert(session.register_location_id === locationId, 400, 'Cash drawer belongs to a different location');
  if (user.role === 'cashier') {
    assert(session.user_id === user.id, 403, 'You can only use your own cash drawer session');
  }
  return session;
}

function saleDetailSql() {
  return `
    SELECT s.*,
      c.name AS customer_name, c.phone AS customer_phone, c.email AS customer_email,
      u.name AS cashier_name, l.name AS location_name,
      r.name AS register_name
    FROM sales s
    LEFT JOIN customers c ON c.id = s.customer_id
    JOIN users u ON u.id = s.user_id
    JOIN locations l ON l.id = s.location_id
    LEFT JOIN cash_sessions cs ON cs.id = s.session_id
    LEFT JOIN cash_registers r ON r.id = cs.register_id
  `;
}

export async function getSaleDetail(clientOrNull, saleId) {
  const runner = clientOrNull || { query: (t, p) => query(t, p) };
  const { rows } = await runner.query(`${saleDetailSql()} WHERE s.id = $1`, [saleId]);
  if (!rows.length) throw new ApiError(404, 'Sale not found');
  const sale = rows[0];

  const { rows: items } = await runner.query(
    `SELECT si.*, p.sku, p.barcode, p.name AS product_name,
       COALESCE((SELECT SUM(ri.quantity) FROM return_items ri WHERE ri.sale_item_id = si.id), 0) AS returned_qty
     FROM sale_items si LEFT JOIN products p ON p.id = si.product_id
     WHERE si.sale_id = $1 ORDER BY si.id`,
    [saleId]
  );
  const { rows: payments } = await runner.query(
    `SELECT p.*, pm.name AS method_name, pm.type AS method_type
     FROM payments p JOIN payment_methods pm ON pm.id = p.method_id
     WHERE p.sale_id = $1 AND p.type = 'sale' ORDER BY p.id`,
    [saleId]
  );
  const { rows: returns } = await runner.query(
    `SELECT r.*, u.name AS user_name, pm.name AS method_name
     FROM sale_returns r JOIN users u ON u.id = r.user_id
     LEFT JOIN payment_methods pm ON pm.id = r.method_id
     WHERE r.sale_id = $1 ORDER BY r.id`,
    [saleId]
  );
  const { rows: journal } = await runner.query(
    `SELECT je.id, je.entry_no, je.entry_date, je.memo, je.source_type,
            SUM(jl.debit) AS total_debit, SUM(jl.credit) AS total_credit
     FROM journal_entries je JOIN journal_lines jl ON jl.entry_id = je.id
     WHERE (je.source_type = 'sale' AND je.source_id = $1)
        OR (je.source_type IN ('sale_return','sale_void') AND je.source_id IN (
             SELECT id FROM sale_returns WHERE sale_id = $1
           ))
     GROUP BY je.id ORDER BY je.id`,
    [saleId]
  );
  return { ...sale, items, payments, returns, journal };
}

export async function createSale(user, input) {
  return withTransaction(async (client) => {
    const settings = await getSettings(client);
    const locationId = Number(input.location_id || user.location_id);
    assert(locationId, 400, 'Location is required');
    const { rows: locs } = await client.query('SELECT * FROM locations WHERE id = $1 AND is_active = true', [locationId]);
    assert(locs.length, 400, 'Invalid or inactive location');

    const rawItems = Array.isArray(input.items) ? input.items : [];
    assert(rawItems.length > 0, 400, 'A sale needs at least one item');

    let customer = null;
    if (input.customer_id) {
      const { rows } = await client.query('SELECT * FROM customers WHERE id = $1 AND is_active = true', [input.customer_id]);
      assert(rows.length, 400, 'Customer not found or inactive');
      customer = rows[0];
    }

    const date = input.date ? String(input.date).slice(0, 10) : todayISO();

    // 1. Price the cart without touching stock yet.
    const computed = [];
    let subtotal = 0;
    let taxTotal = 0;
    let itemCount = 0;
    for (const item of rawItems) {
      const productId = Number(item.product_id);
      const qty = num(item.quantity);
      assert(productId, 400, 'Each sale line needs a product');
      assert(qty > 0, 400, 'Item quantity must be greater than zero');
      const { rows } = await client.query(
        `SELECT p.*, tr.rate AS tax_rate_value, tr.is_inclusive
         FROM products p LEFT JOIN tax_rates tr ON tr.id = p.tax_rate_id
         WHERE p.id = $1 AND p.is_active = true FOR UPDATE OF p`,
        [productId]
      );
      assert(rows.length, 400, `Product ${productId} is not available`);
      const p = rows[0];
      const unitPrice = round4(item.unit_price ?? p.sale_price);
      const lineDiscount = round2(item.discount || 0);
      assert(unitPrice >= 0, 400, 'Unit price cannot be negative');
      assert(lineDiscount >= 0, 400, 'Line discount cannot be negative');
      let gross = round2(qty * unitPrice - lineDiscount);
      assert(gross >= 0, 400, `Discount on ${p.name} exceeds the line amount`);

      const rate = num(p.tax_rate_value);
      const inclusive = !!p.is_inclusive && rate > 0;
      let tax = 0;
      let net;
      let lineTotal;
      if (inclusive) {
        lineTotal = gross;
        tax = round2(gross - gross / (1 + rate / 100));
        net = round2(lineTotal - tax);
      } else {
        net = gross;
        tax = round2(gross * (rate / 100));
        lineTotal = round2(net + tax);
      }
      subtotal = round2(subtotal + net);
      taxTotal = round2(taxTotal + tax);
      computed.push({ product: p, qty, unitPrice, lineDiscount, taxRate: rate, tax, net, lineTotal });
      itemCount += 1;
    }

    const orderDiscount = round2(input.discount || 0);
    assert(orderDiscount >= 0, 400, 'Discount cannot be negative');
    assert(orderDiscount <= round2(subtotal + taxTotal), 400, 'Discount exceeds the sale total');
    const total = round2(subtotal + taxTotal - orderDiscount);

    // 2. Validate payments. Cash tenders may produce change; card/bank may not overpay.
    const paymentInput = (Array.isArray(input.payments) ? input.payments : [])
      .filter((p) => p && num(p.amount) > 0);
    const methods = await loadMethods(client, paymentInput.map((p) => Number(p.method_id)));
    let remaining = total;
    let paidTotal = 0;
    let change = 0;
    const applied = [];
    let needsCashSession = false;

    for (const p of paymentInput) {
      const method = methods[Number(p.method_id)];
      assert(method, 400, 'Invalid payment method');
      const tendered = round2(p.amount);
      if (method.type !== 'cash' && tendered > remaining + 0.005) {
        throw new ApiError(400, `${method.name} payment exceeds the amount due`);
      }
      const appliedAmount = round2(Math.min(tendered, remaining));
      const changeAmount = round2(tendered - appliedAmount);
      if (changeAmount > 0 && method.type !== 'cash') {
        throw new ApiError(400, 'Change can only be given on cash payments');
      }
      if (method.requires_reference) assert(p.reference, 400, `${method.name} requires a reference`);
      if (method.type === 'cash') needsCashSession = true;
      remaining = round2(remaining - appliedAmount);
      paidTotal = round2(paidTotal + appliedAmount);
      change = round2(change + changeAmount);
      if (appliedAmount > 0) applied.push({ method, amount: appliedAmount, reference: p.reference || null });
    }

    const due = round2(total - paidTotal);
    assert(due <= 0.005 || customer, 400, 'Credit sales (amount due) require a customer');

    // 3. Optional credit-limit check.
    if (due > 0 && customer) {
      if (num(customer.credit_limit) > 0) {
        const arId = await mapping(client, 'ar');
        const { rows } = await client.query(
          `SELECT COALESCE(SUM(jl.debit - jl.credit), 0) AS balance
           FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
           WHERE jl.account_id = $1 AND jl.customer_id = $2`,
          [arId, customer.id]
        );
        const balance = num(rows[0].balance);
        assert(balance + due <= num(customer.credit_limit) + 0.005, 400,
          `Credit limit exceeded. Current balance ${balance.toFixed(2)}, limit ${num(customer.credit_limit).toFixed(2)}`);
      }
    }

    let session = null;
    if (needsCashSession) {
      session = await assertCashSession(client, input.session_id, user, locationId, { required: true });
    } else if (input.session_id) {
      session = await assertCashSession(client, input.session_id, user, locationId, { required: false });
    }

    // 4. Create the sale document.
    const invoiceNo = await nextDoc(client, 'sale', settings.pos.invoice_prefix, new Date(`${date}T12:00:00Z`));
    const createdAt = input.created_at || `${date}T${new Date().toISOString().slice(11, 19)}Z`;
    const { rows: saleRows } = await client.query(
      `INSERT INTO sales (invoice_no, location_id, customer_id, user_id, session_id, status,
         subtotal, discount, tax, total, paid, due, change_due, due_date, notes, created_at)
       VALUES ($1,$2,$3,$4,$5,'completed',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [
        invoiceNo, locationId, customer?.id || null, user.id, session?.id || null,
        subtotal, orderDiscount, taxTotal, total, paidTotal, due, change,
        input.due_date || (due > 0 ? addDaysISO(date, num(settings.pos.default_due_days) || 30) : null),
        input.notes || null, createdAt,
      ]
    );
    const sale = saleRows[0];

    // 5. Move stock and write item lines with actual weighted-average cost.
    let cogs = 0;
    for (const line of computed) {
      let unitCost = 0;
      let costTotal = 0;
      if (line.product.track_inventory) {
        const out = await applyStockOut(client, {
          productId: line.product.id,
          locationId,
          quantity: line.qty,
          type: 'sale',
          refType: 'sale',
          refId: sale.id,
          userId: user.id,
          allowNegative: !!settings.pos.allow_negative_stock,
        });
        unitCost = out.unitCost;
        costTotal = out.costTotal;
        cogs = round2(cogs + costTotal);
      }
      await client.query(
        `INSERT INTO sale_items (sale_id, product_id, description, quantity, unit_price, discount,
           tax_rate, tax_amount, line_total, unit_cost, cost_total)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          sale.id, line.product.id, line.product.name, line.qty, line.unitPrice, line.lineDiscount,
          line.taxRate, line.tax, line.lineTotal, unitCost, costTotal,
        ]
      );
    }

    // 6. Payments and drawer movements.
    let cashApplied = 0;
    for (const p of applied) {
      await client.query(
        `INSERT INTO payments (type, method_id, amount, reference, sale_id, customer_id, session_id, user_id)
         VALUES ('sale',$1,$2,$3,$4,$5,$6,$7)`,
        [p.method.id, p.amount, p.reference, sale.id, customer?.id || null, session?.id || null, user.id]
      );
      if (p.method.type === 'cash') cashApplied = round2(cashApplied + p.amount);
    }
    if (cashApplied > 0 && session) {
      await recordCashMovement(client, {
        sessionId: session.id,
        type: 'sale',
        amount: cashApplied,
        reason: `Cash sale ${invoiceNo}`,
        refType: 'sale',
        refId: sale.id,
        userId: user.id,
      });
    }

    // 7. Post the sale: cash/receivable debit, revenue and tax credit; COGS/inventory.
    const maps = await getMappings(client);
    const lines = [];
    const byAccount = new Map();
    for (const p of applied) {
      const acct = methodAccount(p.method, session);
      byAccount.set(acct, round2((byAccount.get(acct) || 0) + p.amount));
    }
    for (const [accountId, amount] of byAccount) {
      lines.push({ account_id: accountId, debit: amount, description: `Payment — ${invoiceNo}` });
    }
    if (due > 0) {
      lines.push({
        account_id: maps.ar,
        debit: due,
        description: `Credit sale — ${invoiceNo}`,
        customer_id: customer?.id,
      });
    }
    const revenue = round2(total - taxTotal);
    if (revenue > 0) lines.push({ account_id: maps.sales, credit: revenue, description: `Sales — ${invoiceNo}` });
    if (taxTotal > 0) lines.push({ account_id: maps.tax_payable, credit: taxTotal, description: `Sales tax — ${invoiceNo}` });
    if (cogs > 0) {
      lines.push({ account_id: maps.cogs, debit: cogs, description: `Cost of goods sold — ${invoiceNo}` });
      lines.push({ account_id: maps.inventory, credit: cogs, description: `Inventory out — ${invoiceNo}` });
    }
    if (lines.length) {
      await postJournal(client, {
        date,
        memo: `Sale ${invoiceNo}`,
        sourceType: 'sale',
        sourceId: sale.id,
        locationId,
        userId: user.id,
        lines,
      });
    }

    await audit(client, { user }, 'sale.create', 'sale', sale.id, { invoiceNo, total, items: itemCount });
    return getSaleDetail(client, sale.id);
  });
}

export async function listSales(filters = {}) {
  const where = [];
  const params = [];
  const add = (sql, value) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (filters.from) add('s.created_at >= ?::date', filters.from);
  if (filters.to) add("s.created_at < (?::date + interval '1 day')", filters.to);
  if (filters.status) add('s.status = ?', filters.status);
  if (filters.customer_id) add('s.customer_id = ?', Number(filters.customer_id));
  if (filters.user_id) add('s.user_id = ?', Number(filters.user_id));
  if (filters.location_id) add('s.location_id = ?', Number(filters.location_id));
  if (filters.session_id) add('s.session_id = ?', Number(filters.session_id));
  if (filters.q) {
    params.push(`%${filters.q}%`);
    where.push(`(s.invoice_no ILIKE $${params.length} OR c.name ILIKE $${params.length})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(Number(filters.limit) || 50, 500);
  const offset = Math.max(Number(filters.offset) || 0, 0);

  const [{ rows }, { rows: totals }] = await Promise.all([
    query(
      `SELECT s.*, c.name AS customer_name, u.name AS cashier_name, l.name AS location_name,
         (SELECT COUNT(*)::int FROM sale_items si WHERE si.sale_id = s.id) AS item_count
       FROM sales s
       LEFT JOIN customers c ON c.id = s.customer_id
       JOIN users u ON u.id = s.user_id
       JOIN locations l ON l.id = s.location_id
       ${whereSql}
       ORDER BY s.created_at DESC, s.id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    ),
    query(
      `SELECT COUNT(*)::int AS count, COALESCE(SUM(s.total),0) AS total,
              COALESCE(SUM(s.paid),0) AS paid, COALESCE(SUM(s.due),0) AS due
       FROM sales s LEFT JOIN customers c ON c.id = s.customer_id ${whereSql}`,
      params
    ),
  ]);
  return { sales: rows, totals: totals[0], limit, offset };
}

export async function voidSale(user, saleId) {
  return withTransaction(async (client) => {
    const { rows } = await client.query('SELECT * FROM sales WHERE id = $1 FOR UPDATE', [saleId]);
    assert(rows.length, 404, 'Sale not found');
    const sale = rows[0];
    assert(sale.status !== 'voided', 400, 'Sale is already voided');
    const { rows: existingReturns } = await client.query('SELECT 1 FROM sale_returns WHERE sale_id = $1', [saleId]);
    assert(!existingReturns.length, 400, 'Cannot void a sale that has returns');

    const { rows: items } = await client.query('SELECT * FROM sale_items WHERE sale_id = $1', [saleId]);
    for (const item of items) {
      if (item.product_id) {
        await applyStockIn(client, {
          productId: item.product_id,
          locationId: sale.location_id,
          quantity: num(item.quantity),
          unitCost: num(item.unit_cost),
          type: 'return_in',
          refType: 'sale_void',
          refId: sale.id,
          userId: user.id,
          note: `Void ${sale.invoice_no}`,
        });
      }
    }
    await reverseJournalsFor(client, 'sale', sale.id, {
      memo: `Void sale ${sale.invoice_no}`,
      userId: user.id,
      locationId: sale.location_id,
    });
    await client.query("UPDATE sales SET status = 'voided' WHERE id = $1", [sale.id]);

    const { rows: cashRows } = await client.query(
      `SELECT COALESCE(SUM(p.amount),0) AS cash FROM payments p
       JOIN payment_methods pm ON pm.id = p.method_id
       WHERE p.sale_id = $1 AND p.type = 'sale' AND pm.type = 'cash'`,
      [saleId]
    );
    if (sale.session_id && num(cashRows[0].cash) > 0) {
      await recordCashMovement(client, {
        sessionId: sale.session_id,
        type: 'refund',
        amount: -num(cashRows[0].cash),
        reason: `Void of ${sale.invoice_no}`,
        refType: 'sale_void',
        refId: sale.id,
        userId: user.id,
      });
    }
    await audit(client, { user }, 'sale.void', 'sale', sale.id, { invoiceNo: sale.invoice_no });
    return getSaleDetail(client, sale.id);
  });
}

export async function createReturn(user, saleId, input) {
  return withTransaction(async (client) => {
    const { rows: saleRows } = await client.query('SELECT * FROM sales WHERE id = $1 FOR UPDATE', [saleId]);
    assert(saleRows.length, 404, 'Sale not found');
    const sale = saleRows[0];
    assert(sale.status !== 'voided', 400, 'Cannot return a voided sale');
    assert(sale.status !== 'refunded', 400, 'This sale has already been fully refunded');

    const { rows: items } = await client.query(
      `SELECT si.*, COALESCE((SELECT SUM(ri.quantity) FROM return_items ri WHERE ri.sale_item_id = si.id), 0) AS returned_qty
       FROM sale_items si WHERE si.sale_id = $1 ORDER BY si.id`,
      [saleId]
    );
    const itemMap = Object.fromEntries(items.map((i) => [i.id, i]));
    const reqItems = Array.isArray(input.items) ? input.items.filter((i) => num(i.quantity) > 0) : [];
    assert(reqItems.length, 400, 'Select at least one item to return');

    let refundTotal = 0;
    let taxTotal = 0;
    let costTotal = 0;
    const prepared = [];
    for (const ri of reqItems) {
      const item = itemMap[Number(ri.sale_item_id)];
      assert(item, 400, 'Invalid sale item in return');
      const qty = num(ri.quantity);
      const remaining = round4(num(item.quantity) - num(item.returned_qty));
      assert(qty <= remaining + 0.0001, 400, `Return quantity exceeds remaining quantity for ${item.description}`);
      const ratio = qty / num(item.quantity);
      const lineRefund = round2(num(item.line_total) * ratio);
      const taxRefund = round2(num(item.tax_amount) * ratio);
      const cost = round2(num(item.unit_cost) * qty);
      refundTotal = round2(refundTotal + lineRefund);
      taxTotal = round2(taxTotal + taxRefund);
      costTotal = round2(costTotal + cost);
      prepared.push({ item, qty, lineRefund, taxRefund, cost });
    }
    const netTotal = round2(refundTotal - taxTotal);

    let method = null;
    let arReduction = round2(Math.min(num(sale.due), refundTotal));
    let cashRefund = round2(refundTotal - arReduction);
    if (cashRefund > 0 || input.method_id) {
      const targetId = input.method_id || (await client.query("SELECT id FROM payment_methods WHERE type = 'cash' AND is_active = true ORDER BY id LIMIT 1")).rows[0]?.id;
      if (targetId) {
        const { rows } = await client.query('SELECT * FROM payment_methods WHERE id = $1 AND is_active = true', [targetId]);
        assert(rows.length, 400, 'Invalid refund method');
        method = rows[0];
      }
    }
    if (cashRefund > 0) assert(method, 400, 'Choose a refund method');

    let session = null;
    if (method?.type === 'cash' && cashRefund > 0) {
      session = await assertCashSession(client, input.session_id, user, sale.location_id, { required: true });
    }

    const returnNo = await nextDoc(client, 'sale_return', 'RET', new Date());
    const { rows: retRows } = await client.query(
      `INSERT INTO sale_returns (return_no, sale_id, customer_id, location_id, user_id, session_id, method_id,
         subtotal, tax, total, reason, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        returnNo, sale.id, sale.customer_id, sale.location_id, user.id, session?.id || null, method?.id || null,
        netTotal, taxTotal, refundTotal, input.reason || null,
        input.created_at || new Date().toISOString(),
      ]
    );
    const ret = retRows[0];

    for (const p of prepared) {
      await client.query(
        `INSERT INTO return_items (return_id, sale_item_id, product_id, quantity, unit_price, tax_amount,
           line_total, unit_cost, cost_total)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [ret.id, p.item.id, p.item.product_id, p.qty, p.item.unit_price, p.taxRefund, p.lineRefund, p.item.unit_cost, p.cost]
      );
      if (p.item.product_id) {
        await applyStockIn(client, {
          productId: p.item.product_id,
          locationId: sale.location_id,
          quantity: p.qty,
          unitCost: num(p.item.unit_cost),
          type: 'return_in',
          refType: 'sale_return',
          refId: ret.id,
          userId: user.id,
          note: `Return ${returnNo}`,
        });
      }
    }

    if (cashRefund > 0) {
      await client.query(
        `INSERT INTO payments (type, method_id, amount, reference, sale_id, return_id, customer_id, session_id, user_id)
         VALUES ('refund',$1,$2,$3,$4,$5,$6,$7,$8)`,
        [method.id, cashRefund, input.reference || null, sale.id, ret.id, sale.customer_id, session?.id || null, user.id]
      );
      if (method.type === 'cash' && session) {
        await recordCashMovement(client, {
          sessionId: session.id,
          type: 'refund',
          amount: -cashRefund,
          reason: `Refund ${returnNo}`,
          refType: 'sale_return',
          refId: ret.id,
          userId: user.id,
        });
      }
    }

    const maps = await getMappings(client);
    const lines = [
      { account_id: maps.sales_returns, debit: netTotal, description: `Sales return ${returnNo}` },
    ];
    if (taxTotal > 0) lines.push({ account_id: maps.tax_payable, debit: taxTotal, description: `Tax reversed ${returnNo}` });
    if (arReduction > 0) lines.push({ account_id: maps.ar, credit: arReduction, description: `AR reduced ${returnNo}`, customer_id: sale.customer_id });
    if (cashRefund > 0) {
      lines.push({
        account_id: methodAccount(method, session),
        credit: cashRefund,
        description: `Refund ${returnNo}`,
      });
    }
    await postJournal(client, {
      date: input.date || todayISO(),
      memo: `Sales return ${returnNo} (${sale.invoice_no})`,
      sourceType: 'sale_return',
      sourceId: ret.id,
      locationId: sale.location_id,
      userId: user.id,
      lines,
    });

    if (costTotal > 0) {
      await postJournal(client, {
        date: input.date || todayISO(),
        memo: `Inventory restored ${returnNo}`,
        sourceType: 'sale_return',
        sourceId: ret.id,
        locationId: sale.location_id,
        userId: user.id,
        lines: [
          { account_id: maps.inventory, debit: costTotal, description: `Inventory back ${returnNo}` },
          { account_id: maps.cogs, credit: costTotal, description: `COGS reversed ${returnNo}` },
        ],
      });
    }

    const newDue = round2(num(sale.due) - arReduction);
    const newPaid = round2(Math.max(0, num(sale.paid) - cashRefund));
    const { rows: remainingRows } = await client.query(
      `SELECT COUNT(*)::int AS open_items FROM sale_items si
       WHERE si.sale_id = $1
         AND si.quantity > COALESCE((SELECT SUM(ri.quantity) FROM return_items ri WHERE ri.sale_item_id = si.id), 0) + 0.0001`,
      [sale.id]
    );
    await client.query(
      'UPDATE sales SET due = $1, paid = $2, status = $3 WHERE id = $4',
      [newDue, newPaid, remainingRows[0].open_items === 0 ? 'refunded' : 'partially_refunded', sale.id]
    );

    await audit(client, { user }, 'sale.return', 'sale_return', ret.id, { returnNo, sale: sale.invoice_no, refundTotal });
    return { ...ret, items: prepared, cash_refund: cashRefund, ar_reduction: arReduction };
  });
}

export async function receiveCustomerPayment(user, input) {
  return withTransaction(async (client) => {
    const customerId = Number(input.customer_id);
    const amount = round2(input.amount);
    assert(customerId, 400, 'Customer is required');
    assert(amount > 0, 400, 'Amount must be greater than zero');
    const { rows: custRows } = await client.query('SELECT * FROM customers WHERE id = $1 AND is_active = true', [customerId]);
    assert(custRows.length, 404, 'Customer not found');
    const customer = custRows[0];

    const { rows: methodRows } = await client.query('SELECT * FROM payment_methods WHERE id = $1 AND is_active = true', [input.method_id]);
    assert(methodRows.length, 400, 'Invalid payment method');
    const method = methodRows[0];

    let session = null;
    if (method.type === 'cash') {
      session = await assertCashSession(client, input.session_id, user, Number(input.location_id || user.location_id), { required: true });
    }

    const { rows: openSales } = await client.query(
      `SELECT * FROM sales WHERE customer_id = $1 AND due > 0 AND status NOT IN ('voided','refunded')
       ORDER BY created_at, id ${input.sale_id ? 'FOR UPDATE' : ''}`,
      [customerId]
    );
    let unallocated = amount;
    const allocations = [];
    const ordered = input.sale_id ? openSales.filter((s) => s.id === Number(input.sale_id)) : openSales;
    for (const sale of ordered) {
      if (unallocated <= 0) break;
      const apply = round2(Math.min(unallocated, num(sale.due)));
      if (apply <= 0) continue;
      await client.query(
        'UPDATE sales SET paid = paid + $1, due = due - $1 WHERE id = $2',
        [apply, sale.id]
      );
      allocations.push({ sale_id: sale.id, invoice_no: sale.invoice_no, amount: apply });
      unallocated = round2(unallocated - apply);
    }
    if (unallocated > 0) allocations.push({ sale_id: null, invoice_no: null, amount: unallocated });

    for (const a of allocations) {
      await client.query(
        `INSERT INTO payments (type, method_id, amount, reference, sale_id, customer_id, session_id, user_id)
         VALUES ('customer_receipt',$1,$2,$3,$4,$5,$6,$7)`,
        [method.id, a.amount, input.reference || null, a.sale_id, customerId, session?.id || null, user.id]
      );
    }

    const maps = await getMappings(client);
    await postJournal(client, {
      date: input.date || todayISO(),
      memo: `Customer receipt — ${customer.name}`,
      sourceType: 'customer_receipt',
      sourceId: customerId,
      locationId: Number(input.location_id || user.location_id),
      userId: user.id,
      lines: [
        { account_id: methodAccount(method, session), debit: amount, description: `Receipt from ${customer.name}` },
        { account_id: maps.ar, credit: amount, description: `AR — ${customer.name}`, customer_id: customerId },
      ],
    });

    if (method.type === 'cash' && session) {
      await recordCashMovement(client, {
        sessionId: session.id,
        type: 'receipt',
        amount,
        reason: `Customer receipt — ${customer.name}`,
        refType: 'customer_receipt',
        refId: customerId,
        userId: user.id,
      });
    }

    await audit(client, { user }, 'customer.receipt', 'customer', customerId, { amount, allocations });
    return { amount, allocations, customer_id: customerId, method: method.name, unallocated };
  });
}
