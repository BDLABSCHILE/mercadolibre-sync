import { query } from '../index.js';

/**
 * Registra un webhook entrante. Idempotente: si ya existe el delivery_id,
 * retorna { isNew: false, status }. Si es nuevo, retorna { isNew: true }.
 *
 * delivery_id sugerido por source:
 *  - shopify:      header X-Shopify-Webhook-Id
 *  - mercadolibre: `${topic}:${resource}:${received_at_ts}` (ML no manda id)
 *  - falabella:    `${event}:${orderId}:${received_at_ts}` o similar
 */
export async function record({ deliveryId, source, topic, payload }) {
  if (!deliveryId) throw new Error('record: deliveryId requerido');
  const res = await query(
    `INSERT INTO webhook_events (delivery_id, source, topic, payload, status)
     VALUES ($1, $2, $3, $4, 'received')
     ON CONFLICT (delivery_id) DO NOTHING
     RETURNING delivery_id`,
    [String(deliveryId), source, topic || null, payload || {}],
  );
  if (res.rowCount > 0) return { isNew: true };
  // ya existía: leemos su status actual.
  const existing = await query(
    `SELECT status, processed_at, error FROM webhook_events WHERE delivery_id = $1`,
    [String(deliveryId)],
  );
  return {
    isNew: false,
    status: existing.rows[0]?.status,
    processedAt: existing.rows[0]?.processed_at,
    error: existing.rows[0]?.error,
  };
}

export async function markProcessed(deliveryId) {
  await query(
    `UPDATE webhook_events
       SET status = 'processed', processed_at = now(), error = NULL
     WHERE delivery_id = $1`,
    [String(deliveryId)],
  );
}

export async function markFailed(deliveryId, error) {
  await query(
    `UPDATE webhook_events
       SET status = 'failed', processed_at = now(), error = $2
     WHERE delivery_id = $1`,
    [String(deliveryId), String(error || 'unknown').slice(0, 2000)],
  );
}

export async function markIgnored(deliveryId, reason) {
  await query(
    `UPDATE webhook_events
       SET status = 'ignored', processed_at = now(), error = $2
     WHERE delivery_id = $1`,
    [String(deliveryId), String(reason || '').slice(0, 2000)],
  );
}
