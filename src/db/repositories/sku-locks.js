import { query } from '../index.js';
import crypto from 'crypto';

const DEFAULT_TTL_SEC = 30;

export function newOwnerId(prefix = 'p') {
  return `${prefix}-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * Adquiere un lock por SKU. TTL en segundos.
 * Retorna { acquired: true, owner } si tomó el lock (o ya era suyo expirado).
 * Retorna { acquired: false, currentOwner } si otro lo tiene activo.
 *
 * Estrategia: INSERT con ON CONFLICT DO UPDATE pero solo si el lock previo expiró.
 */
export async function acquire(sku, owner, ttlSec = DEFAULT_TTL_SEC) {
  if (!sku) throw new Error('acquire: sku requerido');
  if (!owner) throw new Error('acquire: owner requerido');
  const res = await query(
    `INSERT INTO sku_locks (sku, owner, acquired_at, expires_at)
     VALUES ($1, $2, now(), now() + ($3 || ' seconds')::interval)
     ON CONFLICT (sku) DO UPDATE
       SET owner = EXCLUDED.owner,
           acquired_at = EXCLUDED.acquired_at,
           expires_at = EXCLUDED.expires_at
       WHERE sku_locks.expires_at < now() OR sku_locks.owner = EXCLUDED.owner
     RETURNING owner`,
    [String(sku).trim(), owner, ttlSec],
  );
  if (res.rowCount > 0 && res.rows[0].owner === owner) {
    return { acquired: true, owner };
  }
  // Otro tiene el lock activo. Leemos quién lo tiene.
  const cur = await query(
    `SELECT owner, expires_at FROM sku_locks WHERE sku = $1`,
    [String(sku).trim()],
  );
  return {
    acquired: false,
    currentOwner: cur.rows[0]?.owner,
    expiresAt: cur.rows[0]?.expires_at,
  };
}

/**
 * Libera el lock solo si el owner coincide (evita liberar el lock de otro).
 */
export async function release(sku, owner) {
  if (!sku || !owner) return false;
  const res = await query(
    `DELETE FROM sku_locks WHERE sku = $1 AND owner = $2`,
    [String(sku).trim(), owner],
  );
  return res.rowCount > 0;
}

/**
 * Wrapper "with lock": adquiere, ejecuta fn, libera. Reintenta hasta `retries`
 * veces si el lock está ocupado. Si nunca lo consigue, throws.
 */
export async function withLock(sku, fn, { ttlSec = DEFAULT_TTL_SEC, retries = 5, retryDelayMs = 200 } = {}) {
  const owner = newOwnerId('w');
  let lastResult = null;
  for (let i = 0; i <= retries; i++) {
    const r = await acquire(sku, owner, ttlSec);
    if (r.acquired) {
      try {
        return await fn();
      } finally {
        await release(sku, owner).catch(() => {});
      }
    }
    lastResult = r;
    if (i < retries) {
      await new Promise((res) => setTimeout(res, retryDelayMs * Math.pow(1.5, i)));
    }
  }
  const err = new Error(`No se pudo adquirir lock para sku=${sku} después de ${retries + 1} intentos (current owner: ${lastResult?.currentOwner})`);
  err.code = 'LOCK_BUSY';
  throw err;
}

/**
 * Limpieza de locks expirados (job opcional). Por ahora no se llama.
 */
export async function cleanExpired() {
  const res = await query(`DELETE FROM sku_locks WHERE expires_at < now()`);
  return res.rowCount;
}
