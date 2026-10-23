#!/usr/bin/env node
/**
 * End-to-end API smoke test.
 *
 *   npm run db:reset && npm run db:demo
 *   npm run test:api
 *
 * Override the target with API_URL=https://host/api. The test creates a
 * timestamped set of records (a product, customer, supplier, sale, purchase,
 * expense, user and a closed cash drawer) and verifies the ledger stays
 * balanced after every money-moving operation.
 */
import process from 'node:process';

const BASE = (process.env.API_URL || 'http://localhost:4000/api').replace(/\/$/, '');
const stamp = Date.now().toString(36).toUpperCase();
const today = new Date().toISOString().slice(0, 10);
const daysAgo = (n) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

let checks = 0;

class SmokeError extends Error {}

function step(title) {
  console.log(`\n▸ ${title}`);
}

function expect(condition, message, extra) {
  checks += 1;
  if (condition) {
    console.log(`  ✓ ${message}`);
    return;
  }
  const detail = extra === undefined ? '' : `\n    ${typeof extra === 'string' ? extra : JSON.stringify(extra)}`;
  throw new SmokeError(`${message}${detail}`);
}

function nearly(a, b, tolerance = 0.005) {
  return Math.abs(Number(a) - Number(b)) <= tolerance;
}

async function request(path, { method = 'GET', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    throw new SmokeError(`Cannot reach ${BASE}${path}: ${err.message}. Is the API running?`);
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  return { status: res.status, data, text };
}

async function ok(path, options = {}, expected = 200) {
  const res = await request(path, options);
  if (res.status !== expected) {
    throw new SmokeError(
      `${options.method || 'GET'} ${path} → ${res.status} (expected ${expected})\n    ${res.text.slice(0, 400)}`
    );
  }
  return res.data;
}

async function login(email, password) {
  const data = await ok('/auth/login', { method: 'POST', body: { email, password } });
  return data.token;
}

async function main() {
  step('health');
  const health = await ok('/health');
  expect(health.ok === true, 'API and database are healthy');

  step('authentication and role access');
  const admin = await login('admin@ledgerpos.local', 'Admin@123');
  const manager = await login('manager@ledgerpos.local', 'Manager@123');
  const accountant = await login('accountant@ledgerpos.local', 'Account@123');
  const cashier = await login('cashier@ledgerpos.local', 'Cashier@123');
  const storekeeper = await login('store@ledgerpos.local', 'Store@123');
  expect([admin, manager, accountant, cashier, storekeeper].every((t) => typeof t === 'string' && t.length > 20), 'all five demo roles can sign in');

  const me = await ok('/auth/me', { token: cashier });
  expect(me.user.role === 'cashier', 'session identity is returned', me.user);
  expect(me.settings?.company?.currency, 'settings are included in the session');

  const unauth = await request('/products');
  expect(unauth.status === 401, 'protected endpoints reject anonymous requests');

  const forbidden = [
    ['/accounting/trial-balance', cashier, 'GET 403'],
    ['/reports/sales-summary', cashier, 'GET 403'],
    ['/sales', storekeeper, 'POST 403'],
    ['/sales', accountant, 'POST 403'],
    ['/users', cashier, 'GET 403'],
    ['/settings', cashier, 'PUT 403'],
  ];
  for (const [path, token, label] of forbidden) {
    const method = label.startsWith('POST') ? 'POST' : label.startsWith('PUT') ? 'PUT' : 'GET';
    const res = await request(path, { method, token, body: method === 'GET' ? undefined : {} });
    expect(res.status === 403, `RBAC blocks ${method} ${path} (${label})`, res.text.slice(0, 160));
  }

  step('reference data');
  const settingsData = await ok('/settings', { token: admin });
  expect(Array.isArray(settingsData.mapped_accounts) && settingsData.mapped_accounts.length >= 10, 'account mappings are exposed for settings');
  expect(settingsData.mapped_accounts.every((m) => m.key && m.code), 'mappings include ledger keys and account codes');

  const { locations } = await ok('/locations', { token: manager });
  const main = locations.find((l) => l.code === 'MAIN');
  const express = locations.find((l) => l.code === 'EXPRESS');
  expect(main && express, 'store locations are available');

  const { payment_methods: methods } = await ok('/payment-methods', { token: manager });
  const cashMethod = methods.find((m) => m.code === 'CASH');
  const cardMethod = methods.find((m) => m.code === 'CARD');
  const bankMethod = methods.find((m) => m.code === 'BANK');
  expect(cashMethod && cardMethod && bankMethod, 'cash, card and bank payment methods exist');

  const { registers } = await ok('/cash/registers', { token: manager });
  const expressRegister = registers.find((r) => r.name === 'Express Counter');
  expect(expressRegister, 'Express Counter register exists');
  expect(!expressRegister.open_session_id, 'Express Counter is closed before the test');

  const { products } = await ok('/products?limit=1000', { token: manager });
  const gift = products.find((p) => p.sku === 'GIFT');
  expect(gift, 'non-inventory service product exists for counter tests');

  const { accounts } = await ok('/accounting/accounts', { token: accountant });
  const officeSupplies = accounts.find((a) => a.code === '6700');
  const bankAccount = accounts.find((a) => a.code === '1010');
  const salesAccount = accounts.find((a) => a.code === '4000');
  expect(officeSupplies && bankAccount && salesAccount, 'chart of accounts includes expense, bank and sales accounts');

  step('catalogue, inventory and purchasing');
  const product = await ok('/products', {
    method: 'POST',
    token: manager,
    body: {
      name: `Smoke Test Widget ${stamp}`,
      sku: `SMK-${stamp}`,
      barcode: `99${stamp}`.slice(0, 13).padEnd(13, '0'),
      sale_price: 12.5,
      cost_price: 7,
      reorder_level: 3,
      track_inventory: true,
      opening_stock: 0,
    },
  }, 201);
  const productId = product.product.id;
  expect(productId, 'product created');

  const updated = await ok(`/products/${productId}`, {
    method: 'PUT', token: manager, body: { sale_price: 13.75 },
  });
  expect(nearly(updated.product.sale_price, 13.75), 'product price updated');

  const adjust = await ok('/inventory/adjust', {
    method: 'POST',
    token: storekeeper,
    body: {
      product_id: productId,
      location_id: main.id,
      quantity_delta: 10,
      unit_cost: 7,
      reason: 'Smoke test opening count',
    },
  });
  expect(nearly(adjust.adjustment.quantity, 10), 'stock adjustment increased inventory to 10', adjust.adjustment);

  const customer = await ok('/customers', {
    method: 'POST',
    token: manager,
    body: { name: `Smoke Customer ${stamp}`, email: `smoke-${stamp}@example.com`, credit_limit: 1000 },
  }, 201);
  const supplier = await ok('/suppliers', {
    method: 'POST',
    token: storekeeper,
    body: { name: `Smoke Supplier ${stamp}`, email: `supplier-${stamp}@example.com` },
  }, 201);

  const purchase = await ok('/purchases', {
    method: 'POST',
    token: storekeeper,
    body: {
      supplier_id: supplier.supplier.id,
      location_id: main.id,
      items: [{ product_id: productId, quantity: 5, unit_cost: 9.5 }],
      notes: 'Smoke test replenishment',
    },
  }, 201);
  expect(purchase.purchase.items.length === 1, 'purchase created with one line');
  expect(nearly(purchase.purchase.due, purchase.purchase.total), 'new purchase is unpaid', purchase.purchase);

  const supplierPayment = await ok('/supplier-payments', {
    method: 'POST',
    token: accountant,
    body: {
      supplier_id: supplier.supplier.id,
      purchase_id: purchase.purchase.id,
      amount: 20,
      method_id: bankMethod.id,
      reference: `SMK-PAY-${stamp}`,
      date: today,
    },
  }, 201);
  expect(nearly(supplierPayment.payment.allocations[0]?.amount, 20), 'supplier payment allocated to the bill');

  step('counter sale, cash movement and drawer close');
  const drawer = await ok('/cash/sessions/open', {
    method: 'POST',
    token: manager,
    body: { register_id: expressRegister.id, opening_float: 100, note: 'Smoke test shift' },
  }, 201);
  const drawerId = drawer.session.id;
  expect(drawerId, 'opened Express Counter drawer with 100 float');

  const cashSale = await ok('/sales', {
    method: 'POST',
    token: manager,
    body: {
      location_id: express.id,
      session_id: drawerId,
      items: [{ product_id: gift.id, quantity: 1 }],
      payments: [{ method_id: cashMethod.id, amount: 5 }],
    },
  }, 201);
  expect(nearly(cashSale.sale.total, 2), 'cash sale total is 2.00');
  expect(nearly(cashSale.sale.change_due, 3), 'cash change is 3.00');
  expect(cashSale.sale.journal.every((j) => nearly(j.total_debit, j.total_credit)), 'sale journal is balanced', cashSale.sale.journal);

  const cashOut = await ok(`/cash/sessions/${drawerId}/movements`, {
    method: 'POST',
    token: manager,
    body: { type: 'cash_out', amount: 10, reason: 'Smoke test petty cash' },
  }, 201);
  expect(cashOut.movement.type === 'cash_out', 'cash drawer movement recorded');

  const closed = await ok(`/cash/sessions/${drawerId}/close`, {
    method: 'POST',
    token: manager,
    body: { counted_cash: 91.5, note: 'Smoke test count' },
  });
  expect(closed.session.status === 'closed', 'drawer closed');
  expect(nearly(closed.session.expected_cash, 92), 'expected drawer cash is 92.00', closed.session);
  expect(nearly(closed.session.variance, -0.5), 'drawer shortage of 0.50 detected', closed.session);
  expect(closed.summary.movements.length >= 2, 'drawer summary lists movements');

  const zReport = await ok(`/reports/z-report/${drawerId}`, { token: manager });
  expect(zReport.report?.id === drawerId, 'Z-report is available for the closed drawer');

  step('credit sales, receipts and returns');
  const cardSale = await ok('/sales', {
    method: 'POST',
    token: cashier,
    body: {
      location_id: main.id,
      items: [{ product_id: productId, quantity: 2 }],
      payments: [{ method_id: cardMethod.id, amount: 27.5 }],
    },
  }, 201);
  expect(nearly(cardSale.sale.paid, 27.5) && nearly(cardSale.sale.due, 0), 'card sale fully paid');

  const creditSale = await ok('/sales', {
    method: 'POST',
    token: cashier,
    body: {
      location_id: main.id,
      customer_id: customer.customer.id,
      items: [{ product_id: productId, quantity: 1 }],
      payments: [],
    },
  }, 201);
  expect(nearly(creditSale.sale.due, 13.75), 'credit sale leaves 13.75 due');

  const receipt = await ok('/customer-payments', {
    method: 'POST',
    token: cashier,
    body: {
      customer_id: customer.customer.id,
      sale_id: creditSale.sale.id,
      amount: 13.75,
      method_id: bankMethod.id,
      reference: `SMK-RCPT-${stamp}`,
      date: today,
    },
  }, 201);
  expect(nearly(receipt.receipt.allocations[0]?.amount, 13.75), 'customer receipt allocated to the invoice');

  const afterReceipt = await ok(`/sales/${creditSale.sale.id}`, { token: cashier });
  expect(nearly(afterReceipt.sale.due, 0), 'invoice is settled after receipt');

  const saleItem = cardSale.sale.items[0];
  const saleReturn = await ok(`/sales/${cardSale.sale.id}/returns`, {
    method: 'POST',
    token: cashier,
    body: {
      items: [{ sale_item_id: saleItem.id, quantity: 1 }],
      method_id: cardMethod.id,
      reason: 'Smoke test return',
    },
  }, 201);
  expect(nearly(saleReturn.return.total, 13.75), 'card refund totals 13.75', saleReturn.return);

  const { inventory } = await ok(`/inventory?search=SMK-${stamp}&location_id=${main.id}`, { token: manager });
  expect(inventory.length === 1 && nearly(inventory[0].quantity, 13), 'stock reflects 10 adjusted + 5 purchased − 2 sold − 1 credit + 1 returned = 13', inventory);

  step('expenses and manual journals');
  const expense = await ok('/accounting/expenses', {
    method: 'POST',
    token: accountant,
    body: {
      account_id: officeSupplies.id,
      amount: 25,
      method_id: bankMethod.id,
      notes: 'Smoke test supplies',
      reference: `SMK-EXP-${stamp}`,
      date: today,
    },
  }, 201);
  expect(nearly(expense.expense.amount, 25), 'expense recorded');

  const manual = await ok('/accounting/journal', {
    method: 'POST',
    token: accountant,
    body: {
      date: today,
      memo: `Smoke test manual entry ${stamp}`,
      lines: [
        { account_id: bankAccount.id, debit: 10, description: 'Smoke test debit' },
        { account_id: salesAccount.id, credit: 10, description: 'Smoke test credit' },
      ],
    },
  }, 201);
  const journalDetail = await ok(`/accounting/journal/${manual.entry.id}`, { token: accountant });
  expect(journalDetail.entry.lines.length === 2, 'manual journal has two lines');

  const unbalanced = await request('/accounting/journal', {
    method: 'POST',
    token: accountant,
    body: {
      date: today,
      memo: 'Unbalanced smoke test',
      lines: [
        { account_id: bankAccount.id, debit: 10 },
        { account_id: salesAccount.id, credit: 9 },
      ],
    },
  });
  expect(unbalanced.status >= 400, 'unbalanced manual journals are rejected', unbalanced.text.slice(0, 160));

  step('users and settings');
  const newUser = await ok('/users', {
    method: 'POST',
    token: admin,
    body: {
      name: `Smoke Operator ${stamp}`,
      email: `smoke-${stamp}@ledgerpos.local`,
      password: 'Smoke@123',
      role: 'cashier',
      location_id: main.id,
    },
  }, 201);
  const newUserToken = await login(`smoke-${stamp}@ledgerpos.local`, 'Smoke@123');
  expect(typeof newUserToken === 'string', 'new user can sign in');

  await ok(`/users/${newUser.user.id}`, {
    method: 'PUT',
    token: admin,
    body: { is_active: false, role: 'cashier' },
  });
  const deactivated = await request('/auth/login', {
    method: 'POST',
    body: { email: `smoke-${stamp}@ledgerpos.local`, password: 'Smoke@123' },
  });
  expect(deactivated.status === 403 || deactivated.status === 401, 'deactivated user cannot sign in');

  const originalFooter = settingsData.settings.pos.receipt_footer;
  const savedSettings = await ok('/settings', {
    method: 'PUT',
    token: admin,
    body: { pos: { ...settingsData.settings.pos, receipt_footer: `${originalFooter} [smoke ${stamp}]` } },
  });
  expect(savedSettings.settings.pos.receipt_footer.includes(`[smoke ${stamp}]`), 'settings update persists');
  await ok('/settings', {
    method: 'PUT',
    token: admin,
    body: { pos: { ...settingsData.settings.pos, receipt_footer: originalFooter } },
  });
  expect(true, 'settings restored');

  step('dashboards and reports');
  for (const [view, token, label] of [
    ['executive', admin, 'admin'],
    ['operations', admin, 'admin'],
    ['finance', accountant, 'accountant'],
    ['cashier', cashier, 'cashier'],
  ]) {
    const dash = await ok(`/dashboard?view=${view}`, { token });
    expect(dash && typeof dash === 'object', `dashboard view "${view}" loads for ${label}`);
  }

  const from = daysAgo(60);
  const reportPaths = [
    '/reports/sales-summary', '/reports/sales-by-product', '/reports/sales-by-category',
    '/reports/sales-by-cashier', '/reports/sales-by-location', '/reports/payment-methods',
    '/reports/tax', '/reports/hourly', '/reports/inventory-valuation', '/reports/stock-movements',
    '/reports/customer-balances', '/reports/supplier-balances', '/reports/ar-aging',
    '/reports/ap-aging', '/reports/cash-flow',
  ];
  for (const path of reportPaths) {
    const data = await ok(`${path}?from=${from}&to=${today}`, { token: accountant });
    expect(data && typeof data === 'object', `${path} responds`);
  }

  const tb = await ok(`/accounting/trial-balance?from=${from}&to=${today}`, { token: accountant });
  expect(nearly(tb.total_debit, tb.total_credit), `trial balance is balanced (${tb.total_debit.toFixed(2)} debit / ${tb.total_credit.toFixed(2)} credit)`);

  const pnl = await ok(`/accounting/pnl?from=${from}&to=${today}`, { token: accountant });
  expect(typeof pnl.net_profit === 'number' || typeof pnl.net_income === 'number', 'profit and loss computes a result');

  const bs = await ok(`/accounting/balance-sheet?as_of=${today}`, { token: accountant });
  expect(nearly(bs.difference, 0), 'balance sheet balances (assets = liabilities + equity)', { difference: bs.difference });
  expect(nearly(bs.total_assets, bs.total_liabilities_equity), 'balance sheet totals agree');

  const cf = await ok(`/accounting/cash-flow?from=${from}&to=${today}`, { token: accountant });
  expect(cf && typeof cf === 'object', 'cash flow statement responds');

  const statements = await ok(`/accounting/customer-statement/${customer.customer.id}`, { token: accountant });
  expect(statements && typeof statements === 'object', 'customer statement responds');
  const supplierStatement = await ok(`/accounting/supplier-statement/${supplier.supplier.id}`, { token: accountant });
  expect(supplierStatement && typeof supplierStatement === 'object', 'supplier statement responds');

  console.log(`\n✅ Smoke test passed — ${checks} checks, ledger balanced.`);
  console.log(`   Created test records tagged ${stamp} (product, customer, supplier, purchase, sales, expense, user).`);
}

main().catch((err) => {
  if (err instanceof SmokeError) {
    console.error(`\n❌ Smoke test failed: ${err.message}`);
  } else {
    console.error('\n❌ Smoke test crashed:', err);
  }
  process.exitCode = 1;
});
