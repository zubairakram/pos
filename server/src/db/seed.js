import bcrypt from 'bcryptjs';
import { pool, withTransaction, query } from './index.js';
import { postJournal } from '../services/accounting.js';

const ACCOUNTS = [
  ['1000', 'Cash on Hand', 'asset', 'cash'],
  ['1001', 'Main Counter Cash', 'asset', 'cash', '1000'],
  ['1002', 'Express Counter Cash', 'asset', 'cash', '1000'],
  ['1010', 'Bank Account', 'asset', 'bank'],
  ['1020', 'Card Clearing', 'asset', 'clearing'],
  ['1030', 'Mobile Wallet Clearing', 'asset', 'clearing'],
  ['1100', 'Accounts Receivable', 'asset', 'receivable'],
  ['1200', 'Inventory', 'asset', 'inventory'],
  ['1300', 'Prepaid Expenses', 'asset', 'current_asset'],
  ['1400', 'Tax Receivable', 'asset', 'tax'],
  ['1500', 'Store Equipment', 'asset', 'fixed_asset'],
  ['1510', 'Accumulated Depreciation', 'asset', 'accumulated_depreciation'],
  ['2000', 'Accounts Payable', 'liability', 'payable'],
  ['2100', 'Sales Tax Payable', 'liability', 'tax'],
  ['2200', 'Accrued Salaries', 'liability', 'current_liability'],
  ['2300', 'Loans Payable', 'liability', 'loan'],
  ['3000', "Owner's Capital", 'equity', 'capital'],
  ['3100', "Owner's Drawings", 'equity', 'drawings'],
  ['3200', 'Opening Balance Equity', 'equity', 'opening_balance'],
  ['3900', 'Retained Earnings', 'equity', 'retained_earnings'],
  ['4000', 'Sales Revenue', 'revenue', 'sales'],
  ['4020', 'Sales Returns & Allowances', 'revenue', 'sales_returns'],
  ['4100', 'Other Income', 'revenue', 'other_income'],
  ['5000', 'Cost of Goods Sold', 'expense', 'cogs'],
  ['5100', 'Inventory Adjustments', 'expense', 'inventory_adjustment'],
  ['6000', 'Salaries & Wages', 'expense', 'operating'],
  ['6100', 'Rent Expense', 'expense', 'operating'],
  ['6200', 'Utilities Expense', 'expense', 'operating'],
  ['6300', 'Cash Over / Short', 'expense', 'operating'],
  ['6400', 'Bank & Card Fees', 'expense', 'operating'],
  ['6500', 'Marketing Expense', 'expense', 'operating'],
  ['6600', 'Depreciation Expense', 'expense', 'operating'],
  ['6700', 'Office Supplies', 'expense', 'operating'],
  ['6800', 'Repairs & Maintenance', 'expense', 'operating'],
  ['6900', 'Miscellaneous Expense', 'expense', 'operating'],
];

const MAPPINGS = {
  ar: '1100', ap: '2000', inventory: '1200', tax_payable: '2100', tax_receivable: '1400',
  sales: '4000', sales_returns: '4020', cogs: '5000', inventory_adjustment: '5100',
  cash_over_short: '6300', opening_balance_equity: '3200', owner_capital: '3000',
  owner_drawings: '3100', retained_earnings: '3900', bank: '1010',
};

const PRODUCTS = [
  { sku: 'COF-250', barcode: '1000000000017', name: 'Arabica Coffee 250g', category: 'Grocery', unit: 'pack', cost: 4.2, price: 6.5, tax: 'GST 17%', reorder: 10, main: 48, wh: 120 },
  { sku: 'TEA-100', barcode: '1000000000024', name: 'Green Tea 100 Bags', category: 'Grocery', unit: 'box', cost: 2.8, price: 4.9, reorder: 8, main: 32, wh: 80 },
  { sku: 'COL-330', barcode: '1000000000031', name: 'Cola 330ml', category: 'Beverages', unit: 'pcs', cost: 0.45, price: 0.9, tax: 'Reduced VAT 5%', reorder: 40, main: 240, wh: 480 },
  { sku: 'SPW-500', barcode: '1000000000048', name: 'Sparkling Water 500ml', category: 'Beverages', unit: 'bottle', cost: 0.3, price: 0.75, tax: 'Reduced VAT 5%', reorder: 30, main: 180, wh: 300 },
  { sku: 'OJ-1L', barcode: '1000000000055', name: 'Orange Juice 1L', category: 'Beverages', unit: 'bottle', cost: 1.2, price: 2.5, reorder: 12, main: 60, wh: 90 },
  { sku: 'CHP-150', barcode: '1000000000062', name: 'Potato Chips 150g', category: 'Snacks', unit: 'pack', cost: 1.1, price: 2.0, reorder: 20, main: 90, wh: 140 },
  { sku: 'CHO-50', barcode: '1000000000079', name: 'Milk Chocolate Bar 50g', category: 'Snacks', unit: 'pcs', cost: 0.9, price: 1.8, reorder: 25, main: 120, wh: 200 },
  { sku: 'PEA-200', barcode: '1000000000086', name: 'Salted Peanuts 200g', category: 'Snacks', unit: 'pack', cost: 0.8, price: 1.6, reorder: 15, main: 70, wh: 110 },
  { sku: 'MIL-1L', barcode: '1000000000093', name: 'Whole Milk 1L', category: 'Grocery', unit: 'bottle', cost: 0.95, price: 1.75, reorder: 24, main: 96, wh: 60 },
  { sku: 'BRD-600', barcode: '1000000000109', name: 'Whole Wheat Bread 600g', category: 'Bakery', unit: 'pcs', cost: 1.2, price: 2.2, reorder: 12, main: 40, wh: 20 },
  { sku: 'EGG-12', barcode: '1000000000116', name: 'Free Range Eggs (12)', category: 'Grocery', unit: 'box', cost: 2.1, price: 3.5, reorder: 10, main: 45, wh: 30 },
  { sku: 'RIC-1K', barcode: '1000000000123', name: 'Basmati Rice 1kg', category: 'Grocery', unit: 'kg', cost: 2.6, price: 4.3, reorder: 20, main: 80, wh: 220 },
  { sku: 'OIL-500', barcode: '1000000000130', name: 'Olive Oil 500ml', category: 'Grocery', unit: 'bottle', cost: 5.5, price: 8.9, tax: 'GST 17%', reorder: 8, main: 26, wh: 70 },
  { sku: 'PAS-500', barcode: '1000000000147', name: 'Penne Pasta 500g', category: 'Grocery', unit: 'pack', cost: 0.9, price: 1.7, reorder: 18, main: 65, wh: 100 },
  { sku: 'SOA-250', barcode: '1000000000154', name: 'Liquid Hand Soap 250ml', category: 'Household', unit: 'bottle', cost: 1.5, price: 2.8, reorder: 12, main: 44, wh: 80 },
  { sku: 'TWL-2', barcode: '1000000000161', name: 'Paper Towels 2-pack', category: 'Household', unit: 'pack', cost: 2.0, price: 3.6, reorder: 10, main: 30, wh: 60 },
  { sku: 'BAT-AA4', barcode: '1000000000178', name: 'AA Batteries (4-pack)', category: 'Electronics', unit: 'pack', cost: 2.4, price: 4.5, tax: 'GST 17%', reorder: 8, main: 22, wh: 45 },
  { sku: 'CHR-20W', barcode: '1000000000185', name: 'USB-C Charger 20W', category: 'Electronics', unit: 'pcs', cost: 7.5, price: 14.9, tax: 'GST 17%', reorder: 5, main: 12, wh: 24 },
  { sku: 'GIFT', barcode: '1000000000192', name: 'Gift Wrapping Service', category: 'Services', unit: 'pcs', cost: 0, price: 2.0, reorder: 0, main: 0, wh: 0, track: false },
  { sku: 'DELIV', barcode: '1000000000208', name: 'Local Delivery Fee', category: 'Services', unit: 'pcs', cost: 0, price: 3.5, reorder: 0, main: 0, wh: 0, track: false },
];

async function main() {
  const force = process.argv.includes('--force');
  const { rows: existing } = await query('SELECT COUNT(*)::int AS n FROM users');
  if (existing[0].n > 0 && !force) {
    console.log('[seed] database already seeded (run with --force to reseed). Use npm run db:reset for a clean database.');
    await pool.end();
    return;
  }

  await withTransaction(async (client) => {
    if (force) {
      await client.query(`TRUNCATE
        audit_logs, expenses, journal_lines, journal_entries, payments, return_items, sale_returns,
        sale_items, sales, purchase_items, purchases, cash_movements, cash_sessions, stock_transfer_items,
        stock_transfers, stock_moves, inventory, products, categories, units, customers, suppliers,
        cash_registers, payment_methods, tax_rates, account_mappings, accounts, users, locations,
        settings, document_sequences RESTART IDENTITY CASCADE`);
    }

    /* settings */
    const settings = {
      company: {
        name: 'Northwind Retail Co.', legal_name: 'Northwind Retail Company LLC', tax_number: 'TX-8842-019',
        phone: '+1 (555) 010-2200', email: 'hello@northwind.example', address: '42 Market Street, Springfield',
        currency: 'USD', currency_symbol: '$', currency_decimals: 2,
      },
      pos: {
        invoice_prefix: 'INV', purchase_prefix: 'PUR', return_prefix: 'RET',
        receipt_footer: 'Thank you for shopping with Northwind. Returns accepted within 14 days with receipt.',
        allow_negative_stock: false, default_due_days: 30,
      },
      accounting: { fiscal_year_start: '01-01', lock_date: null },
    };
    for (const [key, value] of Object.entries(settings)) {
      await client.query('INSERT INTO settings (key, value) VALUES ($1,$2)', [key, JSON.stringify(value)]);
    }

    /* locations */
    const locations = {};
    for (const [code, name, type, address] of [
      ['MAIN', 'Main Store', 'store', '42 Market Street, Springfield'],
      ['EXPRESS', 'Express Store', 'store', '18 Station Road, Springfield'],
      ['WH', 'Central Warehouse', 'warehouse', 'Unit 7, Industrial Park'],
    ]) {
      const { rows } = await client.query(
        'INSERT INTO locations (code, name, type, address) VALUES ($1,$2,$3,$4) RETURNING *',
        [code, name, type, address]
      );
      locations[code] = rows[0];
    }

    /* chart of accounts */
    const accounts = {};
    for (const [code, name, type, subtype, parentCode] of ACCOUNTS) {
      const { rows } = await client.query(
        `INSERT INTO accounts (code, name, type, subtype, parent_id, is_system)
         VALUES ($1,$2,$3,$4,$5,true) RETURNING *`,
        [code, name, type, subtype, parentCode ? accounts[parentCode].id : null]
      );
      accounts[code] = rows[0];
    }
    for (const [key, code] of Object.entries(MAPPINGS)) {
      await client.query('INSERT INTO account_mappings (key, account_id) VALUES ($1,$2)', [key, accounts[code].id]);
    }

    /* users */
    const passwordFor = (p) => bcrypt.hashSync(p, 10);
    const users = {};
    for (const u of [
      { name: 'Avery Morgan', email: 'admin@ledgerpos.local', password: 'Admin@123', role: 'admin', location: 'MAIN' },
      { name: 'Jordan Blake', email: 'manager@ledgerpos.local', password: 'Manager@123', role: 'manager', location: 'MAIN' },
      { name: 'Priya Nair', email: 'accountant@ledgerpos.local', password: 'Account@123', role: 'accountant', location: 'MAIN' },
      { name: 'Sam Rivera', email: 'cashier@ledgerpos.local', password: 'Cashier@123', role: 'cashier', location: 'MAIN' },
      { name: 'Taylor Chen', email: 'store@ledgerpos.local', password: 'Store@123', role: 'storekeeper', location: 'WH' },
    ]) {
      const { rows } = await client.query(
        `INSERT INTO users (name, email, password_hash, role, location_id, phone)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [u.name, u.email, passwordFor(u.password), u.role, locations[u.location].id, '+1 (555) 010-0100']
      );
      users[u.role] = rows[0];
    }

    /* tax rates */
    const taxes = {};
    for (const [name, rate, inclusive] of [
      ['GST 17%', 17, false],
      ['Reduced VAT 5%', 5, false],
      ['VAT 5% inclusive', 5, true],
    ]) {
      const { rows } = await client.query(
        'INSERT INTO tax_rates (name, rate, is_inclusive) VALUES ($1,$2,$3) RETURNING *',
        [name, rate, inclusive]
      );
      taxes[name] = rows[0];
    }

    /* payment methods */
    for (const [code, name, type, accountCode, ref] of [
      ['CASH', 'Cash', 'cash', '1001', false],
      ['CARD', 'Credit / Debit Card', 'card', '1020', false],
      ['BANK', 'Bank Transfer', 'bank', '1010', true],
      ['WALLET', 'Mobile Wallet', 'wallet', '1030', false],
    ]) {
      await client.query(
        `INSERT INTO payment_methods (code, name, type, account_id, requires_reference)
         VALUES ($1,$2,$3,$4,$5)`,
        [code, name, type, accounts[accountCode].id, ref]
      );
    }

    /* registers */
    for (const [name, code, account] of [
      ['Counter 1', 'MAIN', '1001'],
      ['Express Counter', 'EXPRESS', '1002'],
    ]) {
      await client.query(
        'INSERT INTO cash_registers (name, location_id, account_id) VALUES ($1,$2,$3)',
        [name, locations[code].id, accounts[account].id]
      );
    }

    /* categories, units, products */
    const categories = {};
    for (const name of ['Beverages', 'Snacks', 'Grocery', 'Bakery', 'Household', 'Electronics', 'Services']) {
      const { rows } = await client.query('INSERT INTO categories (name) VALUES ($1) RETURNING *', [name]);
      categories[name] = rows[0];
    }
    const units = {};
    for (const [name, short] of [['Pieces', 'pcs'], ['Pack', 'pack'], ['Box', 'box'], ['Kilogram', 'kg'], ['Litre', 'litre'], ['Bottle', 'bottle']]) {
      const { rows } = await client.query('INSERT INTO units (name, short_name) VALUES ($1,$2) RETURNING *', [name, short]);
      units[short] = rows[0];
    }

    let inventoryValue = 0;
    for (const p of PRODUCTS) {
      const { rows } = await client.query(
        `INSERT INTO products (sku, barcode, name, category_id, unit_id, cost_price, sale_price,
           tax_rate_id, track_inventory, reorder_level)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [p.sku, p.barcode, p.name, categories[p.category].id, units[p.unit].id, p.cost, p.price,
          p.tax ? taxes[p.tax].id : null, p.track !== false, p.reorder]
      );
      const prod = rows[0];
      if (p.track !== false) {
        for (const [locCode, qty] of [['MAIN', p.main], ['WH', p.wh]]) {
          if (qty <= 0) continue;
          await client.query(
            'INSERT INTO inventory (product_id, location_id, quantity, avg_cost) VALUES ($1,$2,$3,$4)',
            [prod.id, locations[locCode].id, qty, p.cost]
          );
          await client.query(
            `INSERT INTO stock_moves (product_id, location_id, type, quantity, unit_cost, total_cost, ref_type, user_id, note, created_at)
             VALUES ($1,$2,'opening',$3,$4,$5,'opening',$6,'Opening stock', now() - interval '45 days')`,
            [prod.id, locations[locCode].id, qty, p.cost, Math.round(qty * p.cost * 100) / 100, users.admin.id]
          );
          inventoryValue += qty * p.cost;
        }
      }
    }
    inventoryValue = Math.round(inventoryValue * 100) / 100;

    /* contacts */
    const customers = {};
    for (const [code, name, phone, email, limit, opening] of [
      ['CUS-0001', 'Acme Corporation', '+1 (555) 220-1180', 'accounts@acme.example', 5000, 0],
      ['CUS-0002', 'Sara Khan', '+1 (555) 220-1181', 'sara.khan@example.com', 500, 0],
      ['CUS-0003', 'Blue Cafe', '+1 (555) 220-1182', 'orders@bluecafe.example', 2000, 0],
    ]) {
      const { rows } = await client.query(
        `INSERT INTO customers (code, name, phone, email, credit_limit, opening_balance)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [code, name, phone, email, limit, opening]
      );
      customers[code] = rows[0];
    }
    const suppliers = {};
    for (const [code, name, phone, email] of [
      ['SUP-0001', 'Global Distributors', '+1 (555) 330-2200', 'orders@globaldist.example'],
      ['SUP-0002', 'Fresh Foods Co.', '+1 (555) 330-2201', 'supply@freshfoods.example'],
      ['SUP-0003', 'TechSource Ltd.', '+1 (555) 330-2202', 'sales@techsource.example'],
    ]) {
      const { rows } = await client.query(
        'INSERT INTO suppliers (code, name, phone, email) VALUES ($1,$2,$3,$4) RETURNING *',
        [code, name, phone, email]
      );
      suppliers[code] = rows[0];
    }

    /* opening balance sheet: cash + bank + inventory, funded by opening equity */
    const openingCash = 1500;
    const openingBank = 12000;
    const totalOpening = Math.round((openingCash + openingBank + inventoryValue) * 100) / 100;
    await postJournal(client, {
      date: new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10),
      memo: 'Opening balances',
      sourceType: 'opening_balance',
      sourceId: 0,
      locationId: locations.MAIN.id,
      userId: users.admin.id,
      lines: [
        { account_id: accounts['1001'].id, debit: openingCash, description: 'Opening cash' },
        { account_id: accounts['1010'].id, debit: openingBank, description: 'Opening bank balance' },
        { account_id: accounts['1200'].id, debit: inventoryValue, description: 'Opening inventory' },
        { account_id: accounts['3200'].id, credit: totalOpening, description: 'Opening balance equity' },
      ],
    });

    /* current open drawer for the demo cashier */
    const { rows: regRows } = await client.query("SELECT * FROM cash_registers WHERE name = 'Counter 1'");
    await client.query(
      `INSERT INTO cash_sessions (register_id, user_id, opening_float, opening_note)
       VALUES ($1,$2,300,'Morning shift')`,
      [regRows[0].id, users.cashier.id]
    );

    console.log(`[seed] done — ${PRODUCTS.length} products, opening inventory ${inventoryValue.toFixed(2)}`);
  });

  await pool.end();
}

main().catch(async (err) => {
  console.error('[seed] failed', err);
  try { await pool.end(); } catch { /* ignore */ }
  process.exit(1);
});
