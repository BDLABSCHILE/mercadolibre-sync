import { query } from '../index.js';

const COLS = 'sku, platform, stock, price, last_synced_at, last_source';

function rowToState(r) {
  if (!r) return null;
  return {
    sku: r.sku,
    platform: r.platform,
    stock: r.stock,
    price: r.price != null ? Number(r.price) : null,
    lastSyncedAt: r.last_synced_at,
    lastSource: r.last_source,
  };
}

export async function get(sku, platform) {
  const res = await query(
    `SELECT ${COLS} FROM platform_state WHERE sku = $1 AND platform = $2`,
    [String(sku).trim(), platform],
  );
  return rowToState(res.rows[0]);
}

export async function listForSku(sku) {
  const res = await query(
    `SELECT ${COLS} FROM platform_state WHERE sku = $1`,
    [String(sku).trim()],
  );
  return res.rows.map(rowToState);
}

/** TODOS los estados (para barridos: evita el N+1 de get() por SKU/canal). */
export async function listAll() {
  const res = await query(`SELECT ${COLS} FROM platform_state`);
  return res.rows.map(rowToState);
}

/**
 * Upsert de stock + meta. No toca price.
 */
export async function setStock(sku, platform, stock, source) {
  const res = await query(
    `INSERT INTO platform_state (sku, platform, stock, last_synced_at, last_source)
     VALUES ($1, $2, $3, now(), $4)
     ON CONFLICT (sku, platform) DO UPDATE
       SET stock = EXCLUDED.stock,
           last_synced_at = EXCLUDED.last_synced_at,
           last_source = EXCLUDED.last_source
     RETURNING ${COLS}`,
    [String(sku).trim(), platform, stock, source || null],
  );
  return rowToState(res.rows[0]);
}

/**
 * Upsert de precio + meta. No toca stock.
 */
export async function setPrice(sku, platform, price, source) {
  const res = await query(
    `INSERT INTO platform_state (sku, platform, price, last_synced_at, last_source)
     VALUES ($1, $2, $3, now(), $4)
     ON CONFLICT (sku, platform) DO UPDATE
       SET price = EXCLUDED.price,
           last_synced_at = EXCLUDED.last_synced_at,
           last_source = EXCLUDED.last_source
     RETURNING ${COLS}`,
    [String(sku).trim(), platform, price, source || null],
  );
  return rowToState(res.rows[0]);
}

/**
 * Upsert combinado (cuando se sincronizan ambos a la vez).
 */
export async function setStockAndPrice(sku, platform, stock, price, source) {
  const res = await query(
    `INSERT INTO platform_state (sku, platform, stock, price, last_synced_at, last_source)
     VALUES ($1, $2, $3, $4, now(), $5)
     ON CONFLICT (sku, platform) DO UPDATE
       SET stock = EXCLUDED.stock,
           price = EXCLUDED.price,
           last_synced_at = EXCLUDED.last_synced_at,
           last_source = EXCLUDED.last_source
     RETURNING ${COLS}`,
    [String(sku).trim(), platform, stock, price, source || null],
  );
  return rowToState(res.rows[0]);
}
