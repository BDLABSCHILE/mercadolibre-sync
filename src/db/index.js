import pg from 'pg';
import { config } from '../config.js';
import { logger } from '../logger.js';

const { Pool } = pg;

let pool = null;

export function getPool() {
  if (pool) return pool;
  if (!config.DATABASE_URL) {
    throw new Error('DATABASE_URL no configurado. La capa DB aún no está conectada.');
  }
  pool = new Pool({
    connectionString: config.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
  pool.on('error', (err) => {
    logger.error({ err }, 'pg pool error');
  });
  return pool;
}

export async function query(text, params) {
  const p = getPool();
  const start = Date.now();
  try {
    const res = await p.query(text, params);
    if (Date.now() - start > 500) {
      logger.warn({ ms: Date.now() - start, text: text.slice(0, 120) }, 'slow query');
    }
    return res;
  } catch (err) {
    logger.error({ err, text: text.slice(0, 120) }, 'query failed');
    throw err;
  }
}

export async function withTx(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function ping() {
  const res = await query('SELECT 1 AS ok');
  return res.rows[0]?.ok === 1;
}

export async function close() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
