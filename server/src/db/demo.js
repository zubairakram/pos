/**
 * Seeds a realistic trading history on top of the base seed.
 *
 *   npm run db:reset          # schema + base seed
 *   npm run db:demo           # 30 days of trading, drawers and paperwork
 *
 * The demo is deliberately additive: it refuses to run when sales already
 * exist so that it can never double-post into a live ledger.
 */
import { pool, query } from './index.js';
import { createPurchase, paySupplier } from '../services/purchases.js';
import { createReturn, createSale, receiveCustomerPayment } from '../services/sales.js';
import { getMappings, postJournal } from '../services/accounting.js';
import { recordCashMovement } from '../services/cash.js';
import { addDaysISO, num, round2, todayISO } from '../utils.js';

const DAYS = 30;
const TODAY = todayISO();
const FAST_SKUS = [
  'COL-330', 'SPW-500', 'OJ-1L', 'CHP-150', 'CHO-50', 'MIL-1L', 'BRD-600',
  'EGG-12', 'RIC-1K', 'PAS-500', 'COF-250', 'TEA-100', 'SOA-250', 'TWL-2',
];

let seed = 0x5eed1234;
function rnd() {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return ((seed >>> 0) % 100000) / 100000;
}
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const chance = (p) => rnd() < p;
const pickTime = () => pick(['09:05', '10:20', '11:45', '13:10', '14:35', '16:05', '17:40', '19:15']);

function priceLine(product, quantity, discount) {
  const price = round2(product.sale_price);
  const gross = round2(quantity * price - discount);
  const rate = num(product.tax_rate_value);
  const inclusive = !!product.is_inclusive && rate > 0;
  if (inclusive) {
    const tax = round2(gross - gross / (1 + rate / 100));
    return { tax, net: round2(gross - tax), total: gross };
  }
  const tax = round2(gross * (rate / 100));
  return { tax, net: gross, total: round2(gross + tax) };
}

function cartTotal(lines, orderDiscount = 0) {
  let net = 0;
  let tax = 0;
  for (const line of lines) {
    const calc = priceLine(line.product, line.quantity, line.discount);
    net = round2(net + calc.net);
    tax = round2(tax + calc.tax);
  }
  return round2(net + tax - orderDiscount);
}

async function loadRefs() {
  const { rows: users } = await query('SELECT id, name, role, location_id FROM users');
  const user = Object.fromEntries(users.map((u) => [u.role, u]));
  const { rows: locations } = await query('SELECT * FROM locations');
  const location = Object.fromEntries(locations.map((l) => [l.code, l]));
  const { rows: products } = await query(
    `SELECT p.*, tr.rate AS tax_rate_value, tr.is_inclusive, c.name AS category_name
     FROM products p
     LEFT JOIN tax_rates tr ON tr.id = p.tax_rate_id
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.is_active = true ORDER BY p.id`
  );
  const { rows: customers } = await query('SELECT * FROM customers WHERE is_active = true ORDER BY id');
  const { rows: suppliers } = await query('SELECT * FROM suppliers WHERE is_active = true ORDER BY id');
  const { rows: methods } = await query('SELECT * FROM payment_methods WHERE is_active = true');
  const method = Object.fromEntries(methods.map((m) => [m.code, m]));
  const { rows: registers } = await query('SELECT * FROM cash_registers WHERE is_active = true ORDER BY id');
  const register = Object.fromEntries(registers.map((r) => [r.name, r]));
  const { rows: accounts } = await query('SELECT * FROM accounts WHERE is_active = true');
  const account = Object.fromEntries(accounts.map((a) => [a.code, a]));

  if (!user.cashier || !register['Counter 1']) {
    throw new Error('Base seed is missing the demo cashier or Counter 1 register. Run npm run db:reset first.');
  }

  return {
    user,
    location,
    products,
    customers,
    suppliers,
    method,
    register,
    account,
  };
}

async function stockAt(productId, locationId) {
  const { rows } = await query(
    'SELECT quantity FROM inventory WHERE product_id = $1 AND location_id = $2',
    [productId, locationId]
  );
  return num(rows[0]?.quantity);
}

async function pickItems(refs, count) {
  const main = refs.location.MAIN;
  const fast = refs.products.filter((p) => FAST_SKUS.includes(p.sku));
  const slow = refs.products.filter((p) => !FAST_SKUS.includes(p.sku) && p.track_inventory);
  const services = refs.products.filter((p) => !p.track_inventory);
  const lines = [];
  const used = new Set();

  for (let i = 0; i < count; i += 1) {
    let product = null;
    for (let attempt = 0; attempt < 14 && !product; attempt += 1) {
      const pool = chance(0.82) ? fast : slow;
      const candidate = pick(pool.filter((p) => !used.has(p.id)));
      if (!candidate) continue;
      if (candidate.track_inventory && (await stockAt(candidate.id, main.id)) < 2) continue;
      product = candidate;
    }
    if (!product && services.length && chance(0.35)) {
      product = pick(services);
    }
    if (!product) continue;
    used.add(product.id);

    let quantity = product.track_inventory ? 1 + Math.floor(rnd() * 2) : 1;
    if (product.track_inventory) {
      const available = await stockAt(product.id, main.id);
      if (available < quantity) quantity = Math.floor(available);
    }
    if (quantity <= 0) continue;

    const discount = chance(0.12) ? round2(num(product.sale_price) * quantity * 0.1) : 0;
    lines.push({ product, quantity, discount });
  }
  return lines;
}

async function openDrawer(refs, date, openingFloat = 250) {
  const { rows } = await query(
    `INSERT INTO cash_sessions (register_id, user_id, opening_float, opening_note, opened_at)
     VALUES ($1,$2,$3,'Demo shift',$4) RETURNING *`,
    [refs.register['Counter 1'].id, refs.user.cashier.id, openingFloat, `${date}T08:30:00Z`]
  );
  return rows[0];
}

async function closeDrawer(refs, session, date, variance = 0) {
  const { rows } = await query(
    'SELECT COALESCE(SUM(amount),0) AS movements FROM cash_movements WHERE session_id = $1',
    [session.id]
  );
  const expected = round2(num(session.opening_float) + num(rows[0].movements));
  const counted = round2(expected + variance);
  await query(
    `UPDATE cash_sessions SET status='closed', expected_cash=$1, counted_cash=$2, variance=$3,
       closing_note='End of day count', closed_at=$4 WHERE id=$5`,
    [expected, counted, variance, `${date}T20:05:00Z`, session.id]
  );
  if (variance !== 0) {
    const maps = await getMappings({ query });
    await postJournal({ query }, {
      date,
      memo: `Cash drawer ${variance > 0 ? 'overage' : 'shortage'} — Counter 1`,
      sourceType: 'cash_variance',
      sourceId: session.id,
      locationId: refs.location.MAIN.id,
      userId: refs.user.cashier.id,
      lines: variance > 0
        ? [
          { account_id: refs.register['Counter 1'].account_id, debit: variance, description: 'Cash drawer overage' },
          { account_id: maps.cash_over_short, credit: variance, description: 'Cash over/short' },
        ]
        : [
          { account_id: maps.cash_over_short, debit: Math.abs(variance), description: 'Cash over/short' },
          { account_id: refs.register['Counter 1'].account_id, credit: Math.abs(variance), description: 'Cash drawer shortage' },
        ],
    });
  }
  // Keep drawer movements inside the historical day.
  await query('UPDATE cash_movements SET created_at = $1 WHERE session_id = $2', [`${date}T19:55:00Z`, session.id]);
  return { expected, counted, variance };
}

async function makeSale(refs, {
  date, time, session = null, tier = 'cash', customer = null, orderDiscount = 0, itemCount = 2,
}) {
  const lines = await pickItems(refs, itemCount);
  if (!lines.length) return null;
  const baseTotal = cartTotal(lines, 0);
  const cappedDiscount = round2(Math.min(orderDiscount, baseTotal * 0.1));
  const total = round2(baseTotal - cappedDiscount);

  const payload = {
    location_id: refs.location.MAIN.id,
    date,
    created_at: `${date}T${time}:00Z`,
    items: lines.map((l) => ({
      product_id: l.product.id,
      quantity: l.quantity,
      unit_price: l.product.sale_price,
      discount: l.discount,
    })),
    discount: cappedDiscount,
  };
  if (session) payload.session_id = session.id;
  if (customer) payload.customer_id = customer.id;

  if (tier === 'cash') {
    const tender = Math.max(5, Math.ceil(total / 5) * 5);
    payload.payments = [{ method_id: refs.method.CASH.id, amount: tender }];
  } else if (tier === 'card') {
    payload.payments = [{ method_id: refs.method.CARD.id, amount: total }];
  } else if (tier === 'wallet') {
    payload.payments = [{ method_id: refs.method.WALLET.id, amount: total }];
  } else if (tier === 'bank') {
    payload.payments = [{ method_id: refs.method.BANK.id, amount: total, reference: `TRF-${date.replaceAll('-', '')}-${Math.floor(rnd() * 900 + 100)}` }];
  }
  // tier === 'credit' → no payment, balance sits in receivables

  const sale = await createSale(refs.user.cashier, payload);
  return { sale, tier, date };
}

async function seedPurchases(refs) {
  const plans = [
    { offset: -29, supplier: 0, items: [['COL-330', 120], ['SPW-500', 90], ['OJ-1L', 30]] },
    { offset: -23, supplier: 1, items: [['MIL-1L', 60], ['BRD-600', 30], ['EGG-12', 40]] },
    { offset: -17, supplier: 0, items: [['CHP-150', 60], ['CHO-50', 80]] },
    { offset: -11, supplier: 0, items: [['RIC-1K', 60], ['PAS-500', 50], ['OIL-500', 24]] },
    { offset: -5, supplier: 2, items: [['BAT-AA4', 20], ['CHR-20W', 15]] },
    { offset: -2, supplier: 1, items: [['COF-250', 30], ['TEA-100', 24], ['BRD-600', 24]] },
  ];
  const purchases = [];
  for (const plan of plans) {
    const date = addDaysISO(TODAY, plan.offset);
    const supplier = refs.suppliers[plan.supplier % refs.suppliers.length];
    const items = plan.items.map(([sku, quantity]) => {
      const product = refs.products.find((p) => p.sku === sku);
      return {
        product_id: product.id,
        quantity,
        unit_cost: round2(num(product.cost_price) * (0.96 + rnd() * 0.1)),
      };
    });
    const purchase = await createPurchase(refs.user.storekeeper, {
      supplier_id: supplier.id,
      location_id: refs.location.WH.id,
      date,
      created_at: `${date}T10:15:00Z`,
      items,
      notes: 'Demo replenishment order',
    });
    purchases.push({ purchase, supplier });
  }
  return purchases;
}

async function seedSales(refs) {
  const sales = [];
  const openSession = (await query(
    `SELECT cs.* FROM cash_sessions cs JOIN cash_registers r ON r.id = cs.register_id
     WHERE r.name = 'Counter 1' AND cs.status = 'open' ORDER BY cs.opened_at DESC LIMIT 1`
  )).rows[0];

  for (let offset = DAYS - 1; offset >= 0; offset -= 1) {
    const date = addDaysISO(TODAY, -offset);
    const isToday = offset === 0;
    const session = isToday
      ? (openSession || await openDrawer(refs, date, 300))
      : await openDrawer(refs, date, pick([200, 250, 300]));

    const count = isToday ? 3 : 2 + Math.floor(rnd() * 3);
    let creditSeeded = 0;

    for (let i = 0; i < count; i += 1) {
      let tier;
      const roll = rnd();
      if (roll < 0.5) tier = 'cash';
      else if (roll < 0.72) tier = 'card';
      else if (roll < 0.82) tier = 'wallet';
      else if (roll < 0.88) tier = 'bank';
      else tier = 'credit';

      // Keep at least one cash sale per historical day so the drawer story hangs together.
      if (!isToday && i === 0) tier = 'cash';

      const customer = tier === 'credit'
        ? refs.customers[(creditSeeded + offset) % refs.customers.length]
        : chance(0.25) ? pick(refs.customers) : null;
      if (tier === 'credit') creditSeeded += 1;

      const sale = await makeSale(refs, {
        date,
        time: pickTime(),
        session: tier === 'cash' ? session : null,
        tier,
        customer,
        orderDiscount: chance(0.2) ? round2(1 + rnd() * 4) : 0,
        itemCount: 1 + Math.floor(rnd() * 3),
      });
      if (sale) sales.push(sale);
    }

    // Occasional petty cash movements.
    if (!isToday && chance(0.16)) {
      const amount = round2(15 + rnd() * 35);
      const maps = await getMappings({ query });
      const movement = await recordCashMovement({ query }, {
        sessionId: session.id,
        type: 'cash_out',
        amount: -amount,
        reason: 'Petty cash — store supplies',
        refType: 'cash_movement',
        userId: refs.user.cashier.id,
      });
      await postJournal({ query }, {
        date,
        memo: 'Cash out — store supplies',
        sourceType: 'cash_out',
        sourceId: movement.id,
        locationId: refs.location.MAIN.id,
        userId: refs.user.cashier.id,
        lines: [
          { account_id: maps.owner_drawings, debit: amount, description: 'Petty cash' },
          { account_id: refs.register['Counter 1'].account_id, credit: amount, description: 'Petty cash' },
        ],
      });
    }

    if (!isToday) {
      const variance = offset === 6 ? -0.25 : offset === 13 ? 0.1 : 0;
      await closeDrawer(refs, session, date, variance);
    }
  }

  return sales;
}

async function seedReturns(refs, sales) {
  const candidates = sales.filter((s) => s.tier !== 'credit' && s.sale.items?.length && s.date <= addDaysISO(TODAY, -3));
  const chosen = [candidates[3], candidates[Math.floor(candidates.length / 2)], candidates[candidates.length - 3]].filter(Boolean);
  const results = [];
  for (const entry of chosen) {
    const item = entry.sale.items.find((i) => num(i.returned_qty) < num(i.quantity)) || entry.sale.items[0];
    if (!item) continue;
    const date = addDaysISO(entry.date, 2);
    const ret = await createReturn(refs.user.cashier, entry.sale.id, {
      date,
      created_at: `${date}T15:20:00Z`,
      method_id: refs.method.CARD.id,
      reason: pick(['Changed mind', 'Damaged packaging', 'Wrong item purchased']),
      items: [{ sale_item_id: item.id, quantity: 1 }],
    });
    results.push(ret);
  }
  return results;
}

async function seedReceipts(refs) {
  const receipts = [];
  const { rows: creditSales } = await query(
    `SELECT * FROM sales WHERE due > 0 AND status IN ('completed','partially_refunded') ORDER BY created_at`
  );
  if (!creditSales.length) return receipts;
  const plans = [
    { offset: -9, amount: 80, method: refs.method.BANK },
    { offset: -6, amount: 120, method: refs.method.CARD },
    { offset: -3, amount: 60, method: refs.method.BANK },
    { offset: -1, amount: 100, method: refs.method.CASH },
  ];
  for (const plan of plans) {
    const sale = creditSales.find((s) => num(s.due) >= plan.amount) || creditSales[0];
    if (!sale) continue;
    const date = addDaysISO(TODAY, plan.offset);
    let sessionId;
    if (plan.method.type === 'cash') {
      const session = await openDrawer(refs, date, 250);
      sessionId = session.id;
      const receipt = await receiveCustomerPayment(refs.user.cashier, {
        customer_id: sale.customer_id,
        sale_id: sale.id,
        amount: plan.amount,
        method_id: plan.method.id,
        session_id: sessionId,
        date,
      });
      await closeDrawer(refs, session, date, 0);
      receipts.push(receipt);
      continue;
    }
    const receipt = await receiveCustomerPayment(refs.user.cashier, {
      customer_id: sale.customer_id,
      sale_id: sale.id,
      amount: plan.amount,
      method_id: plan.method.id,
      reference: plan.method.requires_reference ? `RCPT-${date.replaceAll('-', '')}` : undefined,
      date,
    });
    receipts.push(receipt);
  }
  return receipts;
}

async function seedSupplierPayments(refs, purchases) {
  const results = [];
  const plans = [
    { offset: -20, part: 0.6, method: refs.method.BANK },
    { offset: -13, part: 1, method: refs.method.BANK },
    { offset: -7, part: 0.5, method: refs.method.CARD },
    { offset: -3, part: 1, method: refs.method.BANK },
  ];
  for (let i = 0; i < plans.length && i < purchases.length; i += 1) {
    const { purchase } = purchases[i];
    const plan = plans[i];
    const amount = round2(num(purchase.due) * plan.part);
    if (amount <= 0) continue;
    const result = await paySupplier(refs.user.accountant, {
      supplier_id: purchase.supplier_id,
      purchase_id: purchase.id,
      amount,
      method_id: plan.method.id,
      reference: `PAY-${addDaysISO(TODAY, plan.offset).replaceAll('-', '')}-${i + 1}`,
      date: addDaysISO(TODAY, plan.offset),
    });
    results.push(result);
  }
  return results;
}

async function seedExpenses(refs) {
  const plans = [
    { offset: -28, code: '6100', amount: 1200, note: 'Monthly store rent' },
    { offset: -21, code: '6200', amount: 265.4, note: 'Electricity and water' },
    { offset: -14, code: '6700', amount: 96.75, note: 'Receipt rolls and bags' },
    { offset: -11, code: '6500', amount: 450, note: 'Local promotion flyers' },
    { offset: -7, code: '6000', amount: 3200, note: 'Store payroll' },
    { offset: -2, code: '6800', amount: 180, note: 'Shelving repair' },
  ];
  const created = [];
  for (const plan of plans) {
    const date = addDaysISO(TODAY, plan.offset);
    const account = refs.account[plan.code];
    const method = refs.method.BANK;
    const journal = await postJournal({ query }, {
      date,
      memo: `Expense — ${account.name}: ${plan.note}`,
      sourceType: 'expense',
      locationId: refs.location.MAIN.id,
      userId: refs.user.accountant.id,
      lines: [
        { account_id: account.id, debit: plan.amount, description: plan.note },
        { account_id: method.account_id, credit: plan.amount, description: `Payment — ${method.name}` },
      ],
    });
    const { rows } = await query(
      `INSERT INTO expenses (entry_date, account_id, amount, method_id, location_id, reference,
         notes, user_id, journal_entry_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [date, account.id, plan.amount, method.id, refs.location.MAIN.id,
        `EXP-${date.replaceAll('-', '')}`, plan.note, refs.user.accountant.id, journal.id]
    );
    created.push(rows[0]);
  }
  return created;
}

async function main() {
  const { rows: existing } = await query('SELECT COUNT(*)::int AS n FROM sales');
  if (existing[0].n > 0) {
    console.log('[demo] this database already has sales. Run `npm run db:reset && npm run db:demo` for a clean demo.');
    await pool.end();
    return;
  }

  console.log('[demo] loading reference data…');
  const refs = await loadRefs();

  console.log('[demo] receiving purchase orders…');
  const purchases = await seedPurchases(refs);

  console.log('[demo] ringing up 30 days of sales…');
  const sales = await seedSales(refs);

  console.log('[demo] processing returns, receipts and supplier payments…');
  const returns = await seedReturns(refs, sales);
  const receipts = await seedReceipts(refs);
  const supplierPayments = await seedSupplierPayments(refs, purchases);
  const expenses = await seedExpenses(refs);

  const { rows: totals } = await query(
    `SELECT
       (SELECT COUNT(*)::int FROM sales) AS sales,
       (SELECT COUNT(*)::int FROM purchases) AS purchases,
       (SELECT COUNT(*)::int FROM sale_returns) AS returns,
       (SELECT COUNT(*)::int FROM expenses) AS expenses,
       (SELECT COUNT(*)::int FROM journal_entries) AS entries,
       (SELECT COALESCE(SUM(debit),0) FROM journal_lines) AS debit,
       (SELECT COALESCE(SUM(credit),0) FROM journal_lines) AS credit`
  );

  const t = totals[0];
  console.log('[demo] done');
  console.log(`       ${t.sales} sales · ${t.purchases} purchases · ${t.returns} returns · ${t.expenses} expenses`);
  console.log(`       ${t.entries} journal entries · debits ${Number(t.debit).toFixed(2)} · credits ${Number(t.credit).toFixed(2)}`);
  if (Math.abs(num(t.debit) - num(t.credit)) >= 0.005) {
    throw new Error('Ledger is not balanced after demo seeding');
  }
  if (receipts.length || supplierPayments.length) {
    console.log(`       ${receipts.length} customer receipts · ${supplierPayments.length} supplier payments`);
  }

  await pool.end();
}

main().catch(async (err) => {
  console.error('[demo] failed', err);
  try { await pool.end(); } catch { /* ignore */ }
  process.exit(1);
});
