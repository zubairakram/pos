import { assert, round2, todayISO } from '../utils.js';
import { nextDoc } from './documents.js';

export async function getMappings(client) {
  const { rows } = await client.query('SELECT key, account_id FROM account_mappings');
  return Object.fromEntries(rows.map((r) => [r.key, r.account_id]));
}

export async function mapping(client, key) {
  const { rows } = await client.query('SELECT account_id FROM account_mappings WHERE key = $1', [key]);
  assert(rows.length, 500, `Accounting is not configured: missing mapping "${key}"`);
  return rows[0].account_id;
}

/**
 * Posts a balanced, double-entry journal. This is the only write path into the ledger.
 */
export async function postJournal(client, { date, memo, sourceType, sourceId = null, locationId = null, userId = null, lines }) {
  assert(Array.isArray(lines) && lines.length > 0, 400, 'Journal entry needs at least one line');
  const entryDate = date || todayISO();

  const cleaned = lines
    .map((l) => ({
      account_id: Number(l.account_id),
      debit: round2(l.debit || 0),
      credit: round2(l.credit || 0),
      description: l.description || null,
      customer_id: l.customer_id || null,
      supplier_id: l.supplier_id || null,
    }))
    .filter((l) => l.debit !== 0 || l.credit !== 0);

  assert(cleaned.length > 0, 400, 'Journal entry has no monetary lines');
  for (const l of cleaned) {
    assert(l.account_id, 400, 'Every journal line needs an account');
    assert(l.debit === 0 || l.credit === 0, 400, 'A journal line cannot have both debit and credit');
    assert(l.debit >= 0 && l.credit >= 0, 400, 'Journal amounts cannot be negative');
  }

  const debit = round2(cleaned.reduce((s, l) => s + l.debit, 0));
  const credit = round2(cleaned.reduce((s, l) => s + l.credit, 0));
  assert(Math.abs(debit - credit) < 0.005, 500, `Unbalanced journal entry (debit ${debit}, credit ${credit})`, { debit, credit });

  const entryNo = await nextDoc(client, 'journal', 'JE', new Date(`${entryDate}T12:00:00Z`));
  const { rows } = await client.query(
    `INSERT INTO journal_entries (entry_no, entry_date, memo, source_type, source_id, location_id, user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [entryNo, entryDate, memo || sourceType, sourceType, sourceId, locationId, userId]
  );
  const entry = rows[0];

  for (const l of cleaned) {
    await client.query(
      `INSERT INTO journal_lines (entry_id, account_id, debit, credit, description, customer_id, supplier_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [entry.id, l.account_id, l.debit, l.credit, l.description, l.customer_id, l.supplier_id]
    );
  }
  return entry;
}

/** Reverses the journal tied to a source document (used for voids). */
export async function reverseJournalsFor(client, sourceType, sourceId, { memo, userId, locationId, date }) {
  const { rows } = await client.query(
    `SELECT * FROM journal_entries WHERE source_type = $1 AND source_id = $2 AND is_posted = true`,
    [sourceType, sourceId]
  );
  const created = [];
  for (const entry of rows) {
    const { rows: lines } = await client.query('SELECT * FROM journal_lines WHERE entry_id = $1', [entry.id]);
    created.push(
      await postJournal(client, {
        date: date || todayISO(),
        memo: memo || `Reversal of ${entry.entry_no}`,
        sourceType: `${sourceType}_void`,
        sourceId,
        locationId: locationId ?? entry.location_id,
        userId,
        lines: lines.map((l) => ({
          account_id: l.account_id,
          debit: l.credit,
          credit: l.debit,
          description: `Reversal — ${l.description || entry.entry_no}`,
          customer_id: l.customer_id,
          supplier_id: l.supplier_id,
        })),
      })
    );
  }
  return created;
}

export async function accountByCode(client, code) {
  const { rows } = await client.query('SELECT * FROM accounts WHERE code = $1', [code]);
  assert(rows.length, 500, `Account ${code} not found`);
  return rows[0];
}
