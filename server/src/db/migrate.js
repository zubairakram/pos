import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { pool, query } from './index.js';

const dir = fileURLToPath(new URL('./migrations', import.meta.url));

async function main() {
  const reset = process.argv.includes('--reset');
  if (reset) {
    console.log('[migrate] dropping schema public …');
    await query('DROP SCHEMA public CASCADE');
    await query('CREATE SCHEMA public');
  }

  await query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);

  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const { rows } = await query('SELECT 1 FROM schema_migrations WHERE name = $1', [file]);
    if (rows.length) {
      console.log(`[migrate] ${file} already applied`);
      continue;
    }
    const sql = await readFile(path.join(dir, file), 'utf8');
    console.log(`[migrate] applying ${file}`);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`[migrate] ${file} ok`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
