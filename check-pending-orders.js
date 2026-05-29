/**
 * Catch-up de órdenes pendientes de MercadoLibre.
 *
 * Cuándo se ejecuta: en cada arranque del servidor (`webhook-server.js` lo
 * importa dinámicamente). El env var PENDING_ORDERS_LAST_HOURS controla la
 * ventana hacia atrás:
 *  - 0  → desactivado (no procesa nada).
 *  - >0 → procesa órdenes ML creadas en las últimas N horas que no estén
 *         marcadas como procesadas en marketplace_orders.
 *
 * Seguro a partir de la fase 3 etapa 3: la idempotencia vive en Neon
 * (marketplace_orders + marketplace_order_items), persistente entre redeploys.
 * Si una orden ya fue procesada antes del redeploy, NO se re-procesa.
 */

import MercadoLibreAPI from './mercadolibre-api.js';
import ShopifyAPI from './shopify-api.js';
import { config } from './src/config.js';
import { logger } from './src/logger.js';
import * as marketplaceOrders from './src/db/repositories/marketplace-orders.js';
import * as skuCache from './src/services/sku-cache.js';
import * as locks from './src/db/repositories/sku-locks.js';

const MELI_USER_ID = config.MELI_USER_ID;
const PLATFORM = 'mercadolibre';

/**
 * Procesa una orden de MercadoLibre.
 * Mismo flujo que processMercadoLibreOrder en webhook-server, pero standalone
 * para no acoplar este job al servidor HTTP.
 */
async function processOrder(orderId, shopify, meli) {
  const existing = await marketplaceOrders.findOrder(PLATFORM, orderId);
  if (existing && existing.status === 'processed') {
    return { status: 'skipped_already_processed' };
  }

  let order;
  try {
    const r = await meli.client.get(`/orders/${orderId}`);
    order = r.data;
  } catch (err) {
    logger.error({ orderId, err: err.message }, 'no se pudo obtener orden ML');
    return { status: 'fetch_failed', error: err.message };
  }

  if (!order) return { status: 'fetch_failed' };

  const validStatuses = ['confirmed', 'payment_required', 'payment_in_process', 'paid'];
  if (!validStatuses.includes(order.status)) {
    return { status: 'order_status_not_processable', orderStatus: order.status };
  }

  if (!order.order_items?.length) {
    return { status: 'no_items' };
  }

  await marketplaceOrders.ensureOrder(PLATFORM, orderId, order);
  await marketplaceOrders.setOrderStatus(PLATFORM, orderId, 'processing');

  let itemsProcessed = 0;
  let itemsFailed = 0;

  for (const oi of order.order_items) {
    const item = oi.item;
    const itemId = item?.id;
    const variationId = oi.variation_id ?? item?.variation_id ?? null;
    const sellerSku = item?.seller_sku ?? null;
    const quantity = oi.quantity || 1;
    const itemKey = `item:${itemId}:${variationId || 'NA'}`;

    if (await marketplaceOrders.hasItemProcessed(PLATFORM, orderId, itemKey)) {
      itemsProcessed++;
      continue;
    }

    try {
      const resolved = await skuCache.resolveFromMlOrderItem(itemId, variationId, sellerSku);
      if (resolved?.ambiguous) {
        itemsFailed++;
        await marketplaceOrders.recordItem({
          platform: PLATFORM, orderId, itemKey, sku: null, quantity,
          status: 'ambiguous_no_variation',
          error: `multiple SKUs: ${resolved.candidates.join(', ')}`,
        });
        continue;
      }
      const sku = resolved?.sku;
      if (!sku) {
        itemsFailed++;
        await marketplaceOrders.recordItem({
          platform: PLATFORM, orderId, itemKey, sku: null, quantity, status: 'sku_not_found',
          error: `no mapping for itemId=${itemId}, variation_id=${variationId}, seller_sku=${sellerSku}`,
        });
        continue;
      }

      const stockAfter = await locks.withLock(sku, async () => {
        const ok = await shopify.updateStockBySKU(sku, quantity);
        if (!ok) throw new Error('shopify update failed');
        return shopify.getStockBySKU(sku);
      });

      itemsProcessed++;
      logger.info({ orderId, sku, quantity, stockAfter }, 'catch-up: stock descontado');
      await marketplaceOrders.recordItem({
        platform: PLATFORM, orderId, itemKey, sku, quantity, status: 'processed', shopifyStockAfter: stockAfter,
      });
    } catch (err) {
      itemsFailed++;
      logger.error({ orderId, itemId, err: err.message }, 'catch-up: error procesando item');
      await marketplaceOrders.recordItem({
        platform: PLATFORM, orderId, itemKey, sku: null, quantity, status: 'failed', error: err.message,
      }).catch(() => {});
    }
  }

  const fully = itemsFailed === 0 && itemsProcessed === order.order_items.length;
  const finalStatus = fully ? 'processed' : (itemsProcessed > 0 ? 'partial' : 'failed');
  await marketplaceOrders.setOrderStatus(PLATFORM, orderId, finalStatus, {
    processedItems: itemsProcessed, failedItems: itemsFailed,
  });

  return { status: finalStatus, itemsProcessed, itemsFailed, total: order.order_items.length };
}

async function checkPendingOrders() {
  const lastHours = config.PENDING_ORDERS_LAST_HOURS;
  if (lastHours === 0) {
    logger.info('catch-up de órdenes pendientes desactivado (PENDING_ORDERS_LAST_HOURS=0)');
    return;
  }

  logger.info({ lastHours }, 'catch-up: buscando órdenes ML recientes');
  const meli = new MercadoLibreAPI();
  const shopify = new ShopifyAPI();

  const allOrders = [];
  let offset = 0;
  const limit = 50;

  while (true) {
    const r = await meli.client.get('/orders/search', {
      params: { seller: MELI_USER_ID, sort: 'date_desc', limit, offset },
    });
    const orders = r.data.results || [];
    allOrders.push(...orders);
    if (orders.length < limit) break;
    offset += limit;
    await new Promise((res) => setTimeout(res, 200));
  }

  const cutoffMs = Date.now() - (lastHours * 3600 * 1000);
  const recent = allOrders.filter((o) => {
    const ts = new Date(o.date_created || o.date_last_updated || o.date_closed).getTime();
    return ts > cutoffMs;
  });

  logger.info(
    { totalFound: allOrders.length, recent: recent.length, ignoredOld: allOrders.length - recent.length },
    'catch-up: órdenes a evaluar',
  );

  let processed = 0;
  let skipped = 0;
  let partial = 0;
  let failed = 0;

  for (const o of recent) {
    const orderId = String(o.id);
    const res = await processOrder(orderId, shopify, meli);
    switch (res.status) {
      case 'processed': processed++; break;
      case 'skipped_already_processed': skipped++; break;
      case 'partial': partial++; break;
      case 'order_status_not_processable':
      case 'no_items':
        skipped++; break;
      default: failed++;
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  logger.info(
    { processed, skipped, partial, failed, totalChecked: recent.length },
    'catch-up: resumen',
  );

  if (partial > 0 || failed > 0) {
    logger.warn(
      { partial, failed },
      'catch-up: algunas órdenes requieren revisión (ver marketplace_orders/items en DB)',
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  checkPendingOrders().catch((err) => {
    logger.error({ err: err.message, stack: err.stack }, 'check-pending-orders fatal');
    process.exit(1);
  });
}

export default checkPendingOrders;
