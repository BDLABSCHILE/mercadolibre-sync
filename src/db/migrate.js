import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getPool, query, close } from './index.js';
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

async function run() {
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
}

run()
  .then(() => close())
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, 'migrate error');
    close().finally(() => process.exit(1));
  });
