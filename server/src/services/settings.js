import { query } from '../db/index.js';

const DEFAULTS = {
  company: {
    name: 'Ledger POS',
    legal_name: '',
    tax_number: '',
    phone: '',
    email: '',
    address: '',
    currency: 'USD',
    currency_symbol: '$',
    currency_decimals: 2,
  },
  pos: {
    invoice_prefix: 'INV',
    purchase_prefix: 'PUR',
    return_prefix: 'RET',
    receipt_footer: 'Thank you for your business!',
    allow_negative_stock: false,
    default_due_days: 30,
  },
  accounting: {
    fiscal_year_start: '01-01',
    lock_date: null,
  },
};

export async function getSettings(client = null) {
  const runner = client || { query: (t, p) => query(t, p) };
  const { rows } = await runner.query('SELECT key, value FROM settings');
  const merged = structuredClone(DEFAULTS);
  for (const row of rows) {
    merged[row.key] = { ...(merged[row.key] || {}), ...row.value };
  }
  return merged;
}

export async function saveSetting(client, key, value) {
  await client.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = settings.value || $2, updated_at = now()`,
    [key, JSON.stringify(value)]
  );
}
