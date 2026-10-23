import { assert } from '../utils.js';

/**
 * Atomically reserves the next daily document number, e.g. SALE-20261022-0007.
 * The sequence key includes the date, so numbering restarts each day.
 */
export async function nextDoc(client, key, prefix, date = new Date()) {
  const day = date.toISOString().slice(0, 10).replaceAll('-', '');
  const seqKey = `${key}:${day}`;
  const { rows } = await client.query(
    `INSERT INTO document_sequences (key, prefix, next_number)
     VALUES ($1, $2, 1)
     ON CONFLICT (key) DO UPDATE SET next_number = document_sequences.next_number + 1
     RETURNING next_number`,
    [seqKey, prefix]
  );
  const n = rows[0].next_number;
  assert(n > 0, 500, 'Failed to generate document number');
  return `${prefix}-${day}-${String(n).padStart(4, '0')}`;
}
