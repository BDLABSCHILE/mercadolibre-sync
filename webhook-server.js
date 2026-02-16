import express from 'express';
import ShopifyAPI from './shopify-api.js';
import MercadoLibreAPI from './mercadolibre-api.js';
import FalabellaAPI from './falabella-api.js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createIdempotencyStore } from './idempotency-store.js';
import { meliVariationIdToSku, meliItemIdToSkus } from './meli-sku-mapping.js';

dotenv.config();

// Obtener el directorio actual para ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

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
// Store genérico por marketplace (driver file|memory configurable).
// OJO: si IDEMPOTENCY_STORE=file en Render multi-instancia o FS efímero, NO garantiza idempotencia global.
const idempotency = {
  mercadolibre: createIdempotencyStore('mercadolibre'),
  falabella: createIdempotencyStore('falabella'),
};

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
app.post('/webhooks/shopify/orders/create', shopifyRawParser, async (req, res) => {
  try {
    console.log('\n🔥 WEBHOOK SHOPIFY RECIBIDO → /webhooks/shopify/orders/create');
    const body = parseRawBodySafe(req.body);
    if (!body) {
      console.log('❌ Body vacío o JSON inválido');
      return res.status(400).json({ error: 'Body vacío o JSON inválido' });
    }
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

    console.log(`📊 orders/create: ${synced} SKUs sincronizados, ${failed} fallidos`);
    console.log('🔥 WEBHOOK SHOPIFY orders/create PROCESADO\n');
    return res.status(200).json({
      success: failed === 0,
      order_id: body.id,
      skus_synced: synced,
      skus_failed: failed,
      total_line_items: lineItems.length
    });
  } catch (error) {
    console.error('❌ Error webhook orders/create:', error.message);
    console.error(error.stack);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /webhook/inventory
 * Evento: Inventory levels update. También usa body RAW.
 */
app.post('/webhook/inventory', shopifyRawParser, async (req, res) => {
  try {
    console.log('\n🔥 WEBHOOK SHOPIFY RECIBIDO → /webhook/inventory');
    const body = parseRawBodySafe(req.body);
    if (!body) {
      console.log('❌ Body vacío o JSON inválido');
      return res.status(400).json({ error: 'Body vacío o JSON inválido' });
    }
    console.log('📥 Body (resumen):', JSON.stringify({ topic: body.topic, inventory_item_id: body.inventory_item_id, available: body.available }, null, 2));

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
    const okAll = out.results.every(r => r.ok);
    if (okAll) {
      console.log('🔥 WEBHOOK SHOPIFY inventory PROCESADO\n');
      return res.status(200).json({ success: true, sku, shopifyStock, marketplaces: out.results });
    }

    // Siempre 200 para que Shopify NO reintente: SKU no en Meli/Falabella es esperado (no todos los productos están en todos los marketplaces)
    console.log('🔥 WEBHOOK SHOPIFY inventory: sync parcial (alguno falló, no reintentar)\n');
    return res.status(200).json({
      success: false,
      sku,
      shopifyStock,
      marketplaces: out.results,
      message: 'Uno o más marketplaces no actualizados (ej. SKU no vendido ahí). No se reintenta.'
    });
  } catch (error) {
    console.error('❌ Error webhook inventory:', error.message);
    console.error(error.stack);
    return res.status(500).json({ error: error.message });
  }
});

// ========== JSON para el resto de rutas (MercadoLibre, etc.) ==========
app.use(express.json());

/**
 * Procesa una orden de MercadoLibre: loop de items, resolver determinístico, descuento en Shopify, idempotencia.
 * Usado por el webhook real y por el endpoint de prueba interna.
 * @param {object} order - Objeto orden (order_items, status, etc.)
 * @param {string} orderId - ID de la orden (para claves de idempotencia)
 * @param {{ dryRun?: boolean }} options - dryRun: si true, no llama a Shopify ni marca idempotencia (solo valida resolver)
 * @returns {Promise<{ success, order_id, status, items_processed, items_failed, total_items, fully_processed, results }>}
 */
async function processMercadoLibreOrder(order, orderId, options = {}) {
  const dryRun = Boolean(options.dryRun);
  const orderKey = `order:${orderId}`;
  let itemsProcessed = 0;
  let itemsFailed = 0;
  const results = [];

  if (!order.order_items || order.order_items.length === 0) {
    console.log(`⚠️  Orden ${orderId} no tiene items`);
    return {
      success: false,
      order_id: orderId,
      status: order.status || null,
      items_processed: 0,
      items_failed: 0,
      total_items: 0,
      fully_processed: false,
      results: []
    };
  }

  console.log(`   Items en la orden: ${order.order_items.length}\n`);

  for (const orderItem of order.order_items) {
    const { item, quantity } = orderItem;
    const variation_id =
      orderItem.variation_id ??
      item?.variation_id ??
      null;
    const itemId = item?.id;

    try {
      console.log(`   📦 Procesando item ${itemId} (variation: ${variation_id ?? 'null'}, cantidad: ${quantity})`);

      const itemKey = `order:${orderId}:item:${itemId}:${variation_id || 'NA'}`;
      if (!dryRun && idempotency.mercadolibre.has(itemKey)) {
        console.log(`      ⏭️  Item ya procesado previamente: ${itemKey}`);
        itemsProcessed++;
        results.push({ itemId, variationId: variation_id, status: 'skipped_already_processed' });
        continue;
      }

      let sku = null;
      if (variation_id != null && variation_id !== '') {
        sku = meliVariationIdToSku.get(String(variation_id)) ?? null;
      } else {
        const skusForItem = meliItemIdToSkus.get(itemId) || [];
        if (skusForItem.length === 1) {
          sku = skusForItem[0];
        } else if (skusForItem.length > 1) {
          console.log(`      ❌ item_id=${itemId} con variation_id=null tiene ${skusForItem.length} SKUs en el mapping (${skusForItem.join(', ')}). No se puede determinar cuál descontar; NO se descuenta stock.`);
          itemsFailed++;
          results.push({ itemId, variationId: variation_id, sku: null, status: 'ambiguous_item_no_variation' });
          continue;
        }
      }

      if (!sku || sku.trim() === '') {
        console.log(`      ⚠️  SKU no encontrado para item ${itemId}, variación ${variation_id || 'N/A'}`);
        itemsFailed++;
        results.push({ itemId, variationId: variation_id, sku: null, status: 'sku_not_found' });
        continue;
      }

      console.log(`      ✅ SKU resuelto: ${sku}`);

      if (dryRun) {
        itemsProcessed++;
        results.push({ itemId, variationId: variation_id, sku, quantity, status: 'success_dry_run' });
        continue;
      }

      const updated = await shopify.updateStockBySKU(sku, quantity);
      if (updated) {
        idempotency.mercadolibre.mark(itemKey);
        const currentStock = await shopify.getStockBySKU(sku);
        console.log(`      ✅ Stock actualizado en Shopify: ${sku} (cantidad descontada: ${quantity}, stock actual: ${currentStock})`);
        itemsProcessed++;
        results.push({ itemId, variationId: variation_id, sku, quantity, status: 'success', stockAfter: currentStock });
      } else {
        console.log(`      ❌ Error actualizando stock para SKU ${sku}`);
        itemsFailed++;
        results.push({ itemId, variationId: variation_id, sku, quantity, status: 'update_failed' });
      }
    } catch (error) {
      console.error(`      ❌ Error procesando item ${itemId}:`, error.response?.data || error.message);
      itemsFailed++;
      results.push({ itemId, variationId: variation_id, status: 'error', error: error.message });
    }
  }

  const fullyProcessed = itemsFailed === 0 && itemsProcessed === order.order_items.length;
  if (!dryRun && fullyProcessed) {
    idempotency.mercadolibre.mark(orderKey);
    console.log(`\n✅ Orden ${orderId} procesada completamente (${itemsProcessed}/${order.order_items.length} items)`);
  } else if (!dryRun && itemsFailed > 0) {
    console.log(`\n⚠️  Orden ${orderId} procesada PARCIALMENTE: ${itemsProcessed} exitosos, ${itemsFailed} fallidos`);
  }

  console.log(`\n📊 Resumen: ${itemsProcessed} procesados, ${itemsFailed} fallidos, ${order.order_items.length} total`);

  if (!dryRun) {
    const uniqueSkus = Array.from(new Set(results.map(r => r.sku).filter(Boolean)));
    if (uniqueSkus.length > 0) {
      console.log(`\n🔁 Redistribuyendo stock desde Shopify para ${uniqueSkus.length} SKU(s)...`);
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
    results
  };
}

/**
 * Procesa una orden de Falabella: obtiene items, descuenta en Shopify, redistribuye solo a Meli (no a Falabella para evitar loop).
 */
async function processFalabellaOrder(orderId, options = {}) {
  const dryRun = Boolean(options.dryRun);
  const orderKey = `order:${orderId}`;

  if (!falabella) {
    console.log('⚠️  Falabella no inicializado, no se puede procesar orden');
    return { success: false, order_id: orderId, items_processed: 0, items_failed: 0 };
  }

  if (!dryRun && idempotency.falabella.has(orderKey)) {
    console.log(`⏭️  Orden Falabella ${orderId} ya procesada anteriormente`);
    return { success: true, order_id: orderId, items_processed: 0, items_failed: 0, skipped: true };
  }

  let items;
  try {
    items = await falabella.getOrderItems(orderId);
  } catch (e) {
    console.error(`❌ Error obteniendo items de orden Falabella ${orderId}:`, e.message);
    return { success: false, order_id: orderId, items_processed: 0, items_failed: 0, error: e.message };
  }

  if (!items || items.length === 0) {
    console.log(`⚠️  Orden Falabella ${orderId} sin items o vacía`);
    return { success: false, order_id: orderId, items_processed: 0, items_failed: 0 };
  }

  console.log(`   Items en la orden Falabella: ${items.length}\n`);
  let itemsProcessed = 0;
  let itemsFailed = 0;
  const results = [];

  for (const it of items) {
    const { sku, quantity, orderItemId } = it;
    const itemKey = `order:${orderId}:item:${orderItemId || sku}-${quantity}`;
    if (!dryRun && idempotency.falabella.has(itemKey)) {
      itemsProcessed++;
      continue;
    }

    try {
      console.log(`   📦 Procesando ${sku} (cantidad: ${quantity})`);
      if (dryRun) {
        itemsProcessed++;
        continue;
      }

      const updated = await shopify.updateStockBySKU(sku, quantity);
      if (updated) {
        idempotency.falabella.mark(itemKey);
        const currentStock = await shopify.getStockBySKU(sku);
        console.log(`      ✅ Stock actualizado en Shopify: ${sku} (descontado: ${quantity}, stock actual: ${currentStock})`);
        itemsProcessed++;
        results.push({ sku, quantity, status: 'success', stockAfter: currentStock });
      } else {
        itemsFailed++;
        results.push({ sku, quantity, status: 'update_failed' });
      }
    } catch (e) {
      console.error(`      ❌ Error procesando ${sku}:`, e.message);
      itemsFailed++;
      results.push({ sku, quantity, status: 'error', error: e.message });
    }
  }

  if (!dryRun && itemsFailed === 0 && itemsProcessed === items.length) {
    idempotency.falabella.mark(orderKey);
  }

  const uniqueSkus = Array.from(new Set(results.map(r => r.sku).filter(Boolean)));
  if (!dryRun && uniqueSkus.length > 0) {
    console.log(`\n🔁 Redistribuyendo stock a MercadoLibre (NO a Falabella para evitar loop)...`);
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
    results
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
app.post('/webhooks/mercadolibre/order', async (req, res) => {
  try {
    const { resource, topic, user_id } = req.body;

    if (topic !== 'orders_v2') {
      console.log(`⚠️  Topic no reconocido: ${topic}`);
      console.log(`   💡 Este webhook es de MercadoLibre, solo procesamos 'orders_v2'`);
      return res.status(200).json({ message: `Topic ${topic} no procesado` });
    }

    if (!resource) {
      console.log('⚠️  Notificación sin resource');
      return res.status(400).json({ error: 'resource es requerido' });
    }

    const orderIdMatch = resource.match(/\/orders\/(\d+)/);
    if (!orderIdMatch) {
      console.log(`⚠️  No se pudo extraer order_id de resource: ${resource}`);
      return res.status(400).json({ error: 'order_id no encontrado en resource' });
    }

    const orderId = orderIdMatch[1];
    const orderKey = `order:${orderId}`;
    if (idempotency.mercadolibre.has(orderKey)) {
      console.log(`⏭️  [mercadolibre] Orden ${orderId} ya procesada anteriormente, ignorando`);
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
      console.log(`⏭️  Orden ${orderId} en estado "${order.status}", no procesada aún`);
      return res.status(200).json({ message: 'Orden en estado no procesable', order_id: orderId, status: order.status });
    }

    console.log(`   Estado: ${order.status}`);
    console.log(`   Total: ${order.total_amount} ${order.currency_id}`);

    isSyncingFromMarketplace.mercadolibre = true;
    try {
      const result = await processMercadoLibreOrder(order, orderId);
      return res.status(200).json(result);
    } finally {
      isSyncingFromMarketplace.mercadolibre = false;
    }
  } catch (error) {
    isSyncingFromMarketplace.mercadolibre = false;
    console.error('❌ Error procesando webhook de MercadoLibre:', error.response?.data || error.message);
    console.error('Stack:', error.stack);
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
  try {
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
        console.log(`\n🛒 Orden Falabella ${orderIdForProcess} procesada: ${result.items_processed} items, ${result.items_failed} fallidos`);
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
      return res.status(200).json({ ok: true, mode: 'webhook_test' });
    }

    // Cuando se active ENABLE_FALABELLA='true', acá reactivaremos la lógica real
    // de integración (GetOrder + descuento de stock + redistribución).
    console.log('   ⚠️  ENABLE_FALABELLA=true pero la lógica real aún no está activada en este entorno.');
    return res.status(200).json({ ok: true, mode: 'webhook_placeholder' });
  } catch (error) {
    console.error('❌ Error procesando webhook de Falabella:', error.message);
    console.error('Stack:', error.stack);
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
    idempotency_store: process.env.IDEMPOTENCY_STORE || 'file',
    is_syncing_from_marketplace: isSyncingFromMarketplace,
    falabella_enabled: Boolean(falabella)
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

const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  console.log(`🚀 Servidor de webhooks iniciado en puerto ${PORT}`);
  console.log(`📡 Shopify orders/create: http://localhost:${PORT}/webhooks/shopify/orders/create`);
  console.log(`📡 Shopify inventory:      http://localhost:${PORT}/webhook/inventory`);
  console.log(`📡 MercadoLibre order:      http://localhost:${PORT}/webhooks/mercadolibre/order`);
  console.log(`📡 Falabella order:         http://localhost:${PORT}/webhooks/falabella/order`);
  console.log(`💚 Health:                  http://localhost:${PORT}/health`);
  console.log(`🧪 Test sync:               http://localhost:${PORT}/test-sync?sku=B-M-CRU`);
  console.log(`🔄 Sync general:             http://localhost:${PORT}/sync-all?key=SYNC_ALL_SECRET`);
  console.log(`\n🔍 Verificando órdenes pendientes de MercadoLibre...`);
  
  // Verificar órdenes pendientes al iniciar (solo una vez, en background)
  // Usar import dinámico para evitar problemas de dependencias circulares
  import('./check-pending-orders.js').then(module => {
    module.default().catch(err => {
      console.error('⚠️  Error verificando órdenes pendientes:', err.message);
    });
  }).catch(err => {
    console.warn('⚠️  No se pudo cargar check-pending-orders:', err.message);
  });
});
