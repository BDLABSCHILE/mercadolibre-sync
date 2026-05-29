import express from 'express';
import ShopifyAPI from './shopify-api.js';
import MercadoLibreAPI from './mercadolibre-api.js';
import FalabellaAPI from './falabella-api.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './src/config.js';
import { logger } from './src/logger.js';
import { requestId } from './src/middleware/request-id.js';
import { verifyShopifyHmac } from './src/middleware/verify-shopify-hmac.js';
import adminSkusRouter from './src/routes/admin-skus.js';
import adminPriceOverridesRouter from './src/routes/admin-price-overrides.js';
import adminUiRouter from './src/routes/admin-ui.js';
import * as skuCache from './src/services/sku-cache.js';
import * as marketplaceOrdersRepo from './src/db/repositories/marketplace-orders.js';
import * as locks from './src/db/repositories/sku-locks.js';
import * as webhookEvents from './src/db/repositories/webhook-events.js';
import { syncPriceForShopifyProduct, syncPriceForSku, syncAllPricesFromShopify } from './src/services/price-sync.js';
import { reconcileStock } from './src/services/reconciler.js';
import { adminAuth } from './src/middleware/admin-auth.js';
import crypto from 'crypto';

// Obtener el directorio actual para ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(requestId);

// IMPORTANTE: NO usar express.json() aquí. Los webhooks de Shopify requieren body RAW
// para HMAC y para evitar "Unexpected token 'n', 'null' is not valid JSON".
// express.json() se aplica DESPUÉS de las rutas de Shopify (ver más abajo).

const shopify = new ShopifyAPI();
const meli = new MercadoLibreAPI();
let falabella = null;

// Falabella: solo inicializar si ENABLE_FALABELLA=true Y hay credenciales
const enableFalabella = String(process.env.ENABLE_FALABELLA || 'false').toLowerCase() === 'true';
if (enableFalabella) {
  try {
    if (process.env.FALABELLA_USER_ID && process.env.FALABELLA_API_KEY) {
      falabella = new FalabellaAPI();
      console.log('✅ FalabellaAPI inicializada (ENABLE_FALABELLA=true)');
    } else {
      console.warn('⚠️  ENABLE_FALABELLA=true pero faltan credenciales (FALABELLA_USER_ID / FALABELLA_API_KEY)');
    }
  } catch (e) {
    console.warn('⚠️  No se pudo inicializar FalabellaAPI:', e.message);
    falabella = null;
  }
} else {
  console.log('ℹ️  FalabellaAPI no inicializada (ENABLE_FALABELLA=false)');
}

const stockOffset = parseInt(process.env.STOCK_OFFSET || '1', 10);
const stockOffsetFalabella = parseInt(process.env.STOCK_OFFSET_FALABELLA || String(stockOffset), 10);

/** SKUs para los que Falabella devolvió E009 Access Denied; no volvemos a llamar a Falabella hasta reinicio. */
const falabellaAccessDeniedSkus = new Set();

// ========== PROTECCIÓN CONTRA LOOPS (GENÉRICA) ==========
// Flags para evitar loops y para evitar que Shopify dispare sync duplicado mientras procesamos una orden externa.
const isSyncingFromMarketplace = {
  mercadolibre: false,
  falabella: false,
};

function isAnyMarketplaceSyncActive() {
  return Object.values(isSyncingFromMarketplace).some(Boolean);
}

// ========== IDEMPOTENCIA ==========
// Migrada a DB en fase 3 etapa 3 (tablas webhook_events, marketplace_orders,
// marketplace_order_items). El antiguo idempotency-store.js (file/memory) ya
// NO se usa en runtime — vive en el repo solo como referencia histórica.

/**
 * Calcula el stock para MercadoLibre
 */
function calculateMeliStock(shopifyStock) {
  if (shopifyStock === null || shopifyStock === undefined) {
    return 0;
  }
  return Math.max(0, shopifyStock - stockOffset);
}

/**
 * Calcula el stock para Falabella
 */
function calculateFalabellaStock(shopifyStock) {
  if (shopifyStock === null || shopifyStock === undefined) {
    return 0;
  }
  return Math.max(0, shopifyStock - stockOffsetFalabella);
}

/**
 * Sincroniza un SKU desde Shopify hacia TODOS los marketplaces habilitados.
 * - Shopify es fuente de verdad.
 * - Cada marketplace aplica su offset independiente.
 */
async function syncSkuToMarketplacesFromShopify(sku, shopifyStock, { reason, skipFalabella } = {}) {
  const safeSku = sku ? String(sku).trim() : '';
  if (!safeSku) return { sku: safeSku, results: [] };

  const results = [];

  // MercadoLibre
  try {
    const meliStock = calculateMeliStock(shopifyStock);
    const result = await meli.findItemBySKU(safeSku);
    if (!result) {
      console.log(`   ⚠️  [sync:${reason || 'shopify'}] SKU ${safeSku}: no encontrado en MercadoLibre`);
      results.push({ marketplace: 'mercadolibre', ok: false, reason: 'not_found' });
    } else {
      const ok = await meli.updateStock(result.itemId, meliStock, result.variationId);
      if (ok) {
        console.log(`   ✅ [sync:${reason || 'shopify'}] ${safeSku} → MercadoLibre(${meliStock})`);
        results.push({ marketplace: 'mercadolibre', ok: true, stock: meliStock });
      } else {
        console.log(`   ❌ [sync:${reason || 'shopify'}] ${safeSku}: error actualizando MercadoLibre`);
        results.push({ marketplace: 'mercadolibre', ok: false, reason: 'update_failed' });
      }
    }
  } catch (e) {
    console.log(`   ❌ [sync:${reason || 'shopify'}] ${safeSku}: error MercadoLibre: ${e.message}`);
    results.push({ marketplace: 'mercadolibre', ok: false, reason: 'error', error: e.message });
  }

  // Falabella (solo si está inicializado y no skipFalabella; skip cuando el origen fue venta Falabella para evitar loop)
  if (falabella && !skipFalabella) {
    if (falabellaAccessDeniedSkus.has(safeSku)) {
      console.log(`   ⏭️  [sync:${reason || 'shopify'}] ${safeSku}: Falabella omitido (E009 anterior para este SKU)`);
      results.push({ marketplace: 'falabella', ok: false, reason: 'access_denied_skipped', skipped: true });
    } else {
      try {
        const fStock = calculateFalabellaStock(shopifyStock);
        console.log(`   🧮 [sync:${reason || 'shopify'}] ${safeSku}: Shopify(${shopifyStock}) → Falabella(${fStock}, offset ${stockOffsetFalabella})`);

        await falabella.updateStockBySKU(safeSku, fStock);

        console.log(`   ✅ [sync:${reason || 'shopify'}] ${safeSku} → Falabella(${fStock})`);
        results.push({ marketplace: 'falabella', ok: true, stock: fStock, shopifyStock, offset: stockOffsetFalabella });
      } catch (e) {
        const isE009 = /E009|Access Denied/i.test(e.message);
        if (isE009) {
          falabellaAccessDeniedSkus.add(safeSku);
          console.warn(`   ⚠️  [sync:${reason || 'shopify'}] ${safeSku}: Falabella E009 (SKU no en catálogo o sin permiso). No se reintentará hasta reinicio.`);
        } else {
          console.log(`   ❌ [sync:${reason || 'shopify'}] ${safeSku}: error actualizando Falabella: ${e.message}`);
        }
        results.push({ marketplace: 'falabella', ok: false, reason: isE009 ? 'access_denied' : 'error', error: e.message });
      }
    }
  }

  return { sku: safeSku, results };
}

/**
 * Calcula un delivery_id estable por webhook entrante (clave de idempotencia).
 * Si el mismo webhook llega 2 veces (retry del proveedor), el id es idéntico.
 */
function deliveryIdShopify(req) {
  const id = req.header('x-shopify-webhook-id');
  if (id) return `shopify:${id}`;
  const topic = req.header('x-shopify-topic') || 'unknown';
  const hash = crypto.createHash('sha256').update(req.body || '').digest('hex').slice(0, 16);
  return `shopify:${topic}:${hash}`;
}

function deliveryIdMeli(body) {
  if (body?._id) return `ml:${body._id}`;
  return `ml:${body?.topic || 'unknown'}:${body?.resource || ''}`;
}

function deliveryIdFalabella(body) {
  const event = body?.event || 'unknown';
  const orderId = body?.payload?.OrderId ?? body?.OrderId ?? body?.orderId ?? '';
  if (orderId) return `fb:${event}:${orderId}`;
  const hash = crypto.createHash('sha256').update(JSON.stringify(body || {})).digest('hex').slice(0, 16);
  return `fb:${event}:${hash}`;
}

/**
 * Parsea body RAW (Buffer) a JSON de forma segura.
 * Evita "Unexpected token 'n', 'null' is not valid JSON" cuando body vacío o inválido.
 */
function parseRawBodySafe(rawBody) {
  if (!rawBody || !Buffer.isBuffer(rawBody)) {
    return null;
  }
  const str = rawBody.toString('utf8').trim();
  if (!str || str === 'null') {
    return null;
  }
  try {
    return JSON.parse(str);
  } catch (e) {
    return null;
  }
}

// ========== WEBHOOKS SHOPIFY (body RAW) ==========
// Shopify requiere body RAW. Usar express.raw() SOLO para estas rutas.
// express.json() se aplica DESPUÉS (para MercadoLibre y demás).

const shopifyRawParser = express.raw({ type: 'application/json', limit: '1mb' });

/**
 * POST /webhooks/shopify/orders/create
 * Webhook orders/create de Shopify. URL exacta usada en producción (Render).
 * Body RAW: NO express.json (rompe HMAC y genera "null is not valid JSON").
 */
app.post('/webhooks/shopify/orders/create', shopifyRawParser, verifyShopifyHmac, async (req, res) => {
  const deliveryId = deliveryIdShopify(req);
  try {
    const body = parseRawBodySafe(req.body);
    if (!body) {
      logger.warn({ deliveryId }, 'webhook Shopify orders/create body vacío/inválido');
      return res.status(400).json({ error: 'Body vacío o JSON inválido' });
    }
    const rec = await webhookEvents.record({
      deliveryId, source: 'shopify', topic: 'orders/create', payload: body,
    });
    if (!rec.isNew) {
      logger.info({ deliveryId, status: rec.status }, 'webhook Shopify orders/create duplicado, ignorando');
      return res.status(200).json({ message: 'duplicado', delivery_id: deliveryId, prev_status: rec.status });
    }
    logger.info({ deliveryId, orderId: body.id, lineItems: body.line_items?.length }, 'webhook Shopify orders/create');
    console.log('📥 Order ID:', body.id || body.order_number || 'N/A');
    if (body.line_items && body.line_items.length) {
      console.log(`📦 Line items: ${body.line_items.length}`);
    }

    if (isAnyMarketplaceSyncActive()) {
      console.log('🛡️  Ignorado (sincronización activa desde un marketplace)');
      return res.status(200).json({ message: 'Ignorado: sincronización desde marketplace en curso' });
    }

    const lineItems = body.line_items || [];
    if (lineItems.length === 0) {
      console.log('⚠️  Orden sin line_items');
      return res.status(200).json({ message: 'Orden sin items', order_id: body.id });
    }

    const skusToSync = new Set();
    for (const item of lineItems) {
      const sku = item.sku ? String(item.sku).trim() : null;
      if (sku) skusToSync.add(sku);
      else if (item.variant_id) console.log(`   ⚠️  Line item sin SKU (variant_id: ${item.variant_id})`);
    }

    let synced = 0;
    let failed = 0;
    for (const sku of skusToSync) {
      const shopifyStock = await shopify.getStockBySKU(sku);
      if (shopifyStock === null) {
        console.log(`   ⚠️  SKU ${sku}: no encontrado en Shopify`);
        failed++;
        continue;
      }

      const out = await syncSkuToMarketplacesFromShopify(sku, shopifyStock, { reason: 'shopify_orders_create' });
      const okAll = out.results.every(r => r.ok);
      if (okAll) synced++;
      else failed++;
    }

    logger.info({ deliveryId, synced, failed, total: lineItems.length }, 'webhook Shopify orders/create procesado');
    await webhookEvents.markProcessed(deliveryId);
    return res.status(200).json({
      success: failed === 0,
      order_id: body.id,
      skus_synced: synced,
      skus_failed: failed,
      total_line_items: lineItems.length,
    });
  } catch (error) {
    logger.error({ deliveryId, err: error.message, stack: error.stack }, 'error webhook Shopify orders/create');
    await webhookEvents.markFailed(deliveryId, error.message).catch(() => {});
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /webhook/inventory
 * Evento: Inventory levels update. También usa body RAW.
 */
app.post('/webhook/inventory', shopifyRawParser, verifyShopifyHmac, async (req, res) => {
  const deliveryId = deliveryIdShopify(req);
  try {
    const body = parseRawBodySafe(req.body);
    if (!body) {
      logger.warn({ deliveryId }, 'webhook Shopify inventory body vacío/inválido');
      return res.status(400).json({ error: 'Body vacío o JSON inválido' });
    }
    const rec = await webhookEvents.record({
      deliveryId, source: 'shopify', topic: body.topic || 'inventory_levels/update', payload: body,
    });
    if (!rec.isNew) {
      logger.info({ deliveryId, status: rec.status }, 'webhook Shopify inventory duplicado, ignorando');
      return res.status(200).json({ message: 'duplicado', delivery_id: deliveryId, prev_status: rec.status });
    }
    logger.info({ deliveryId, inventory_item_id: body.inventory_item_id, available: body.available }, 'webhook Shopify inventory');

    if (body.topic && body.topic !== 'inventory_levels/update' && body.topic !== 'inventory_levels/connect' && body.topic !== 'inventory_levels/disconnect') {
      console.log(`⚠️  Topic "${body.topic}" no es inventory, ignorando`);
      return res.status(200).json({ message: `Topic ${body.topic} no procesado` });
    }

    if (isAnyMarketplaceSyncActive()) {
      console.log('🛡️  Ignorado (sincronización activa desde un marketplace)');
      return res.status(200).json({ message: 'Ignorado: sincronización desde marketplace en curso' });
    }

    const { inventory_item_id, location_id, available } = body;
    if (!inventory_item_id) {
      console.log('❌ inventory_item_id es requerido');
      return res.status(400).json({ error: 'inventory_item_id es requerido' });
    }
    console.log(`📦 inventory_item_id=${inventory_item_id}, available=${available}, location_id=${location_id}`);

    console.log('🔍 Buscando SKU desde inventory_item_id...');
    const products = await shopify.getAllProducts();
    let sku = null;
    for (const product of products) {
      for (const variant of product.variants || []) {
        if (variant.inventory_item_id === inventory_item_id && variant.sku) {
          sku = variant.sku;
          console.log(`   ✅ SKU: ${sku} (${product.title}, ${variant.title})`);
          break;
        }
      }
      if (sku) break;
    }

    if (!sku) {
      console.log(`⚠️  No SKU para inventory_item_id ${inventory_item_id}`);
      return res.status(200).json({ message: 'SKU no encontrado' });
    }

    const shopifyStock = await shopify.getStockBySKU(sku);
    if (shopifyStock === null) {
      console.log(`❌ Stock no encontrado en Shopify para SKU: ${sku}`);
      return res.status(200).json({ message: 'Stock no encontrado en Shopify' });
    }
    console.log(`   ✅ Stock Shopify: ${shopifyStock}`);

    console.log(`   🧮 MercadoLibre: ${calculateMeliStock(shopifyStock)} (offset ${stockOffset})`);
    if (falabella) {
      console.log(`   🧮 Falabella:    ${calculateFalabellaStock(shopifyStock)} (offset ${stockOffsetFalabella})`);
    }

    const out = await syncSkuToMarketplacesFromShopify(sku, shopifyStock, { reason: 'shopify_inventory' });
    const okAll = out.results.every((r) => r.ok);
    await webhookEvents.markProcessed(deliveryId);
    if (okAll) {
      return res.status(200).json({ success: true, sku, shopifyStock, marketplaces: out.results });
    }
    // Siempre 200: SKU no en algún marketplace es esperado (no todo está publicado).
    return res.status(200).json({
      success: false,
      sku,
      shopifyStock,
      marketplaces: out.results,
      message: 'Uno o más marketplaces no actualizados (ej. SKU no vendido ahí). No se reintenta.',
    });
  } catch (error) {
    logger.error({ deliveryId, err: error.message, stack: error.stack }, 'error webhook Shopify inventory');
    await webhookEvents.markFailed(deliveryId, error.message).catch(() => {});
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /webhooks/shopify/products/update
 * Webhook products/update de Shopify. Sincroniza precios de cada variant del
 * producto a ML y Falabella aplicando markup * 1.3 redondeado a 990.
 */
app.post('/webhooks/shopify/products/update', shopifyRawParser, verifyShopifyHmac, async (req, res) => {
  const deliveryId = deliveryIdShopify(req);
  try {
    const body = parseRawBodySafe(req.body);
    if (!body) {
      logger.warn({ deliveryId }, 'webhook products/update body vacío/inválido');
      return res.status(400).json({ error: 'Body vacío o JSON inválido' });
    }
    const rec = await webhookEvents.record({
      deliveryId, source: 'shopify', topic: 'products/update', payload: body,
    });
    if (!rec.isNew) {
      logger.info({ deliveryId, status: rec.status }, 'webhook products/update duplicado, ignorando');
      return res.status(200).json({ message: 'duplicado', delivery_id: deliveryId, prev_status: rec.status });
    }
    logger.info({ deliveryId, productId: body.id, variants: body.variants?.length }, 'webhook products/update');

    const out = await syncPriceForShopifyProduct(body, { meli, falabella }, { reason: 'shopify_products_update' });
    await webhookEvents.markProcessed(deliveryId);

    const summary = {
      product_id: out.product_id,
      product_title: out.product_title,
      variants_processed: out.results.length,
      variants_changed: out.results.filter((r) =>
        r.results.some((m) => m.ok && m.reason !== 'unchanged'),
      ).length,
      variants_unchanged: out.results.filter((r) =>
        r.results.every((m) => !m.ok || m.reason === 'unchanged'),
      ).length,
    };
    logger.info(summary, 'products/update procesado');
    return res.status(200).json({ ok: true, ...summary });
  } catch (error) {
    logger.error({ deliveryId, err: error.message, stack: error.stack }, 'error webhook products/update');
    await webhookEvents.markFailed(deliveryId, error.message).catch(() => {});
    return res.status(500).json({ error: error.message });
  }
});

// ========== JSON para el resto de rutas (MercadoLibre, etc.) ==========
app.use(express.json());

// Endpoints administrativos (mapping SKU, etc.). Auth con SYNC_ALL_SECRET.
app.use('/admin/skus', adminSkusRouter);
app.use('/admin/price-overrides', adminPriceOverridesRouter);

// Assets estáticos del dashboard (logos, etc.). Sin auth porque son imágenes.
app.use('/assets', express.static(path.join(__dirname, 'public'), { maxAge: '7d' }));

// Dashboard UI HTML (basic auth con SYNC_ALL_SECRET). Clients en app.locals.
app.locals.clients = { shopify, meli, falabella };
app.use('/admin/ui', adminUiRouter);

/**
 * POST /admin/sync-price
 *   Body: { sku, shopifyPrice, force? }
 * Forzar sync de precio para un SKU sin esperar webhook.
 */
app.post('/admin/sync-price', adminAuth, async (req, res) => {
  try {
    const { sku, shopifyPrice, force } = req.body || {};
    if (!sku) return res.status(400).json({ error: 'sku requerido' });
    const price = Number(shopifyPrice);
    if (!Number.isFinite(price) || price <= 0) {
      return res.status(400).json({ error: 'shopifyPrice debe ser un número positivo' });
    }
    const out = await syncPriceForSku(String(sku).trim(), price, { meli, falabella }, {
      reason: 'admin_manual',
      force: Boolean(force),
    });
    return res.json(out);
  } catch (err) {
    logger.error({ err: err.message }, 'POST /admin/sync-price failed');
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /admin/sync-all-prices
 *   Body opcional: {
 *     dry_run?: boolean,    // true = NO escribe en marketplaces, solo simula
 *     skus?: string[],      // limitar a estos SKUs (ej. ["B-M-NE","B-M-CRU"])
 *     prefixes?: string[],  // limitar por prefijos (ej. ["B-M-","T-M-"])
 *     delay_ms?: number,    // pausa entre SKUs (default 500)
 *   }
 * Si dry_run=true responde 200 con el resumen (sincrónico, espera).
 * Si dry_run=false responde 202 y corre en background (los logs son la fuente
 * de verdad del progreso).
 */
app.post('/admin/sync-all-prices', adminAuth, async (req, res) => {
  const body = req.body || {};
  const dryRun = Boolean(body.dry_run);
  const skus = Array.isArray(body.skus) ? body.skus : undefined;
  const prefixes = Array.isArray(body.prefixes) ? body.prefixes : undefined;
  const delayMs = Number.isFinite(body.delay_ms) ? body.delay_ms : 500;

  if (dryRun) {
    try {
      const summary = await syncAllPricesFromShopify(shopify, { meli, falabella }, {
        dryRun: true, skus, skuPrefixes: prefixes, delayMs: 0, reason: 'admin_dry_run',
      });
      return res.json(summary);
    } catch (err) {
      logger.error({ err: err.message }, 'sync-all-prices dry-run failed');
      return res.status(500).json({ error: err.message });
    }
  }

  // No dry-run: background.
  res.status(202).json({
    message: 'Sync de precios iniciado en background. Revisa los logs.',
    filter: { skus, prefixes, delayMs },
  });

  (async () => {
    try {
      const summary = await syncAllPricesFromShopify(shopify, { meli, falabella }, {
        dryRun: false, skus, skuPrefixes: prefixes, delayMs, reason: 'admin_bulk_sync',
      });
      logger.info(summary, 'sync-all-prices completado');
    } catch (err) {
      logger.error({ err: err.message, stack: err.stack }, 'sync-all-prices background error');
    }
  })();
});

/**
 * POST /admin/reconcile-stock
 *   Body opcional: {
 *     dry_run?: boolean,    // true = NO escribe en marketplaces, solo reporta drift
 *     skus?: string[],      // limitar a estos SKUs (opcional)
 *     delay_ms?: number,    // pausa entre SKUs (default 0, ya es eficiente al leer en batch)
 *     skip_ml?: boolean,
 *     skip_falabella?: boolean,
 *   }
 * Si dry_run=true responde 200 con resumen sincrónico (incluye samples del drift).
 * Si dry_run=false responde 202 y corre en background.
 */
app.post('/admin/reconcile-stock', adminAuth, async (req, res) => {
  const body = req.body || {};
  const dryRun = Boolean(body.dry_run);
  const skus = Array.isArray(body.skus) ? body.skus : undefined;
  const delayMs = Number.isFinite(body.delay_ms) ? body.delay_ms : 0;
  const skipMl = Boolean(body.skip_ml);
  const skipFalabella = Boolean(body.skip_falabella);

  if (dryRun) {
    try {
      const summary = await reconcileStock({ shopify, meli, falabella }, {
        dryRun: true, skus, delayMs, skipMl, skipFalabella,
      });
      return res.json(summary);
    } catch (err) {
      logger.error({ err: err.message }, 'reconcile-stock dry-run failed');
      return res.status(500).json({ error: err.message });
    }
  }

  res.status(202).json({
    message: 'Reconciliación iniciada en background. Revisa los logs.',
    filter: { skus, delayMs, skipMl, skipFalabella },
  });
  (async () => {
    try {
      const summary = await reconcileStock({ shopify, meli, falabella }, {
        dryRun: false, skus, delayMs, skipMl, skipFalabella,
      });
      logger.info(summary, 'reconcile-stock completado');
    } catch (err) {
      logger.error({ err: err.message, stack: err.stack }, 'reconcile-stock background error');
    }
  })();
});

/**
 * Procesa una orden de MercadoLibre: resolver SKU desde DB cache, descuento en
 * Shopify con lock por SKU, idempotencia persistente en marketplace_orders +
 * marketplace_order_items.
 *
 * @param {object} order - Objeto orden (order_items, status, etc.)
 * @param {string} orderId - ID de la orden (para idempotencia)
 * @param {{ dryRun?: boolean }} options - dryRun: solo valida resolver, no persiste ni toca Shopify
 */
async function processMercadoLibreOrder(order, orderId, options = {}) {
  const dryRun = Boolean(options.dryRun);
  const platform = 'mercadolibre';
  let itemsProcessed = 0;
  let itemsFailed = 0;
  const results = [];

  if (!order.order_items || order.order_items.length === 0) {
    logger.warn({ orderId }, 'orden ML sin items');
    return {
      success: false,
      order_id: orderId,
      status: order.status || null,
      items_processed: 0,
      items_failed: 0,
      total_items: 0,
      fully_processed: false,
      results: [],
    };
  }

  if (!dryRun) {
    await marketplaceOrdersRepo.ensureOrder(platform, orderId, order);
    await marketplaceOrdersRepo.setOrderStatus(platform, orderId, 'processing');
  }

  logger.info({ orderId, items: order.order_items.length }, 'procesando orden ML');

  for (const orderItem of order.order_items) {
    const { item, quantity } = orderItem;
    const variation_id = orderItem.variation_id ?? item?.variation_id ?? null;
    const itemId = item?.id;
    const sellerSku = item?.seller_sku ?? null;
    const itemKey = `item:${itemId}:${variation_id || 'NA'}`;
    const baseRes = { itemId, variationId: variation_id };

    try {
      if (!dryRun && await marketplaceOrdersRepo.hasItemProcessed(platform, orderId, itemKey)) {
        logger.info({ orderId, itemKey }, 'item ya procesado, skip');
        itemsProcessed++;
        results.push({ ...baseRes, status: 'skipped_already_processed' });
        continue;
      }

      const resolved = await skuCache.resolveFromMlOrderItem(itemId, variation_id, sellerSku);
      if (resolved?.ambiguous) {
        logger.warn(
          { orderId, itemId, candidates: resolved.candidates },
          'item_id sin variation tiene múltiples SKUs; ambiguous, NO descontar',
        );
        itemsFailed++;
        results.push({ ...baseRes, sku: null, status: 'ambiguous_item_no_variation' });
        if (!dryRun) {
          await marketplaceOrdersRepo.recordItem({
            platform, orderId, itemKey, sku: null, quantity,
            status: 'ambiguous_no_variation',
            error: `multiple SKUs: ${resolved.candidates.join(', ')}`,
          });
        }
        continue;
      }

      const sku = resolved?.sku;
      if (!sku) {
        logger.warn({ orderId, itemId, variation_id, sellerSku }, 'SKU no encontrado en mapping');
        itemsFailed++;
        results.push({ ...baseRes, sku: null, status: 'sku_not_found' });
        if (!dryRun) {
          await marketplaceOrdersRepo.recordItem({
            platform, orderId, itemKey, sku: null, quantity,
            status: 'sku_not_found',
            error: `no mapping for itemId=${itemId}, variation_id=${variation_id}, seller_sku=${sellerSku}`,
          });
        }
        continue;
      }

      logger.info({ orderId, itemId, sku, quantity }, 'SKU resuelto');

      if (dryRun) {
        itemsProcessed++;
        results.push({ ...baseRes, sku, quantity, status: 'success_dry_run' });
        continue;
      }

      // Lock por SKU + descuento en Shopify. Serializa órdenes concurrentes del mismo SKU.
      const stockAfter = await locks.withLock(sku, async () => {
        const ok = await shopify.updateStockBySKU(sku, quantity);
        if (!ok) throw new Error('shopify update failed');
        return shopify.getStockBySKU(sku);
      });

      logger.info({ orderId, sku, quantity, stockAfter }, 'stock descontado en Shopify');
      itemsProcessed++;
      results.push({ ...baseRes, sku, quantity, status: 'success', stockAfter });

      await marketplaceOrdersRepo.recordItem({
        platform, orderId, itemKey, sku, quantity,
        status: 'processed',
        shopifyStockAfter: stockAfter,
      });
    } catch (err) {
      logger.error({ orderId, itemId, err: err.message }, 'error procesando item ML');
      itemsFailed++;
      results.push({ ...baseRes, status: 'error', error: err.message });
      if (!dryRun) {
        await marketplaceOrdersRepo.recordItem({
          platform, orderId, itemKey, sku: results[results.length - 1]?.sku, quantity,
          status: 'failed',
          error: err.message,
        }).catch(() => {});
      }
    }
  }

  const fullyProcessed = itemsFailed === 0 && itemsProcessed === order.order_items.length;
  if (!dryRun) {
    const finalStatus = fullyProcessed ? 'processed' : (itemsProcessed > 0 ? 'partial' : 'failed');
    await marketplaceOrdersRepo.setOrderStatus(platform, orderId, finalStatus, {
      processedItems: itemsProcessed,
      failedItems: itemsFailed,
    });
    logger.info(
      { orderId, processed: itemsProcessed, failed: itemsFailed, total: order.order_items.length, status: finalStatus },
      'orden ML finalizada',
    );
  }

  if (!dryRun) {
    const uniqueSkus = [...new Set(results.map((r) => r.sku).filter(Boolean))];
    if (uniqueSkus.length > 0) {
      logger.info({ count: uniqueSkus.length }, 'redistribuyendo stock a marketplaces');
      for (const sku of uniqueSkus) {
        const s = await shopify.getStockBySKU(sku);
        if (s === null) continue;
        await syncSkuToMarketplacesFromShopify(sku, s, { reason: 'redistribute_after_mercadolibre_sale' });
      }
    }
  }

  return {
    success: itemsFailed === 0,
    order_id: orderId,
    status: order.status || null,
    items_processed: itemsProcessed,
    items_failed: itemsFailed,
    total_items: order.order_items.length,
    fully_processed: fullyProcessed,
    results,
  };
}

/**
 * Procesa una orden de Falabella: descuento en Shopify con lock por SKU,
 * idempotencia persistente en DB, redistribución solo a ML (no a Falabella para
 * evitar loop con la plataforma de origen).
 */
async function processFalabellaOrder(orderId, options = {}) {
  const dryRun = Boolean(options.dryRun);
  const platform = 'falabella';

  if (!falabella) {
    logger.warn('Falabella no inicializado, no se puede procesar orden');
    return { success: false, order_id: orderId, items_processed: 0, items_failed: 0 };
  }

  let items;
  try {
    items = await falabella.getOrderItems(orderId);
  } catch (err) {
    logger.error({ orderId, err: err.message }, 'error obteniendo items de orden Falabella');
    return { success: false, order_id: orderId, items_processed: 0, items_failed: 0, error: err.message };
  }

  if (!items || items.length === 0) {
    logger.warn({ orderId }, 'orden Falabella sin items');
    return { success: false, order_id: orderId, items_processed: 0, items_failed: 0 };
  }

  if (!dryRun) {
    await marketplaceOrdersRepo.ensureOrder(platform, orderId, { items });
    await marketplaceOrdersRepo.setOrderStatus(platform, orderId, 'processing');
  }

  logger.info({ orderId, items: items.length }, 'procesando orden Falabella');
  let itemsProcessed = 0;
  let itemsFailed = 0;
  const results = [];

  for (const it of items) {
    const { sku, quantity, orderItemId } = it;
    const itemKey = `item:${orderItemId || sku}:${quantity}`;
    const baseRes = { sku, quantity };

    try {
      if (!dryRun && await marketplaceOrdersRepo.hasItemProcessed(platform, orderId, itemKey)) {
        logger.info({ orderId, sku, itemKey }, 'item Falabella ya procesado, skip');
        itemsProcessed++;
        continue;
      }

      if (!sku) {
        logger.warn({ orderId, itemKey }, 'item Falabella sin SKU, skip');
        itemsFailed++;
        results.push({ ...baseRes, status: 'sku_not_found' });
        if (!dryRun) {
          await marketplaceOrdersRepo.recordItem({
            platform, orderId, itemKey, sku: null, quantity, status: 'sku_not_found',
            error: 'falabella item sin SKU',
          });
        }
        continue;
      }

      if (dryRun) {
        itemsProcessed++;
        continue;
      }

      const stockAfter = await locks.withLock(sku, async () => {
        const ok = await shopify.updateStockBySKU(sku, quantity);
        if (!ok) throw new Error('shopify update failed');
        return shopify.getStockBySKU(sku);
      });

      logger.info({ orderId, sku, quantity, stockAfter }, 'stock descontado en Shopify');
      itemsProcessed++;
      results.push({ ...baseRes, status: 'success', stockAfter });

      await marketplaceOrdersRepo.recordItem({
        platform, orderId, itemKey, sku, quantity, status: 'processed', shopifyStockAfter: stockAfter,
      });
    } catch (err) {
      logger.error({ orderId, sku, err: err.message }, 'error procesando item Falabella');
      itemsFailed++;
      results.push({ ...baseRes, status: 'error', error: err.message });
      if (!dryRun) {
        await marketplaceOrdersRepo.recordItem({
          platform, orderId, itemKey, sku, quantity, status: 'failed', error: err.message,
        }).catch(() => {});
      }
    }
  }

  const fullyProcessed = itemsFailed === 0 && itemsProcessed === items.length;
  if (!dryRun) {
    const finalStatus = fullyProcessed ? 'processed' : (itemsProcessed > 0 ? 'partial' : 'failed');
    await marketplaceOrdersRepo.setOrderStatus(platform, orderId, finalStatus, {
      processedItems: itemsProcessed,
      failedItems: itemsFailed,
    });
  }

  const uniqueSkus = [...new Set(results.map((r) => r.sku).filter(Boolean))];
  if (!dryRun && uniqueSkus.length > 0) {
    logger.info({ count: uniqueSkus.length }, 'redistribuyendo a ML (NO a Falabella para evitar loop)');
    for (const sku of uniqueSkus) {
      const s = await shopify.getStockBySKU(sku);
      if (s === null) continue;
      await syncSkuToMarketplacesFromShopify(sku, s, { reason: 'redistribute_after_falabella_sale', skipFalabella: true });
    }
  }

  return {
    success: itemsFailed === 0,
    order_id: orderId,
    items_processed: itemsProcessed,
    items_failed: itemsFailed,
    total_items: items.length,
    results,
  };
}

// ========== TEST INTERNO: orden mockeada (solo validar resolver, sin MercadoLibre) ==========
const TEST_MOCK_ORDER_CASE_A = {
  id: 'test-order-case-a',
  status: 'paid',
  order_items: [
    { item: { id: 'MLC3535073664' }, quantity: 1, variation_id: 189654907244 }
  ]
};
const TEST_MOCK_ORDER_CASE_B = {
  id: 'test-order-case-b',
  status: 'paid',
  order_items: [
    { item: { id: 'MLC3539440116' }, quantity: 1, variation_id: null }
  ]
};
const TEST_MOCK_ORDER_CASE_C = {
  id: 'test-order-case-c',
  status: 'paid',
  order_items: [
    { item: { id: 'MLC3539466112' }, quantity: 1, variation_id: null }
  ]
};

app.post('/__test__/mercadolibre/order', async (req, res) => {
  try {
    const order = req.body && Object.keys(req.body).length > 0 ? req.body : null;
    const orderId = order?.id ?? order?.order_id ?? 'test-order-unknown';
    const dryRun = String(req.query.dry_run || req.query.dryRun || '1').toLowerCase() === '1' || String(req.query.dry_run) === 'true';

    if (!order || !order.order_items || !Array.isArray(order.order_items)) {
      return res.status(400).json({
        error: 'Body debe ser un objeto order con order_items (array). Ejemplo: TEST_MOCK_ORDER_CASE_A/B/C en este archivo.',
        cases: {
          A: 'variation_id válido en mapping → debe resolver SKU',
          B: 'variation_id=null, item_id con 1 SKU → debe resolver',
          C: 'variation_id=null, item_id con varios SKUs → ambiguous_item_no_variation, no descontar'
        }
      });
    }

    console.log(`\n🧪 [TEST] Procesando orden mock order_id=${orderId}, dry_run=${dryRun}`);
    const result = await processMercadoLibreOrder(order, orderId, { dryRun });
    console.log(`🧪 [TEST] Resultado: success=${result.success}, items_processed=${result.items_processed}, items_failed=${result.items_failed}\n`);
    return res.status(200).json({ ...result, _test: true, dry_run: dryRun });
  } catch (error) {
    console.error('🧪 [TEST] Error:', error.message);
    return res.status(500).json({ error: error.message, _test: true });
  }
});

// Log completo de order solo para la próxima orden recibida (temporal, para ver order_items y variation_id)
let _logOrderNextMeliWebhook = true;

/**
 * Endpoint para recibir webhooks de MercadoLibre
 * Configura este endpoint en MercadoLibre: https://developers.mercadolibre.com.ar/es_ar/notificaciones
 * Topic: orders_v2
 * URL: https://tu-servidor.com/webhooks/mercadolibre/order
 */
/**
 * Topics ML que NUNCA procesamos. Para estos, respondemos 200 inmediato sin
 * tocar DB ni logger (evita ensuciar webhook_events con miles de filas).
 * Si en el futuro queremos procesar alguno, lo sacamos de esta lista.
 */
const ML_IGNORED_TOPICS = new Set([
  'items',
  'items_prices',
  'public_candidates',
  'price_suggestion',
  'catalog_item_competition_status',
  'questions',
  'messages',
  'claims',
  'shipments',
  'leads',
  'stock-locations', // eco que ML manda cada vez que actualizamos stock
]);

app.post('/webhooks/mercadolibre/order', async (req, res) => {
  const topic = req.body?.topic;

  // Filtro temprano: topics que sabemos que ignoramos siempre.
  // 200 OK inmediato sin DB write. Reduce ruido cuando ML manda muchos eventos.
  if (topic && ML_IGNORED_TOPICS.has(topic)) {
    return res.status(200).json({ ok: true, ignored: true, topic });
  }

  const deliveryId = deliveryIdMeli(req.body);
  try {
    const { resource, user_id } = req.body;

    const rec = await webhookEvents.record({
      deliveryId, source: 'mercadolibre', topic, payload: req.body,
    });
    if (!rec.isNew) {
      logger.info({ deliveryId, status: rec.status }, 'webhook ML duplicado, ignorando');
      return res.status(200).json({ message: 'webhook duplicado', delivery_id: deliveryId, prev_status: rec.status });
    }

    if (topic !== 'orders_v2') {
      logger.info({ topic }, 'topic ML no procesado (no en blacklist pero tampoco orders_v2)');
      await webhookEvents.markIgnored(deliveryId, `topic ${topic} no procesado`);
      return res.status(200).json({ message: `Topic ${topic} no procesado` });
    }

    if (!resource) {
      await webhookEvents.markFailed(deliveryId, 'resource requerido');
      return res.status(400).json({ error: 'resource es requerido' });
    }

    const orderIdMatch = resource.match(/\/orders\/(\d+)/);
    if (!orderIdMatch) {
      await webhookEvents.markFailed(deliveryId, `resource sin order_id: ${resource}`);
      return res.status(400).json({ error: 'order_id no encontrado en resource' });
    }

    const orderId = orderIdMatch[1];
    const existingOrder = await marketplaceOrdersRepo.findOrder('mercadolibre', orderId);
    if (existingOrder && existingOrder.status === 'processed') {
      logger.info({ orderId, processedAt: existingOrder.processedAt }, 'orden ML ya procesada, ignorando');
      await webhookEvents.markIgnored(deliveryId, 'orden ya procesada');
      return res.status(200).json({ message: 'Orden ya procesada', order_id: orderId });
    }

    console.log(`\n🛒 Venta recibida en MercadoLibre: Order ID = ${orderId}`);
    console.log(`   Resource: ${resource}`);
    console.log(`   User ID: ${user_id}`);

    const orderResponse = await meli.client.get(`/orders/${orderId}`);
    const order = orderResponse.data;

    if (!order) {
      console.error(`❌ No se pudo obtener orden ${orderId}`);
      return res.status(500).json({ error: 'Error obteniendo orden' });
    }

    if (_logOrderNextMeliWebhook) {
      console.log('📋 [TEMP] order completo (solo esta vez):');
      console.log(JSON.stringify(order, null, 2));
      _logOrderNextMeliWebhook = false;
    }

    const validStatuses = ['confirmed', 'payment_required', 'payment_in_process', 'paid'];
    if (!validStatuses.includes(order.status)) {
      logger.info({ orderId, status: order.status }, 'orden ML en estado no procesable, skip');
      await webhookEvents.markIgnored(deliveryId, `orden estado: ${order.status}`);
      return res.status(200).json({ message: 'Orden en estado no procesable', order_id: orderId, status: order.status });
    }

    isSyncingFromMarketplace.mercadolibre = true;
    try {
      const result = await processMercadoLibreOrder(order, orderId);
      await webhookEvents.markProcessed(deliveryId);
      return res.status(200).json(result);
    } finally {
      isSyncingFromMarketplace.mercadolibre = false;
    }
  } catch (error) {
    isSyncingFromMarketplace.mercadolibre = false;
    logger.error({ deliveryId, err: error.message, stack: error.stack }, 'error procesando webhook ML');
    await webhookEvents.markFailed(deliveryId, error.message).catch(() => {});
    return res.status(500).json({ error: error.message, retry: true });
  }
});

/**
 * Webhook Falabella → Shopify
 *
 * FASE 1: OBSERVACIÓN DE PAYLOAD FALABELLA (modo seguro)
 * - ENABLE_FALABELLA=false por defecto
 * - NO llama a Falabella API
 * - NO llama a Shopify
 * - NO descuenta stock
 * - SOLO observa y loguea el payload real que envía Falabella
 *
 * Objetivo: entender la estructura exacta del webhook antes de activar lógica real.
 * NO activar lógica real todavía.
 */
app.post('/webhooks/falabella/order', async (req, res) => {
  const deliveryId = deliveryIdFalabella(req.body);
  try {
    const rec = await webhookEvents.record({
      deliveryId, source: 'falabella', topic: req.body?.event, payload: req.body,
    });
    if (!rec.isNew) {
      logger.info({ deliveryId, status: rec.status }, 'webhook Falabella duplicado, ignorando');
      return res.status(200).json({ message: 'webhook duplicado', delivery_id: deliveryId, prev_status: rec.status });
    }

    console.log('\n🔥 WEBHOOK FALABELLA RECIBIDO');
    console.log('='.repeat(60));

    // RAW BODY (antes de parsing)
    const rawBody = req.body;
    console.log('\n📦 RAW BODY:');
    console.log(JSON.stringify(rawBody, null, 2));

    // Headers
    console.log('\n📋 Headers:');
    console.log(JSON.stringify(req.headers || {}, null, 2));

    // Detectar posibles campos de Order ID
    const possibleOrderIdFields = ['orderId', 'OrderId', 'order_id', 'Order_ID', 'resource', 'order_number', 'orderNumber', 'id', 'Id'];
    let detectedOrderId = null;
    let detectedOrderIdField = null;

    for (const field of possibleOrderIdFields) {
      if (rawBody && typeof rawBody === 'object' && rawBody[field] !== undefined && rawBody[field] !== null) {
        detectedOrderId = String(rawBody[field]);
        detectedOrderIdField = field;
        break;
      }
    }
    // Falabella envía { event: "onOrderCreated", payload: { OrderId: 123 } }
    if (!detectedOrderId && rawBody?.payload && typeof rawBody.payload === 'object') {
      const p = rawBody.payload;
      for (const field of possibleOrderIdFields) {
        if (p[field] !== undefined && p[field] !== null) {
          detectedOrderId = String(p[field]);
          detectedOrderIdField = `payload.${field}`;
          break;
        }
      }
    }

    let orderIdForProcess = null;
    if (detectedOrderId) {
      console.log(`\n✅ PARSED ORDER ID: "${detectedOrderId}" (campo: "${detectedOrderIdField}")`);
      const match = detectedOrderId.match(/\/orders\/(\d+)/) || detectedOrderId.match(/(\d+)/);
      orderIdForProcess = match ? match[1] : detectedOrderId;
    } else {
      console.log('\n⚠️  ORDER ID: No detectado en campos comunes');
      console.log('   Campos disponibles en body:', Object.keys(rawBody || {}));
    }

    // Si tenemos orderId y Falabella activo → procesar orden (descontar Shopify, redistribuir solo a Meli)
    const enableFalabella = String(process.env.ENABLE_FALABELLA || 'false').toLowerCase() === 'true';
    if (orderIdForProcess && enableFalabella && falabella) {
      isSyncingFromMarketplace.falabella = true;
      try {
        const result = await processFalabellaOrder(orderIdForProcess);
        logger.info({ orderId: orderIdForProcess, processed: result.items_processed, failed: result.items_failed }, 'orden Falabella procesada');
        await webhookEvents.markProcessed(deliveryId);
        return res.status(200).json({ ok: true, order_id: orderIdForProcess, ...result });
      } finally {
        isSyncingFromMarketplace.falabella = false;
      }
    }

    // Detectar posibles arrays de items (modo observación si no se procesó)
    const possibleItemsFields = ['items', 'Items', 'order_items', 'orderItems', 'products', 'Products', 'line_items', 'lineItems'];
    let detectedItems = null;
    let detectedItemsField = null;

    for (const field of possibleItemsFields) {
      if (rawBody && typeof rawBody === 'object' && Array.isArray(rawBody[field])) {
        detectedItems = rawBody[field];
        detectedItemsField = field;
        break;
      }
    }

    if (detectedItems && detectedItems.length > 0) {
      console.log(`\n📦 RAW ITEMS (campo: "${detectedItemsField}", cantidad: ${detectedItems.length}):`);
      console.log(JSON.stringify(detectedItems, null, 2));
    } else {
      console.log('\n⚠️  ITEMS: No se detectó array de items en campos comunes');
    }

    // Estructura completa del body (para análisis)
    console.log('\n🔍 ESTRUCTURA COMPLETA DEL BODY:');
    console.log(JSON.stringify(rawBody, null, 2));

    // ========== VERIFICACIÓN DE SKUs CONTRA SHOPIFY (SOLO OBSERVACIÓN) ==========
    // Detectar posibles SKUs en el payload y verificar si existen en Shopify
    // NO se actualiza stock, NO se hacen cambios, SOLO logs de observación
    console.log('\n' + '='.repeat(60));
    console.log('🔍 VERIFICACIÓN DE SKUs FALABELLA vs SHOPIFY (modo observación)');
    console.log('='.repeat(60));

    const detectedSKUs = new Set();

    // Función helper para extraer SKUs de un objeto/array recursivamente
    function extractSKUs(obj, path = '') {
      if (!obj || typeof obj !== 'object') return;

      // Buscar campos comunes de SKU
      const skuFields = ['sku', 'SKU', 'sellerSku', 'SellerSku', 'seller_sku', 'SellerSKU', 'productSku', 'ProductSku', 'itemSku', 'ItemSku'];
      
      for (const field of skuFields) {
        if (obj[field] !== undefined && obj[field] !== null && String(obj[field]).trim() !== '') {
          detectedSKUs.add(String(obj[field]).trim());
        }
      }

      // Recursión para objetos y arrays
      if (Array.isArray(obj)) {
        obj.forEach((item, idx) => extractSKUs(item, `${path}[${idx}]`));
      } else {
        for (const [key, value] of Object.entries(obj)) {
          if (value && typeof value === 'object') {
            extractSKUs(value, path ? `${path}.${key}` : key);
          }
        }
      }
    }

    // Extraer SKUs del payload completo
    extractSKUs(rawBody);

    if (detectedSKUs.size > 0) {
      console.log(`\n📋 SKUs detectados en payload: ${detectedSKUs.size}`);
      
      // Verificar cada SKU contra Shopify
      for (const sku of detectedSKUs) {
        try {
          console.log(`\n   🔍 Verificando SKU: "${sku}"`);
          
          // Buscar SKU en productos de Shopify (solo lectura, sin cambios)
          const products = await shopify.getAllProducts();
          let found = false;
          let productInfo = null;

          for (const product of products) {
            for (const variant of product.variants || []) {
              const variantSKU = variant.sku ? variant.sku.trim() : '';
              if (variantSKU.toUpperCase() === sku.toUpperCase()) {
                found = true;
                productInfo = {
                  productTitle: product.title,
                  variantTitle: variant.title || 'Default',
                  variantId: variant.id,
                  inventoryItemId: variant.inventory_item_id
                };
                break;
              }
            }
            if (found) break;
          }

          if (found && productInfo) {
            console.log(`   🟢 MATCH EN SHOPIFY:`);
            console.log(`      Producto: "${productInfo.productTitle}"`);
            console.log(`      Variante: "${productInfo.variantTitle}"`);
            console.log(`      Variant ID: ${productInfo.variantId}`);
            console.log(`      Inventory Item ID: ${productInfo.inventoryItemId}`);
          } else {
            console.log(`   🔴 NO EXISTE EN SHOPIFY`);
            console.log(`      SKU "${sku}" no encontrado en ningún producto/variante`);
          }
        } catch (error) {
          console.log(`   ⚠️  Error verificando SKU "${sku}":`, error.message);
        }
      }
    } else {
      console.log('\n   ⚠️  No se detectaron SKUs en el payload');
      console.log('   💡 Tip: Los SKUs pueden estar en campos como: sku, sellerSku, seller_sku, etc.');
    }

    console.log('\n' + '='.repeat(60));
    console.log('ℹ️  FASE 1: Modo observación - NO se ejecuta lógica real');
    console.log('='.repeat(60) + '\n');

    // enableFalabella ya declarado arriba (línea ~740)
    const enableFalabellaObs = String(process.env.ENABLE_FALABELLA || 'false').toLowerCase() === 'true';

    // MODO TEST: no tocar stock, no llamar APIs externas.
    if (!enableFalabellaObs) {
      console.log('   ℹ️  ENABLE_FALABELLA=false → modo webhook_test (sin efectos colaterales)');
      await webhookEvents.markIgnored(deliveryId, 'ENABLE_FALABELLA=false');
      return res.status(200).json({ ok: true, mode: 'webhook_test' });
    }

    console.log('   ⚠️  ENABLE_FALABELLA=true pero la lógica real aún no está activada en este entorno.');
    await webhookEvents.markIgnored(deliveryId, 'webhook placeholder');
    return res.status(200).json({ ok: true, mode: 'webhook_placeholder' });
  } catch (error) {
    logger.error({ deliveryId, err: error.message, stack: error.stack }, 'error procesando webhook Falabella');
    await webhookEvents.markFailed(deliveryId, error.message).catch(() => {});
    return res.status(500).json({ error: error.message, retry: true });
  }
});

/**
 * Endpoint de salud para verificar que el servidor está funcionando
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    is_syncing_from_marketplace: isSyncingFromMarketplace,
    falabella_enabled: Boolean(falabella),
    hmac_verification: Boolean(config.SHOPIFY_API_SECRET),
    database_url_configured: Boolean(config.DATABASE_URL),
    reconcile_interval_min: config.RECONCILE_INTERVAL_MIN,
  });
});

/**
 * Endpoint de prueba para sincronizar un SKU específico manualmente
 * Útil para debugging: GET /test-sync?sku=B-M-CRU
 */
app.get('/test-sync', async (req, res) => {
  try {
    const { sku } = req.query;
    
    if (!sku) {
      return res.status(400).json({ error: 'Parámetro sku es requerido. Ejemplo: /test-sync?sku=B-M-CRU' });
    }

    console.log(`\n🧪 ========== PRUEBA MANUAL DE SINCRONIZACIÓN ==========`);
    console.log(`📦 SKU a sincronizar: ${sku}\n`);

    // Obtener stock de Shopify
    console.log('1️⃣ Obteniendo stock de Shopify...');
    const shopifyStock = await shopify.getStockBySKU(sku);
    if (shopifyStock === null) {
      console.log(`   ❌ SKU ${sku} no encontrado en Shopify`);
      return res.status(404).json({ error: `SKU ${sku} no encontrado en Shopify` });
    }
    console.log(`   ✅ Stock en Shopify: ${shopifyStock}`);

    // Calcular stock para MercadoLibre
    const meliStock = calculateMeliStock(shopifyStock);
    console.log(`   🧮 Stock calculado para MercadoLibre: ${meliStock} (Shopify ${shopifyStock} - offset ${stockOffset})`);

    // Buscar en MercadoLibre
    console.log(`\n2️⃣ Buscando SKU ${sku} en MercadoLibre...`);
    const result = await meli.findItemBySKU(sku, true); // true = debug mode
    if (!result) {
      console.log(`   ❌ SKU ${sku} no encontrado en MercadoLibre`);
      return res.status(404).json({ error: `SKU ${sku} no encontrado en MercadoLibre` });
    }

    const { itemId, variationId } = result;
    console.log(`   ✅ Item encontrado: itemId=${itemId}, variationId=${variationId}`);

    // Obtener stock actual en MercadoLibre
    console.log(`\n3️⃣ Obteniendo stock actual en MercadoLibre...`);
    const currentMeliStock = await meli.getStock(itemId, variationId);
    console.log(`   📊 Stock actual en MercadoLibre: ${currentMeliStock}`);

    // Actualizar si es necesario
    if (currentMeliStock !== meliStock) {
      console.log(`\n4️⃣ Actualizando stock en MercadoLibre...`);
      const updated = await meli.updateStock(itemId, meliStock, variationId);
      if (updated) {
        console.log(`   ✅ Stock actualizado exitosamente: ${currentMeliStock} → ${meliStock}`);
        console.log('🧪 ========== PRUEBA COMPLETADA EXITOSAMENTE ==========\n');
        return res.json({
          success: true,
          sku,
          shopifyStock,
          meliStock,
          previousMeliStock: currentMeliStock,
          itemId,
          variationId
        });
      } else {
        console.log(`   ❌ Error al actualizar stock`);
        console.log('🧪 ========== ERROR EN ACTUALIZACIÓN ==========\n');
        return res.status(500).json({ error: 'Error actualizando stock en MercadoLibre' });
      }
    } else {
      console.log(`   ✓ Stock ya está sincronizado (${meliStock})`);
      console.log('🧪 ========== STOCK YA SINCRONIZADO ==========\n');
      return res.json({
        success: true,
        sku,
        shopifyStock,
        meliStock,
        message: 'Stock ya está sincronizado',
        itemId,
        variationId
      });
    }

  } catch (error) {
    console.error('❌ Error en prueba:', error.message);
    console.error('Stack:', error.stack);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * Sincronización general: toma el stock actual de (todos o filtrados) productos en Shopify
 * y lo envía a MercadoLibre y Falabella. Protegido por SYNC_ALL_SECRET.
 * Uso: GET o POST /sync-all?key=TU_SECRETO
 * Opcional: ?skus=B-G-MOKA,T-M-CRU,... para sincronizar solo esos SKUs.
 * Env: SYNC_ALL_SKU_LIST (lista fija) o SYNC_ALL_SKU_PREFIX (ej. B-G-,T-M-) para filtrar sin pasar ?skus=.
 * Responde 202 y ejecuta la sync en segundo plano (revisa los logs).
 */
function handleSyncAll(req, res) {
  const providedKey = req.query.key || req.headers['x-sync-all-key'] || '';
  const secret = process.env.SYNC_ALL_SECRET || '';
  if (!secret || providedKey !== secret) {
    return res.status(403).json({ error: 'Acceso denegado. Configura SYNC_ALL_SECRET y usa ?key=... o header X-Sync-All-Key.' });
  }

  const skusParam = (req.query.skus && String(req.query.skus).trim()) || '';
  res.status(202).json({
    message: 'Sincronización general iniciada en segundo plano. Revisa los logs en Render.',
    hint: skusParam ? `Solo se sincronizarán los ${skusParam.split(',').length} SKUs indicados.` : 'Puede tardar varios minutos según cantidad de productos.'
  });

  (async function runSyncAll() {
    try {
      console.log('\n🔄 ========== SINCRONIZACIÓN GENERAL (sync-all) ==========');
      const skuStockMap = await shopify.getAllSKUsWithStock();
      let skus = [...skuStockMap.keys()];

      // Filtrar: ?skus= lista explícita, o SYNC_ALL_SKU_LIST env, o SYNC_ALL_SKU_PREFIX (prefijos)
      const explicitList = skusParam
        ? skusParam.split(',').map(s => s.trim()).filter(Boolean)
        : (process.env.SYNC_ALL_SKU_LIST || '').split(',').map(s => s.trim()).filter(Boolean);
      const prefixList = (process.env.SYNC_ALL_SKU_PREFIX || '').split(',').map(s => s.trim()).filter(Boolean);

      if (explicitList.length > 0) {
        skus = skus.filter(sku => explicitList.includes(sku));
        console.log(`📋 Solo SKUs indicados (${explicitList.length} en la lista → ${skus.length} encontrados en Shopify)\n`);
      } else if (prefixList.length > 0) {
        skus = skus.filter(sku => prefixList.some(prefix => sku.startsWith(prefix)));
        console.log(`📋 Solo SKUs con prefijo(s) [${prefixList.join(', ')}]: ${skus.length} de ${skuStockMap.size}\n`);
      } else {
        console.log(`📦 Total SKUs en Shopify: ${skus.length}\n`);
      }

      if (skus.length === 0) {
        console.log('⚠️  No hay SKUs a sincronizar. Revisa ?skus= o SYNC_ALL_SKU_LIST / SYNC_ALL_SKU_PREFIX.');
        return;
      }

      let okMeli = 0, okFalabella = 0, failMeli = 0, failFalabella = 0, skipMeli = 0, skipFalabella = 0;
      const delayMs = parseInt(process.env.SYNC_ALL_DELAY_MS || '1200', 10);

      for (let i = 0; i < skus.length; i++) {
        const sku = skus[i];
        const stock = skuStockMap.get(sku);
        const out = await syncSkuToMarketplacesFromShopify(sku, stock, { reason: 'sync_all' });
        for (const r of out.results) {
          if (r.marketplace === 'mercadolibre') { if (r.ok) okMeli++; else if (r.reason === 'not_found') skipMeli++; else failMeli++; }
          if (r.marketplace === 'falabella') { if (r.ok) okFalabella++; else if (r.skipped || r.reason === 'access_denied_skipped') skipFalabella++; else failFalabella++; }
        }
        if ((i + 1) % 50 === 0) console.log(`   📊 Progreso: ${i + 1}/${skus.length} SKUs`);
        if (delayMs > 0 && i < skus.length - 1) await new Promise(r => setTimeout(r, delayMs));
      }

      console.log('\n📊 ========== RESUMEN SINCRONIZACIÓN GENERAL ==========');
      console.log(`   MercadoLibre: ✅ ${okMeli} actualizados, ⏭️ ${skipMeli} no en Meli, ❌ ${failMeli} errores`);
      console.log(`   Falabella:    ✅ ${okFalabella} actualizados, ⏭️ ${skipFalabella} omitidos, ❌ ${failFalabella} errores`);
      console.log(`   Total SKUs:   ${skus.length}`);
      console.log('========================================================\n');
    } catch (err) {
      console.error('❌ Error en sincronización general:', err.message);
      console.error(err.stack);
    }
  })();
}
app.get('/sync-all', handleSyncAll);
app.post('/sync-all', handleSyncAll);

const PORT = config.PORT;

app.listen(PORT, async () => {
  logger.info(
    {
      port: PORT,
      env: config.NODE_ENV,
      falabella_enabled: Boolean(falabella),
      hmac_verification: Boolean(config.SHOPIFY_API_SECRET),
      database_url_configured: Boolean(config.DATABASE_URL),
      reconcile_interval_min: config.RECONCILE_INTERVAL_MIN,
    },
    'servidor iniciado',
  );

  // Verificar órdenes pendientes al arrancar (catch-up de ML, una sola vez).
  import('./check-pending-orders.js')
    .then((module) => module.default())
    .catch((err) => logger.warn({ err: err.message }, 'check-pending-orders falló'));

  // Cron del reconciliador. Si RECONCILE_INTERVAL_MIN > 0, arranca setInterval.
  if (config.RECONCILE_INTERVAL_MIN > 0) {
    const ms = config.RECONCILE_INTERVAL_MIN * 60 * 1000;
    logger.info({ intervalMin: config.RECONCILE_INTERVAL_MIN }, 'reconciler cron: activado');
    setInterval(async () => {
      try {
        logger.info({ intervalMin: config.RECONCILE_INTERVAL_MIN }, 'reconciler cron: tick');
        const summary = await reconcileStock({ shopify, meli, falabella }, {});
        logger.info(summary, 'reconciler cron: completado');
      } catch (err) {
        logger.error({ err: err.message, stack: err.stack }, 'reconciler cron: error');
      }
    }, ms);
  } else {
    logger.info('reconciler cron: deshabilitado (RECONCILE_INTERVAL_MIN=0). Solo manual vía /admin/reconcile-stock.');
  }
});
