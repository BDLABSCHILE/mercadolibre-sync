import express from 'express';
import ShopifyAPI from './shopify-api.js';
import MercadoLibreAPI from './mercadolibre-api.js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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
const stockOffset = parseInt(process.env.STOCK_OFFSET || '1', 10);

// ========== PROTECCIÓN CONTRA LOOPS ==========
// Flag para evitar que actualizaciones desde MercadoLibre disparen webhooks de Shopify
let isSyncingFromMeli = false;

// ========== IDEMPOTENCIA ==========
// Archivo de persistencia para órdenes procesadas
const PROCESSED_ORDERS_FILE = path.join(__dirname, '.meli-processed-orders.json');

// Set para trackear order_ids ya procesados (con persistencia)
const processedOrders = new Set();

/**
 * Carga las órdenes ya procesadas desde el archivo de persistencia
 */
function loadProcessedOrders() {
  try {
    if (fs.existsSync(PROCESSED_ORDERS_FILE)) {
      const data = fs.readFileSync(PROCESSED_ORDERS_FILE, 'utf8');
      const orders = JSON.parse(data);
      if (Array.isArray(orders)) {
        orders.forEach(orderId => processedOrders.add(orderId));
        console.log(`📋 Cargadas ${processedOrders.size} órdenes ya procesadas previamente`);
      }
    }
  } catch (error) {
    console.warn('⚠️  No se pudo cargar el archivo de órdenes procesadas, usando cache en memoria:', error.message);
    processedOrders.clear();
  }
}

/**
 * Guarda una orden como procesada en el archivo de persistencia
 */
function markOrderAsProcessed(orderId) {
  try {
    processedOrders.add(orderId);
    
    // Guardar en archivo
    const orders = Array.from(processedOrders);
    fs.writeFileSync(PROCESSED_ORDERS_FILE, JSON.stringify(orders, null, 2), 'utf8');
  } catch (error) {
    // Si falla la escritura, al menos mantenerlo en memoria
    console.warn(`⚠️  No se pudo guardar orden ${orderId} como procesada:`, error.message);
  }
}

// Cargar órdenes procesadas al iniciar el servidor
loadProcessedOrders();

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

    if (isSyncingFromMeli) {
      console.log('🛡️  Ignorado (sincronización activa desde MercadoLibre)');
      return res.status(200).json({ message: 'Ignorado: sincronización desde MercadoLibre en curso' });
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
      const meliStock = calculateMeliStock(shopifyStock);
      const result = await meli.findItemBySKU(sku);
      if (!result) {
        console.log(`   ⚠️  SKU ${sku}: no encontrado en MercadoLibre`);
        failed++;
        continue;
      }
      const ok = await meli.updateStock(result.itemId, meliStock, result.variationId);
      if (ok) {
        console.log(`   ✅ ${sku} → MercadoLibre(${meliStock})`);
        synced++;
      } else {
        console.log(`   ❌ ${sku}: error actualizando ML`);
        failed++;
      }
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

    if (isSyncingFromMeli) {
      console.log('🛡️  Ignorado (sincronización activa desde MercadoLibre)');
      return res.status(200).json({ message: 'Ignorado: sincronización desde MercadoLibre en curso' });
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

    const meliStock = calculateMeliStock(shopifyStock);
    console.log(`   🧮 MercadoLibre: ${meliStock} (offset ${stockOffset})`);

    const result = await meli.findItemBySKU(sku);
    if (!result) {
      console.log(`⚠️  SKU ${sku} no encontrado en MercadoLibre`);
      return res.status(200).json({ message: 'Item no encontrado en MercadoLibre' });
    }

    const updated = await meli.updateStock(result.itemId, meliStock, result.variationId);
    if (updated) {
      console.log(`✅ Sincronizado: ${sku} → MercadoLibre(${meliStock})`);
      console.log('🔥 WEBHOOK SHOPIFY inventory PROCESADO\n');
      return res.status(200).json({ success: true, sku, shopifyStock, meliStock });
    }
    console.log(`❌ Error actualizando ML para ${sku}`);
    console.log('🔥 WEBHOOK SHOPIFY inventory ERROR\n');
    return res.status(500).json({ error: 'Error actualizando stock en MercadoLibre' });
  } catch (error) {
    console.error('❌ Error webhook inventory:', error.message);
    console.error(error.stack);
    return res.status(500).json({ error: error.message });
  }
});

// ========== JSON para el resto de rutas (MercadoLibre, etc.) ==========
app.use(express.json());

/**
 * Endpoint para recibir webhooks de MercadoLibre
 * Configura este endpoint en MercadoLibre: https://developers.mercadolibre.com.ar/es_ar/notificaciones
 * Topic: orders_v2
 * URL: https://tu-servidor.com/webhooks/mercadolibre/order
 */
app.post('/webhooks/mercadolibre/order', async (req, res) => {
  try {
    const { resource, topic, user_id } = req.body;

    // Validar que sea una notificación de órdenes
    if (topic !== 'orders_v2') {
      console.log(`⚠️  Topic no reconocido: ${topic}`);
      console.log(`   💡 Este webhook es de MercadoLibre, solo procesamos 'orders_v2'`);
      return res.status(200).json({ message: `Topic ${topic} no procesado` });
    }

    if (!resource) {
      console.log('⚠️  Notificación sin resource');
      return res.status(400).json({ error: 'resource es requerido' });
    }

    // Extraer order_id desde resource (formato: /orders/{order_id})
    const orderIdMatch = resource.match(/\/orders\/(\d+)/);
    if (!orderIdMatch) {
      console.log(`⚠️  No se pudo extraer order_id de resource: ${resource}`);
      return res.status(400).json({ error: 'order_id no encontrado en resource' });
    }

    const orderId = orderIdMatch[1];

    // ========== IDEMPOTENCIA ==========
    // Verificar si ya procesamos esta orden
    if (processedOrders.has(orderId)) {
      console.log(`⏭️  Orden ${orderId} ya procesada anteriormente, ignorando`);
      return res.status(200).json({ message: 'Orden ya procesada', order_id: orderId });
    }

    console.log(`\n🛒 Venta recibida en MercadoLibre: Order ID = ${orderId}`);
    console.log(`   Resource: ${resource}`);
    console.log(`   User ID: ${user_id}`);

    // Obtener la orden completa
    const orderResponse = await meli.client.get(`/orders/${orderId}`);
    const order = orderResponse.data;

    if (!order) {
      console.error(`❌ No se pudo obtener orden ${orderId}`);
      return res.status(500).json({ error: 'Error obteniendo orden' });
    }

    // ========== VALIDACIÓN DE ESTADOS ==========
    // Solo procesar órdenes en estados válidos
    const validStatuses = ['confirmed', 'payment_required', 'payment_in_process', 'paid'];
    if (!validStatuses.includes(order.status)) {
      console.log(`⏭️  Orden ${orderId} en estado "${order.status}", no procesada aún`);
      return res.status(200).json({ 
        message: 'Orden en estado no procesable', 
        order_id: orderId,
        status: order.status 
      });
    }

    console.log(`   Estado: ${order.status}`);
    console.log(`   Total: ${order.total_amount} ${order.currency_id}`);

    // ========== ACTIVAR PROTECCIÓN CONTRA LOOPS ==========
    isSyncingFromMeli = true;

    try {
      let itemsProcessed = 0;
      let itemsFailed = 0;
      const results = [];

      // Procesar cada item de la orden
      if (!order.order_items || order.order_items.length === 0) {
        console.log(`⚠️  Orden ${orderId} no tiene items`);
        return res.status(200).json({ message: 'Orden sin items', order_id: orderId });
      }

      console.log(`   Items en la orden: ${order.order_items.length}\n`);

      for (const orderItem of order.order_items) {
        const { item: { id: itemId }, quantity, variation_id } = orderItem;

        try {
          console.log(`   📦 Procesando item ${itemId} (variation: ${variation_id || 'N/A'}, cantidad: ${quantity})`);

          // Resolver SKU desde la variación o el item
          let sku = null;
          
          if (variation_id) {
            // Si tiene variación, obtener la variación específica
            const variationResponse = await meli.client.get(`/items/${itemId}/variations/${variation_id}`);
            const variation = variationResponse.data;
            sku = variation.seller_custom_field;
            
            if (!sku) {
              // Fallback: buscar en attribute_combinations
              const attrComb = variation.attribute_combinations?.find(
                a => a.id === 'SELLER_SKU' || a.name?.toLowerCase().includes('sku')
              );
              if (attrComb) {
                sku = attrComb.value_name;
              }
            }
          } else {
            // Si no tiene variación, obtener el item directamente
            const itemResponse = await meli.client.get(`/items/${itemId}`);
            const item = itemResponse.data;
            sku = item.seller_sku || item.seller_custom_field;
          }

          if (!sku || sku.trim() === '') {
            console.log(`      ⚠️  SKU no encontrado para item ${itemId}, variación ${variation_id || 'N/A'}`);
            itemsFailed++;
            results.push({ itemId, variationId: variation_id, sku: null, status: 'sku_not_found' });
            continue;
          }

          console.log(`      ✅ SKU resuelto: ${sku}`);

          // Descontar stock en Shopify
          const updated = await shopify.updateStockBySKU(sku, quantity);
          
          if (updated) {
            const currentStock = await shopify.getStockBySKU(sku);
            console.log(`      ✅ Stock actualizado en Shopify: ${sku} (cantidad descontada: ${quantity}, stock actual: ${currentStock})`);
            itemsProcessed++;
            results.push({ 
              itemId, 
              variationId: variation_id, 
              sku, 
              quantity, 
              status: 'success',
              stockAfter: currentStock
            });
          } else {
            console.log(`      ❌ Error actualizando stock para SKU ${sku}`);
            itemsFailed++;
            results.push({ itemId, variationId: variation_id, sku, quantity, status: 'update_failed' });
          }

        } catch (error) {
          console.error(`      ❌ Error procesando item ${itemId}:`, error.response?.data || error.message);
          itemsFailed++;
          results.push({ 
            itemId, 
            variationId: variation_id, 
            status: 'error', 
            error: error.message 
          });
        }
      }

      // ========== MARCAR ORDEN COMO PROCESADA ==========
      // SOLO marcar como procesada si TODOS los items se procesaron correctamente
      // Si hay items fallidos, NO marcar como procesada para poder reintentar
      if (itemsFailed === 0 && itemsProcessed === order.order_items.length) {
        markOrderAsProcessed(orderId);
        console.log(`\n✅ Orden ${orderId} procesada completamente (${itemsProcessed}/${order.order_items.length} items)`);
      } else {
        console.log(`\n⚠️  Orden ${orderId} procesada PARCIALMENTE:`);
        console.log(`   ✅ Items exitosos: ${itemsProcessed}`);
        console.log(`   ❌ Items fallidos: ${itemsFailed}`);
        console.log(`   📦 Total items: ${order.order_items.length}`);
        console.log(`   ⚠️  NO se marca como procesada para permitir reintento`);
        // NO marcar como procesada - permitirá reintento
      }

      // ========== RESUMEN ==========
      console.log(`\n📊 Resumen de procesamiento:`);
      console.log(`   ✅ Items procesados: ${itemsProcessed}`);
      console.log(`   ❌ Items con errores: ${itemsFailed}`);
      console.log(`   📦 Total items: ${order.order_items.length}`);

      // Retornar 200 incluso si hay errores parciales (para que MercadoLibre no reintente infinitamente)
      // Pero loguear claramente el estado
      return res.status(200).json({
        success: itemsFailed === 0,
        order_id: orderId,
        status: order.status,
        items_processed: itemsProcessed,
        items_failed: itemsFailed,
        total_items: order.order_items.length,
        fully_processed: itemsFailed === 0 && itemsProcessed === order.order_items.length,
        results
      });

    } finally {
      // ========== DESACTIVAR PROTECCIÓN CONTRA LOOPS ==========
      isSyncingFromMeli = false;
    }

  } catch (error) {
    // Asegurar que el flag se desactive incluso en caso de error
    isSyncingFromMeli = false;
    
    console.error('❌ Error procesando webhook de MercadoLibre:', error.response?.data || error.message);
    console.error('Stack:', error.stack);
    
    // Retornar 500 para que MercadoLibre reintente
    return res.status(500).json({ 
      error: error.message,
      retry: true 
    });
  }
});

/**
 * Endpoint de salud para verificar que el servidor está funcionando
 */
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    processed_orders_count: processedOrders.size,
    is_syncing_from_meli: isSyncingFromMeli
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

const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  console.log(`🚀 Servidor de webhooks iniciado en puerto ${PORT}`);
  console.log(`📡 Shopify orders/create: http://localhost:${PORT}/webhooks/shopify/orders/create`);
  console.log(`📡 Shopify inventory:      http://localhost:${PORT}/webhook/inventory`);
  console.log(`📡 MercadoLibre order:      http://localhost:${PORT}/webhooks/mercadolibre/order`);
  console.log(`💚 Health:                  http://localhost:${PORT}/health`);
  console.log(`🧪 Test sync:               http://localhost:${PORT}/test-sync?sku=B-M-CRU`);
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
