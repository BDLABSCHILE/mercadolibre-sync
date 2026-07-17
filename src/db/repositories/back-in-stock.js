import { query } from '../index.js';

function rowToEntry(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    sku: row.sku,
    email: row.email,
    phone: row.phone,
    productTitle: row.product_title,
    productUrl: row.product_url,
    source: row.source,
    createdAt: row.created_at,
    notifiedAt: row.notified_at,
    sentAt: row.sent_at,
    notifyError: row.notify_error,
  };
}

/**
 * Alta (o re-alta) en la waitlist. Si el par (sku, email) ya existía, actualiza
 * los datos y RESETEA el estado: si el producto se volvió a agotar y la persona
 * se re-suscribe, debe recibir el próximo aviso aunque ya haya recibido uno antes.
 * (El endpoint solo permite suscribirse cuando el producto está SIN stock, así que
 * el reset no es abusable para bombardear con avisos de productos disponibles.)
 */
export async function subscribe({ sku, email, phone, productTitle, productUrl, source = 'storefront' }) {
  const res = await query(
    `INSERT INTO back_in_stock_waitlist (sku, email, phone, product_title, product_url, source)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (upper(sku), lower(email)) DO UPDATE SET
       phone = COALESCE(EXCLUDED.phone, back_in_stock_waitlist.phone),
       product_title = COALESCE(EXCLUDED.product_title, back_in_stock_waitlist.product_title),
       product_url = COALESCE(EXCLUDED.product_url, back_in_stock_waitlist.product_url),
       notified_at = NULL,
       sent_at = NULL,
       notify_error = NULL
     RETURNING *, (xmax = 0) AS is_new`,
    [sku, email, phone || null, productTitle || null, productUrl || null, source],
  );
  const row = res.rows[0];
  return { entry: rowToEntry(row), isNew: row.is_new === true };
}

/** SKUs (en mayúscula) con al menos una espera pendiente de aviso. */
export async function pendingSkus() {
  const res = await query(
    `SELECT DISTINCT upper(sku) AS sku FROM back_in_stock_waitlist WHERE notified_at IS NULL`,
  );
  return res.rows.map((r) => r.sku);
}

/** Esperas pendientes de un SKU (match case-insensitive), más antiguas primero. */
export async function listPendingBySku(sku) {
  const res = await query(
    `SELECT * FROM back_in_stock_waitlist
      WHERE upper(sku) = upper($1) AND notified_at IS NULL
      ORDER BY created_at`,
    [sku],
  );
  return res.rows.map(rowToEntry);
}

/** Esperas pendientes activas de un correo (para el tope por persona). */
export async function countPendingByEmail(email) {
  const res = await query(
    `SELECT count(*) AS n FROM back_in_stock_waitlist
      WHERE lower(email) = lower($1) AND notified_at IS NULL`,
    [email],
  );
  return Number(res.rows[0].n);
}

/**
 * Reclama UNA fila de forma atómica justo antes de enviar. Devuelve null si otro
 * proceso ya la tomó (webhook y reconcile concurrentes → cero avisos duplicados).
 * Claim por fila (no por lote): si el proceso muere, a lo más UNA fila queda
 * colgada, y recoverStaleClaims la devuelve a pendiente.
 */
export async function claimEntry(id) {
  const res = await query(
    `UPDATE back_in_stock_waitlist
        SET notified_at = now()
      WHERE id = $1 AND notified_at IS NULL
      RETURNING *`,
    [id],
  );
  return rowToEntry(res.rows[0]);
}

/** Envío falló → la fila vuelve a "pendiente" con el error (se reintenta al próximo trigger). */
export async function releaseClaim(id, error) {
  await query(
    `UPDATE back_in_stock_waitlist
        SET notified_at = NULL, notify_error = $2
      WHERE id = $1`,
    [id, String(error || '').slice(0, 500)],
  );
}

/** Pulpo aceptó el evento (202) → marcar enviada. */
export async function markSent(id) {
  await query(
    `UPDATE back_in_stock_waitlist SET sent_at = now(), notify_error = NULL WHERE id = $1`,
    [id],
  );
}

/**
 * Repara claims huérfanos: filas reclamadas hace rato y nunca enviadas (proceso
 * muerto entre claim y send). Las devuelve a pendiente → at-least-once.
 */
export async function recoverStaleClaims({ olderThanMinutes = 15 } = {}) {
  const res = await query(
    `UPDATE back_in_stock_waitlist
        SET notified_at = NULL,
            notify_error = 'claim recuperado (proceso interrumpido durante el envío)'
      WHERE notified_at IS NOT NULL
        AND sent_at IS NULL
        AND notified_at < now() - make_interval(mins => $1)
      RETURNING id`,
    [olderThanMinutes],
  );
  return res.rowCount;
}

/** Vista para el admin: pendientes primero, luego el resto por fecha. */
export async function listRecent({ limit = 100 } = {}) {
  const res = await query(
    `SELECT * FROM back_in_stock_waitlist
      ORDER BY (notified_at IS NULL) DESC, created_at DESC
      LIMIT $1`,
    [Math.min(Number(limit) || 100, 500)],
  );
  return res.rows.map(rowToEntry);
}

export async function stats() {
  const res = await query(
    `SELECT
       count(*) FILTER (WHERE notified_at IS NULL) AS pending,
       count(*) FILTER (WHERE notified_at IS NOT NULL AND sent_at IS NULL) AS claimed,
       count(*) FILTER (WHERE sent_at IS NOT NULL) AS sent,
       count(DISTINCT upper(sku)) FILTER (WHERE notified_at IS NULL) AS pending_skus
     FROM back_in_stock_waitlist`,
  );
  const r = res.rows[0];
  return {
    pending: Number(r.pending),
    claimed: Number(r.claimed),
    sent: Number(r.sent),
    pendingSkus: Number(r.pending_skus),
  };
}
