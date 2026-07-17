import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getPool, query } from './index.js';
import { logger } from '../logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name        text PRIMARY KEY,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function applied() {
  const res = await query('SELECT name FROM _migrations ORDER BY name');
  return new Set(res.rows.map((r) => r.name));
}

/**
 * Aplica las migraciones pendientes (idempotente: registra cada archivo en
 * _migrations y salta los ya aplicados). La usa el CLI `npm run migrate` y
 * también el arranque del webhook-server (Render no tiene release phase, así
 * que el deploy de un feature con tabla nueva migra solo al primer boot).
 * @returns {Promise<number>} cantidad de migraciones aplicadas
 */
export async function runPendingMigrations() {
  getPool();
  await ensureTable();
  const done = await applied();
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();

  let n = 0;
  for (const file of files) {
    if (done.has(file)) {
      logger.debug({ file }, 'migration already applied');
      continue;
    }
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    logger.info({ file }, 'applying migration');
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO _migrations(name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      n++;
      logger.info({ file }, 'migration applied');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      logger.error({ err, file }, 'migration failed');
      throw err;
    } finally {
      client.release();
    }
  }
  logger.info({ applied: n, total: files.length }, 'migrations done');
  return n;
}
