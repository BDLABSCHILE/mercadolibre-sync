import { query, withTx } from '../index.js';

const ORDER_COLS = 'platform, order_id, status, raw, items, processed_items, failed_items, first_seen, processed_at';
const ITEM_COLS = 'platform, order_id, item_key, sku, quantity, status, shopify_stock_after, error, processed_at';

function orderRow(r) {
  if (!r) return null;
  return {
    platform: r.platform,
    orderId: r.order_id,
    status: r.status,
    raw: r.raw,
    items: r.items,
    processedItems: r.processed_items,
    failedItems: r.failed_items,
    firstSeen: r.first_seen,
    processedAt: r.processed_at,
  };
}

function itemRow(r) {
  if (!r) return null;
  return {
    platform: r.platform,
    orderId: r.order_id,
    itemKey: r.item_key,
    sku: r.sku,
    quantity: r.quantity,
    status: r.status,
    shopifyStockAfter: r.shopify_stock_after,
    error: r.error,
    processedAt: r.processed_at,
  };
}

/**
 * Asegura que existe una fila para (platform, orderId). Si no existe la crea
 * en estado 'new'. Si existe, retorna la actual.
 */
export async function ensureOrder(platform, orderId, raw = null) {
  const res = await query(
    `INSERT INTO marketplace_orders (platform, order_id, status, raw)
     VALUES ($1, $2, 'new', $3)
     ON CONFLICT (platform, order_id) DO UPDATE
       SET raw = COALESCE(EXCLUDED.raw, marketplace_orders.raw)
     RETURNING ${ORDER_COLS}`,
    [platform, String(orderId), raw],
  );
  return orderRow(res.rows[0]);
}

export async function findOrder(platform, orderId) {
  const res = await query(
    `SELECT ${ORDER_COLS} FROM marketplace_orders WHERE platform = $1 AND order_id = $2`,
    [platform, String(orderId)],
  );
  return orderRow(res.rows[0]);
}

export async function setOrderStatus(platform, orderId, status, { processedItems, failedItems } = {}) {
  const res = await query(
    `UPDATE marketplace_orders
       SET status = $3,
           processed_items = COALESCE($4, processed_items),
           failed_items = COALESCE($5, failed_items),
           processed_at = CASE WHEN $3 IN ('processed', 'partial', 'failed') THEN now() ELSE processed_at END
     WHERE platform = $1 AND order_id = $2
     RETURNING ${ORDER_COLS}`,
    [platform, String(orderId), status, processedItems ?? null, failedItems ?? null],
  );
  return orderRow(res.rows[0]);
}

/**
 * ¿Este item ya fue procesado exitosamente? Útil para retry seguro.
 */
export async function hasItemProcessed(platform, orderId, itemKey) {
  const res = await query(
    `SELECT 1 FROM marketplace_order_items
     WHERE platform = $1 AND order_id = $2 AND item_key = $3 AND status = 'processed'
     LIMIT 1`,
    [platform, String(orderId), itemKey],
  );
  return res.rowCount > 0;
}

export async function findItem(platform, orderId, itemKey) {
  const res = await query(
    `SELECT ${ITEM_COLS} FROM marketplace_order_items
     WHERE platform = $1 AND order_id = $2 AND item_key = $3`,
    [platform, String(orderId), itemKey],
  );
  return itemRow(res.rows[0]);
}

export async function listItems(platform, orderId) {
  const res = await query(
    `SELECT ${ITEM_COLS} FROM marketplace_order_items
     WHERE platform = $1 AND order_id = $2
     ORDER BY processed_at`,
    [platform, String(orderId)],
  );
  return res.rows.map(itemRow);
}

/**
 * Registra un item procesado (o intento). Idempotente: si ya existe la misma
 * combinación (platform, order_id, item_key), actualiza el status/error.
 * Pero si el status previo era 'processed', NO lo pisa con otro intento (proteger).
 */
export async function recordItem({
  platform,
  orderId,
  itemKey,
  sku,
  quantity,
  status,
  shopifyStockAfter,
  error,
}) {
  const res = await query(
    `INSERT INTO marketplace_order_items
       (platform, order_id, item_key, sku, quantity, status, shopify_stock_after, error)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (platform, order_id, item_key) DO UPDATE
       SET sku = EXCLUDED.sku,
           quantity = EXCLUDED.quantity,
           status = CASE
             WHEN marketplace_order_items.status = 'processed' THEN marketplace_order_items.status
             ELSE EXCLUDED.status
           END,
           shopify_stock_after = COALESCE(EXCLUDED.shopify_stock_after, marketplace_order_items.shopify_stock_after),
           error = EXCLUDED.error,
           processed_at = now()
     RETURNING ${ITEM_COLS}`,
    [
      platform,
      String(orderId),
      itemKey,
      sku || null,
      quantity ?? null,
      status,
      shopifyStockAfter ?? null,
      error || null,
    ],
  );
  return itemRow(res.rows[0]);
}

/**
 * Aplica una operación dentro de una transacción que abarca:
 *  - ensure de la orden
 *  - registro de cada item
 *  - update del status final de la orden
 *
 * El callback recibe un objeto con helpers que escriben en la misma transacción.
 */
export async function processOrderTx(platform, orderId, fn) {
  return withTx(async (client) => {
    const helpers = {
      async ensureOrder(raw) {
        const r = await client.query(
          `INSERT INTO marketplace_orders (platform, order_id, status, raw)
           VALUES ($1, $2, 'new', $3)
           ON CONFLICT (platform, order_id) DO UPDATE
             SET raw = COALESCE(EXCLUDED.raw, marketplace_orders.raw)
           RETURNING ${ORDER_COLS}`,
          [platform, String(orderId), raw],
        );
        return orderRow(r.rows[0]);
      },
      async hasItemProcessed(itemKey) {
        const r = await client.query(
          `SELECT 1 FROM marketplace_order_items
           WHERE platform = $1 AND order_id = $2 AND item_key = $3 AND status = 'processed'
           LIMIT 1`,
          [platform, String(orderId), itemKey],
        );
        return r.rowCount > 0;
      },
      async recordItem(args) {
        const r = await client.query(
          `INSERT INTO marketplace_order_items
             (platform, order_id, item_key, sku, quantity, status, shopify_stock_after, error)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (platform, order_id, item_key) DO UPDATE
             SET sku = EXCLUDED.sku,
                 quantity = EXCLUDED.quantity,
                 status = CASE
                   WHEN marketplace_order_items.status = 'processed' THEN marketplace_order_items.status
                   ELSE EXCLUDED.status
                 END,
                 shopify_stock_after = COALESCE(EXCLUDED.shopify_stock_after, marketplace_order_items.shopify_stock_after),
                 error = EXCLUDED.error,
                 processed_at = now()
           RETURNING ${ITEM_COLS}`,
          [
            platform,
            String(orderId),
            args.itemKey,
            args.sku || null,
            args.quantity ?? null,
            args.status,
            args.shopifyStockAfter ?? null,
            args.error || null,
          ],
        );
        return itemRow(r.rows[0]);
      },
      async setStatus(status, { processedItems, failedItems } = {}) {
        const r = await client.query(
          `UPDATE marketplace_orders
             SET status = $3,
                 processed_items = COALESCE($4, processed_items),
                 failed_items = COALESCE($5, failed_items),
                 processed_at = CASE WHEN $3 IN ('processed', 'partial', 'failed') THEN now() ELSE processed_at END
           WHERE platform = $1 AND order_id = $2
           RETURNING ${ORDER_COLS}`,
          [platform, String(orderId), status, processedItems ?? null, failedItems ?? null],
        );
        return orderRow(r.rows[0]);
      },
    };
    return fn(helpers);
  });
}
