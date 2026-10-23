import pg from 'pg';
import { config } from '../config.js';

// Keep money and quantity values as JS numbers, dates as plain YYYY-MM-DD strings.
pg.types.setTypeParser(20, (v) => Number(v)); // int8
pg.types.setTypeParser(1700, (v) => Number(v)); // numeric
pg.types.setTypeParser(1082, (v) => v); // date

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on('error', (err) => {
  console.error('[db] idle client error', err);
});

export function query(text, params) {
  return pool.query(text, params);
}

export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore rollback failure */
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool() {
  await pool.end();
}
