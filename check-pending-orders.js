import MercadoLibreAPI from './mercadolibre-api.js';
import ShopifyAPI from './shopify-api.js';
import dotenv from 'dotenv';
import { createIdempotencyStore } from './idempotency-store.js';
import { meliItemIdToSkus, resolveSkuFromOrderItem } from './meli-sku-mapping.js';

dotenv.config();

const MELI_USER_ID = process.env.MELI_USER_ID;

/**
 * Procesa una orden de MercadoLibre (misma lógica que el webhook)
 */
async function processOrder(orderId, shopify, meli, store) {
  try {
    console.log(`\n🛒 Procesando orden ${orderId}...`);

    const orderKey = `order:${orderId}`;
    if (store.has(orderKey)) {
      console.log(`   ⏭️  Orden ${orderId} ya procesada (idempotencia)`);
      return true;
    }

    // Obtener la orden completa
    const orderResponse = await meli.client.get(`/orders/${orderId}`);
    const order = orderResponse.data;

    if (!order) {
      console.error(`   ❌ No se pudo obtener orden ${orderId}`);
      return false;
    }

    // Solo procesar órdenes en estados válidos
    const validStatuses = ['confirmed', 'payment_required', 'payment_in_process', 'paid'];
    if (!validStatuses.includes(order.status)) {
      console.log(`   ⏭️  Orden ${orderId} en estado "${order.status}", no procesada aún`);
      return false;
    }

    console.log(`   Estado: ${order.status}`);
    console.log(`   Total: ${order.total_amount} ${order.currency_id}`);

    let itemsProcessed = 0;
    let itemsFailed = 0;

    if (!order.order_items || order.order_items.length === 0) {
      console.log(`   ⚠️  Orden ${orderId} no tiene items`);
      return false;
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
        console.log(`   📦 Procesando item ${itemId} (variation: ${variation_id ?? 'N/A'}, cantidad: ${quantity})`);

        const itemKey = `order:${orderId}:item:${itemId}:${variation_id || 'NA'}`;
        if (store.has(itemKey)) {
          console.log(`      ⏭️  Item ya procesado previamente: ${itemKey}`);
          itemsProcessed++;
          continue;
        }

        // Mismo resolver determinístico que el webhook (mapping en memoria)
        const { sku: resolvedSku, ambiguous } = resolveSkuFromOrderItem(itemId, variation_id);

        if (ambiguous) {
          const skusForItem = meliItemIdToSkus.get(itemId) || [];
          console.log(`      ❌ item_id=${itemId} con variation_id=null tiene ${skusForItem.length} SKUs en el mapping. No se puede determinar cuál descontar.`);
          itemsFailed++;
          continue;
        }

        const sku = resolvedSku && String(resolvedSku).trim() ? resolvedSku : null;
        if (!sku) {
          console.log(`      ⚠️  SKU no encontrado para item ${itemId}`);
          itemsFailed++;
          continue;
        }

        console.log(`      ✅ SKU resuelto: ${sku}`);

        // Descontar stock en Shopify
        const updated = await shopify.updateStockBySKU(sku, quantity);
        
        if (updated) {
          store.mark(itemKey);
          const currentStock = await shopify.getStockBySKU(sku);
          console.log(`      ✅ Stock actualizado en Shopify: ${sku} (cantidad descontada: ${quantity}, stock actual: ${currentStock})`);
          itemsProcessed++;
        } else {
          console.log(`      ❌ Error actualizando stock para SKU ${sku}`);
          itemsFailed++;
        }

      } catch (error) {
        console.error(`      ❌ Error procesando item ${itemId}:`, error.response?.data || error.message);
        itemsFailed++;
      }
    }

    // SOLO marcar orden como procesada si TODOS los items se procesaron correctamente
    const totalItems = order.order_items.length;
    if (itemsFailed === 0 && itemsProcessed === totalItems) {
      store.mark(orderKey);
      console.log(`\n✅ Orden ${orderId} procesada completamente (${itemsProcessed}/${totalItems} items)`);
      return true;
    } else {
      console.log(`\n⚠️  Orden ${orderId} procesada PARCIALMENTE:`);
      console.log(`   ✅ Items exitosos: ${itemsProcessed}`);
      console.log(`   ❌ Items fallidos: ${itemsFailed}`);
      console.log(`   📦 Total items: ${totalItems}`);
      console.log(`   ⚠️  NO se marca como procesada para permitir reintento`);
      // NO marcar como procesada - permitirá reintento en próxima ejecución
      return false;
    }
  } catch (error) {
    console.error(`❌ Error procesando orden ${orderId}:`, error.response?.data || error.message);
    return false;
  }
}

/**
 * Busca y procesa órdenes pendientes de MercadoLibre
 */
async function checkPendingOrders() {
  try {
    console.log('🔍 Buscando órdenes pendientes de MercadoLibre...\n');

    const meli = new MercadoLibreAPI();
    const shopify = new ShopifyAPI();
    const store = createIdempotencyStore('mercadolibre');

    console.log(`📋 Store idempotencia cargado (mercadolibre).`);

    // Buscar órdenes recientes del vendedor
    // La API de MercadoLibre permite buscar órdenes por seller
    console.log(`📅 Buscando órdenes recientes del vendedor...\n`);

    // Buscar órdenes del usuario con paginación para asegurar que obtenemos TODAS
    let allOrders = [];
    let offset = 0;
    const limit = 50;
    let hasMore = true;

    console.log(`📅 Buscando TODAS las órdenes recientes (con paginación)...\n`);

    while (hasMore) {
      const response = await meli.client.get(`/orders/search`, {
        params: {
          seller: MELI_USER_ID,
          sort: 'date_desc', // Ordenar por fecha descendente (más recientes primero)
          limit: limit,
          offset: offset
        }
      });

      const orders = response.data.results || [];
      allOrders.push(...orders);
      
      console.log(`   📦 Página ${Math.floor(offset / limit) + 1}: ${orders.length} órdenes encontradas`);

      // Si obtenemos menos órdenes que el límite, no hay más páginas
      if (orders.length < limit) {
        hasMore = false;
      } else {
        offset += limit;
        // Pequeño delay para no saturar la API
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    console.log(`\n📦 Total órdenes encontradas: ${allOrders.length}\n`);

    if (allOrders.length === 0) {
      console.log('✅ No hay órdenes pendientes\n');
      return;
    }

    // Solo procesar órdenes recientes (no tocar órdenes antiguas ya ajustadas a mano)
    const lastHours = parseInt(process.env.PENDING_ORDERS_LAST_HOURS || '24', 10);
    const cutoffMs = Date.now() - (lastHours * 60 * 60 * 1000);
    const ordersToProcess = allOrders.filter((o) => {
      const dateStr = o.date_created || o.date_last_updated || o.date_closed;
      const orderTime = dateStr ? new Date(dateStr).getTime() : 0;
      return orderTime > cutoffMs;
    });
    const skippedOld = allOrders.length - ordersToProcess.length;
    if (skippedOld > 0) {
      console.log(`⏭️  Ignorando ${skippedOld} órdenes anteriores a las últimas ${lastHours}h (PENDING_ORDERS_LAST_HOURS). Solo se procesan ${ordersToProcess.length} recientes.\n`);
    }

    const orders = ordersToProcess;

    let processedCount = 0;
    let skippedCount = 0;
    let partialCount = 0; // Órdenes procesadas parcialmente
    let errorCount = 0;

    for (const order of orders) {
      const orderIdStr = order.id != null ? String(order.id) : null;
      if (!orderIdStr) continue;

      if (store.has(`order:${orderIdStr}`)) {
        skippedCount++;
        continue;
      }

      const success = await processOrder(orderIdStr, shopify, meli, store);
      if (success) {
        processedCount++;
      } else {
        // Verificar si se procesó parcialmente (algunos items exitosos)
        // Si la función retorna false, puede ser porque falló completamente o parcialmente
        // Revisar logs para determinar
        partialCount++;
      }

      // Pequeño delay para no saturar la API
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log('\n' + '='.repeat(60));
    console.log('📊 RESUMEN DE ÓRDENES PENDIENTES');
    console.log('='.repeat(60));
    console.log(`   ✅ Procesadas completamente: ${processedCount}`);
    console.log(`   ⚠️  Procesadas parcialmente (requieren revisión): ${partialCount}`);
    console.log(`   ⏭️  Ya procesadas (saltadas): ${skippedCount}`);
    console.log(`   📦 Total revisadas: ${orders.length}`);
    
    if (partialCount > 0) {
      console.log(`\n⚠️  ATENCIÓN: ${partialCount} órdenes se procesaron parcialmente.`);
      console.log(`   Estas órdenes NO se marcaron como procesadas y se reintentarán en la próxima ejecución.`);
      console.log(`   Revisa los logs arriba para ver qué items fallaron.`);
    }
    
    console.log('');

  } catch (error) {
    console.error('❌ Error buscando órdenes pendientes:', error.response?.data || error.message);
    console.error('Stack:', error.stack);
  }
}

// Ejecutar si se llama directamente
if (import.meta.url === `file://${process.argv[1]}`) {
  checkPendingOrders();
}

export default checkPendingOrders;
