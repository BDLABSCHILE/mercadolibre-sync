import axios from 'axios';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolveSkuFromOrderItem } from './meli-sku-mapping.js';

dotenv.config();

const MELI_USER_ID = process.env.MELI_USER_ID;

if (!MELI_USER_ID) {
  throw new Error('MELI_USER_ID debe estar configurado en .env');
}

// Obtener el directorio actual para ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Archivo de persistencia para items refrescados (usa dir escribible en Docker :ro)
const REFRESHED_ITEMS_FILE = process.env.MELI_CACHE_DIR
  ? path.join(process.env.MELI_CACHE_DIR, '.meli-refreshed-items.json')
  : path.join(__dirname, '.meli-refreshed-items.json');

class MercadoLibreAPI {
  constructor() {
    this.appId = process.env.MELI_APP_ID;
    this.clientSecret = process.env.MELI_CLIENT_SECRET;
    this.refreshToken = process.env.MELI_REFRESH_TOKEN;
    
    // Access token en memoria (se obtiene/refresca automáticamente)
    this.accessToken = null;
    this.isRefreshing = false;
    this.refreshPromise = null;
    
    // Validar que tenemos lo necesario para refrescar tokens
    if (!this.refreshToken || !this.clientSecret || !this.appId) {
      throw new Error('MELI_REFRESH_TOKEN, MELI_CLIENT_SECRET y MELI_APP_ID deben estar configurados en .env');
    }

    this.baseURL = 'https://api.mercadolibre.com';
    this.client = axios.create({
      baseURL: this.baseURL,
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    // Cache in-memory de items refrescados (fallback si falla la persistencia)
    this.refreshedItemsCache = new Set();
    
    // Cargar items ya refrescados desde el archivo
    this.loadRefreshedItems();
    
    // Configurar interceptor para manejar 401 automáticamente
    this.setupInterceptors();
    
    // Inicializar token (opcional si hay MELI_ACCESS_TOKEN, sino se obtiene al primer uso)
    const initialToken = process.env.MELI_ACCESS_TOKEN;
    if (initialToken) {
      this.accessToken = initialToken;
      this.updateClientHeaders();
    }
  }

  /**
   * Configura interceptores de axios para refresh automático y retry en 401
   */
  setupInterceptors() {
    // Interceptor de request: asegurar que siempre hay token
    this.client.interceptors.request.use(
      async (config) => {
        // Si no hay token, obtenerlo/refrescarlo
        if (!this.accessToken) {
          await this.ensureValidToken();
        }
        
        // Actualizar header de autorización
        config.headers['Authorization'] = `Bearer ${this.accessToken}`;
        return config;
      },
      (error) => {
        return Promise.reject(error);
      }
    );

    // Interceptor de response: manejar 401 con retry automático
    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        const originalRequest = error.config;

        // Si es 401 y no es un retry, intentar refrescar y reintentar
        if (error.response?.status === 401 && !originalRequest._retry) {
          originalRequest._retry = true;

          try {
            // Forzar refresh del token (porque recibimos 401, el token está expirado)
            await this.refreshAccessToken();
            
            // Actualizar header y reintentar
            originalRequest.headers['Authorization'] = `Bearer ${this.accessToken}`;
            return this.client(originalRequest);
          } catch (refreshError) {
            // Si falla el refresh, devolver el error original
            console.error('❌ No se pudo refrescar el token después de 401:', refreshError.message);
            return Promise.reject(error);
          }
        }

        // 429 Too Many Requests: esperar y reintentar (máx 2 veces, backoff ~8s y ~20s)
        if (error.response?.status === 429 && originalRequest && (originalRequest._retry429Count || 0) < 2) {
          const count = (originalRequest._retry429Count || 0) + 1;
          originalRequest._retry429Count = count;
          const waitMs = count === 1 ? 8000 : 20000;
          console.warn(`⚠️  MercadoLibre 429 (rate limit). Esperando ${waitMs / 1000}s antes de reintento ${count}/2...`);
          await new Promise(r => setTimeout(r, waitMs));
          return this.client(originalRequest);
        }

        return Promise.reject(error);
      }
    );
  }

  /**
   * Actualiza los headers del cliente con el token actual
   */
  updateClientHeaders() {
    if (this.accessToken) {
      this.client.defaults.headers['Authorization'] = `Bearer ${this.accessToken}`;
    }
  }

  /**
   * Asegura que hay un token válido, refrescándolo si es necesario
   * Se usa en el interceptor de request para asegurar token antes de cada request
   */
  async ensureValidToken() {
    // Si ya hay un refresh en progreso, esperar a que termine
    if (this.isRefreshing) {
      return this.refreshPromise;
    }

    // Si no tenemos token, obtenerlo
    if (!this.accessToken) {
      this.isRefreshing = true;
      this.refreshPromise = this.refreshAccessToken();
      
      try {
        const token = await this.refreshPromise;
        return token;
      } finally {
        this.isRefreshing = false;
        this.refreshPromise = null;
      }
    }

    return this.accessToken;
  }

  /**
   * Carga la lista de items ya refrescados desde el archivo de persistencia
   */
  loadRefreshedItems() {
    try {
      if (fs.existsSync(REFRESHED_ITEMS_FILE)) {
        const data = fs.readFileSync(REFRESHED_ITEMS_FILE, 'utf8');
        const refreshedItems = JSON.parse(data);
        if (Array.isArray(refreshedItems)) {
          this.refreshedItemsCache = new Set(refreshedItems);
          console.log(`📋 Cargados ${this.refreshedItemsCache.size} items ya refrescados previamente`);
        }
      }
    } catch (error) {
      console.warn('⚠️  No se pudo cargar el archivo de items refrescados, usando cache en memoria:', error.message);
      this.refreshedItemsCache = new Set();
    }
  }

  /**
   * Guarda un item como refrescado en el archivo de persistencia
   */
  markItemAsRefreshed(itemId) {
    try {
      this.refreshedItemsCache.add(itemId);
      
      // Guardar en archivo
      const refreshedItems = Array.from(this.refreshedItemsCache);
      fs.writeFileSync(REFRESHED_ITEMS_FILE, JSON.stringify(refreshedItems, null, 2), 'utf8');
    } catch (error) {
      // Si falla la escritura, al menos mantenerlo en memoria
      console.warn(`⚠️  No se pudo guardar item ${itemId} como refrescado:`, error.message);
    }
  }

  /**
   * Verifica si un item ya fue refrescado
   */
  isItemRefreshed(itemId) {
    return this.refreshedItemsCache.has(itemId);
  }

  /**
   * Refresca un item completo si es necesario (one-time por item)
   * @param {string} itemId - ID del item
   * @param {object} item - Datos del item actual
   * @returns {Promise<object>} Item refrescado o el original si no necesita refresh
   */
  async refreshItemIfNeeded(itemId, item) {
    // Si ya fue refrescado, no hacer nada
    if (this.isItemRefreshed(itemId)) {
      return item;
    }

    // Verificar si necesita refresh (tiene variaciones sin seller_custom_field)
    const needsRefresh = item.variations && item.variations.length > 0 && 
                         item.variations.some(v => v.seller_custom_field === null);

    if (!needsRefresh) {
      // No necesita refresh, marcarlo como procesado para no volver a verificar
      this.markItemAsRefreshed(itemId);
      return item;
    }

    // Necesita refresh - hacerlo una sola vez
    console.log(`🔄 Refrescando item ${itemId} por primera vez (${item.variations.filter(v => v.seller_custom_field === null).length} variaciones sin SKU)...`);
    
    try {
      // Refrescar solo las variaciones que tienen seller_custom_field === null
      const nullVariations = item.variations.filter(v => v.seller_custom_field === null);
      
      for (let i = 0; i < nullVariations.length; i++) {
        const variation = nullVariations[i];
        try {
          // PUT mínimo válido (solo precio) para forzar que la API devuelva seller_custom_field
          await this.client.put(`/items/${itemId}/variations/${variation.id}`, {
            price: variation.price
          });
          
          // Pequeño delay para evitar rate limiting (excepto en la última)
          if (i < nullVariations.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        } catch (error) {
          // Si falla una variación, continuar con las demás
          // El interceptor maneja automáticamente los 401 con retry
          console.warn(`    ⚠️  Error refrescando variación ${variation.id}:`, error.message);
        }
      }

      // Pequeño delay para dar tiempo a la API de MercadoLibre a actualizar
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Leer el item completo de nuevo para obtener todos los SKUs actualizados
      const refreshedResponse = await this.client.get(`/items/${itemId}`);
      const refreshedItem = refreshedResponse.data;
      
      // Contar cuántos SKUs aparecieron después del refresh
      const skusAfterRefresh = refreshedItem.variations.filter(
        v => v.seller_custom_field && v.seller_custom_field.trim() !== ''
      ).length;
      
      console.log(`  ✅ Item ${itemId} refrescado - ${skusAfterRefresh} SKUs ahora disponibles`);
      
      // Marcar como refrescado para nunca volver a hacerlo
      this.markItemAsRefreshed(itemId);
      
      return refreshedItem;
    } catch (error) {
      // Si falla el refresh, marcar igual para no intentar infinitamente
      console.warn(`  ⚠️  Error refrescando item ${itemId}, marcando como procesado:`, error.message);
      this.markItemAsRefreshed(itemId);
      return item; // Devolver el item original
    }
  }

  /**
   * Refresca el token de acceso usando refresh_token
   * Maneja múltiples llamadas concurrentes para evitar refreshes duplicados
   */
  async refreshAccessToken() {
    if (!this.refreshToken || !this.clientSecret || !this.appId) {
      throw new Error('No se puede refrescar el token: faltan REFRESH_TOKEN, CLIENT_SECRET o APP_ID');
    }

    // Si ya hay un refresh en progreso, esperar a que termine
    if (this.isRefreshing && this.refreshPromise) {
      return this.refreshPromise;
    }

    // Iniciar refresh
    this.isRefreshing = true;
    this.refreshPromise = (async () => {
      try {
        console.log('🔄 Refrescando access token de MercadoLibre...');
        
        const response = await axios.post('https://api.mercadolibre.com/oauth/token', {
          grant_type: 'refresh_token',
          client_id: this.appId,
          client_secret: this.clientSecret,
          refresh_token: this.refreshToken,
        });

        this.accessToken = response.data.access_token;
        
        // Actualizar refresh_token si viene uno nuevo
        if (response.data.refresh_token) {
          this.refreshToken = response.data.refresh_token;
        }

        // Actualizar headers del cliente
        this.updateClientHeaders();
        
        console.log('✅ Token de acceso refrescado exitosamente');
        return this.accessToken;
      } catch (error) {
        console.error('❌ Error refrescando token:', error.response?.data || error.message);
        throw error;
      } finally {
        this.isRefreshing = false;
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  /**
   * Obtiene órdenes/ventas del vendedor
   * @param {Object} options - Opciones de filtrado
   * @param {string} options.createdFrom - Fecha desde (ISO 8601)
   * @param {string} options.createdTo - Fecha hasta (ISO 8601)
   * @param {number} options.limit - Límite por página (default 50)
   * @returns {Promise<Array<{id: string, total: number, created_at: string, status: string}>>}
   */
  async getOrders(options = {}) {
    try {
      // Usar /orders/search (API clásica). Límite máx 50 por request.
      const limit = Math.min(options.limit || 50, 50);
      const params = {
        seller: MELI_USER_ID,
        limit,
      };
      if (options.createdFrom) params['order.date_created.from'] = options.createdFrom;
      if (options.createdTo) params['order.date_created.to'] = options.createdTo;

      const allResults = [];
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        params.offset = offset;
        const response = await this.client.get('/orders/search', { params });
        if (process.env.DEBUG_ML === '1' && response?.data?.results?.length > 0 && offset === 0) {
          console.log('[DEBUG RAW ML ORDER SAMPLE]');
          const sample = response.data.results.slice(0, 5);
          for (const o of sample) {
            console.log({
              id: o.id,
              pack_id: o.pack_id,
              order_items_count: o.order_items?.length,
              total_paid_amount: o.total_paid_amount,
            });
          }
        }
        const results = response.data.results || [];
        allResults.push(...results);
        const total = response.data.paging?.total ?? results.length;
        hasMore = results.length === limit && offset + results.length < total;
        offset += results.length;
      }

      if (process.env.DEBUG_ML === '1') {
        const targetOrder =
          allResults.find((o) => o.id == 2000011558256539) ||
          allResults.find((o) => o.pack_id == 2000011558256539);
        if (targetOrder) {
          console.log(JSON.stringify(targetOrder, null, 2));
          process.exit(0);
        }
      }

      const results = allResults;
      const groupMap = new Map();
      const shipmentCache = new Map();
      const shipmentCostAddedPerGroup = new Map();
      const paymentCache = new Map();

      await this.ensureValidToken();

      for (const order of results) {
        const groupKey = order.pack_id || order.id;

        // Resolver SKU por item (para fact_order_items) y del primer item (para fact_orders.sku legacy)
        let sku = null;
        const itemsMap = new Map(); // sku -> { quantity, line_total }
        if (order.order_items?.length) {
          for (const oi of order.order_items) {
            const item = oi?.item;
            const variationId = oi?.variation_id ?? item?.variation_id ?? null;
            const itemId = item?.id ?? null;
            let itemSku = null;
            const resolved = resolveSkuFromOrderItem(itemId ? String(itemId) : null, variationId);
            if (resolved.ambiguous) continue; // item con múltiples SKUs sin variation_id: omitir
            if (resolved.sku) itemSku = resolved.sku;
            else itemSku = item?.seller_custom_field || item?.sku || oi?.seller_custom_field || oi?.seller_sku || null;
            if (!itemSku || String(itemSku).trim() === '') continue;
            const qty = parseInt(oi.quantity || 1, 10) || 1;
            const unitPrice = parseFloat(oi.unit_price || 0);
            const lineTotal = unitPrice * qty;
            const existing = itemsMap.get(itemSku);
            if (existing) {
              existing.quantity += qty;
              existing.line_total += lineTotal;
              existing.unit_price = existing.quantity > 0 ? existing.line_total / existing.quantity : existing.unit_price;
            } else {
              itemsMap.set(itemSku, { quantity: qty, unit_price: unitPrice, line_total: lineTotal });
            }
          }
          // SKU del primer item (compatibilidad con fact_orders.sku)
          const firstOi = order.order_items[0];
          const firstItem = firstOi?.item;
          sku = firstItem?.seller_custom_field || firstItem?.sku || firstOi?.seller_custom_field || firstOi?.seller_sku || firstItem?.id || null;
          if (!sku && itemsMap.size > 0) sku = itemsMap.keys().next().value;
        }
        if (process.env.DEBUG_ML_SKU === '1') {
          console.log('[ML SKU]', order.id, sku, 'items:', [...itemsMap.entries()]);
        }

        const total = parseFloat(order.paid_amount ?? order.total_amount ?? 0) ||
          (order.payments?.reduce((sum, p) => sum + parseFloat(p.transaction_amount || p.total_paid_amount || 0), 0) ?? 0);

        let totalProducto = 0;
        if (order.order_items?.length) {
          for (const it of order.order_items) {
            const qty = parseInt(it.quantity || 1, 10) || 1;
            totalProducto += parseFloat(it.unit_price || 0) * qty;
          }
        }

        let totalPaidAmount = 0;
        let netReceivedAmount = 0;
        let commissionTotal = 0;
        let commissionSale = 0;
        let commissionShipping = 0;
        let commissionFinancing = 0;
        let couponAmount = 0;
        let shippingIncome = 0;
        let shippingCost = 0;
        if (order.payments?.length) {
          for (const p of order.payments) {
            couponAmount += parseFloat(p.coupon_amount || 0);
            if (p.operation_type === 'payment_addition') {
              shippingIncome += parseFloat(p.total_paid_amount || 0);
            } else {
              shippingIncome += parseFloat(p.shipping_amount || 0);
            }

            const paymentId = p.id;
            if (paymentId != null) {
              let cached = paymentCache.get(paymentId);
              if (!cached) {
                try {
                  const mpRes = await axios.get(
                    `https://api.mercadopago.com/v1/payments/${paymentId}`,
                    {
                      headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${this.accessToken}`,
                      },
                    }
                  );
                  const mpPayment = mpRes?.data;
                  const td = mpPayment?.transaction_details || {};
                  const totalPaid = parseFloat(td.total_paid_amount || 0);
                  const netReceived = parseFloat(td.net_received_amount || 0);
                  const feeTotal = totalPaid - netReceived;

                  let sale = 0;
                  let ship = 0;
                  let fin = 0;
                  if (Array.isArray(mpPayment?.fee_details)) {
                    for (const fee of mpPayment.fee_details) {
                      const amt = parseFloat(fee.amount || 0);
                      const type = String(fee.type || '').toLowerCase();
                      const desc = String(fee.description || '').toLowerCase();
                      if (type.includes('shipping') || desc.includes('env')) {
                        ship += amt;
                      } else if (type.includes('financing') || type.includes('installment') || desc.includes('financ')) {
                        fin += amt;
                      } else {
                        sale += amt;
                      }
                    }
                    const sumBreakdown = sale + ship + fin;
                    if (Math.abs(sumBreakdown - feeTotal) > 0.01) {
                      sale += feeTotal - sumBreakdown;
                    }
                  } else {
                    sale = feeTotal;
                  }
                  cached = {
                    totalPaid,
                    netReceived,
                    commissionTotal: feeTotal,
                    commissionSale: sale,
                    commissionShipping: ship,
                    commissionFinancing: fin,
                  };
                  paymentCache.set(paymentId, cached);
                } catch (err) {
                  cached = {
                    totalPaid: parseFloat(p.total_paid_amount || 0),
                    netReceived: parseFloat(p.total_paid_amount || 0),
                    commissionTotal: 0,
                    commissionSale: 0,
                    commissionShipping: 0,
                    commissionFinancing: 0,
                  };
                  paymentCache.set(paymentId, cached);
                }
              }
              totalPaidAmount += cached.totalPaid;
              netReceivedAmount += cached.netReceived;
              commissionTotal += cached.commissionTotal;
              commissionSale += cached.commissionSale;
              commissionShipping += cached.commissionShipping;
              commissionFinancing += cached.commissionFinancing;
            } else {
              const fallback = parseFloat(p.total_paid_amount || 0);
              totalPaidAmount += fallback;
              netReceivedAmount += fallback;
            }
          }
        }
        if (shippingIncome === 0 && totalPaidAmount > totalProducto) {
          shippingIncome = totalPaidAmount - totalProducto;
        }
        shippingIncome = Math.max(0, shippingIncome);

        if (order.shipping?.id != null) {
          const shipId = order.shipping.id;
          let sellerCost = 0;
          if (shipmentCache.has(shipId)) {
            sellerCost = shipmentCache.get(shipId);
          } else {
            try {
              const costsRes = await this.client.get(`/shipments/${shipId}/costs`);
              sellerCost = parseFloat(costsRes?.data?.senders?.[0]?.cost) || 0;
              if (sellerCost === 0) {
                const shipRes = await this.client.get(`/shipments/${shipId}`);
                const shipment = shipRes?.data;
                sellerCost = parseFloat(shipment?.cost_components?.ratio) || 0;
              }
              shipmentCache.set(shipId, sellerCost);
            } catch (err) {
              shipmentCache.set(shipId, 0);
            }
          }
          if (!shipmentCostAddedPerGroup.has(groupKey)) {
            shipmentCostAddedPerGroup.set(groupKey, new Set());
          }
          if (!shipmentCostAddedPerGroup.get(groupKey).has(shipId)) {
            shippingCost += sellerCost;
            shipmentCostAddedPerGroup.get(groupKey).add(shipId);
          }
        }

        if (totalPaidAmount === 0) totalPaidAmount = total;

        const grossSales = totalProducto;

        if (groupMap.has(groupKey)) {
          const agg = groupMap.get(groupKey);
          if (agg.sku == null && sku != null) agg.sku = sku;
          agg.total += total;
          agg.total_paid_amount += totalPaidAmount;
          agg.net_received_amount += netReceivedAmount;
          agg.commission_total += commissionTotal;
          agg.commission_sale += commissionSale;
          agg.commission_shipping += commissionShipping;
          agg.commission_financing += commissionFinancing;
          agg.shipping_income += shippingIncome;
          agg.shipping_cost += shippingCost;
          agg.coupon_amount += couponAmount;
          agg.gross_sales += grossSales;
          for (const [itemSku, data] of itemsMap) {
            const existing = agg.itemsMap.get(itemSku);
            if (existing) {
              existing.quantity += data.quantity;
              existing.line_total += data.line_total;
              existing.unit_price = existing.quantity > 0 ? existing.line_total / existing.quantity : existing.unit_price;
            } else {
              agg.itemsMap.set(itemSku, { quantity: data.quantity, unit_price: data.unit_price, line_total: data.line_total });
            }
          }
          const orderDate = order.date_created || order.date_closed || order.date_last_updated;
          if (orderDate && (!agg.created_at || orderDate < agg.created_at)) {
            agg.created_at = orderDate;
          }
        } else {
          groupMap.set(groupKey, {
            total,
            currency: order.currency_id || 'CLP',
            created_at: order.date_created || order.date_closed || order.date_last_updated,
            status: order.status || 'unknown',
            total_paid_amount: totalPaidAmount,
            net_received_amount: netReceivedAmount,
            commission_total: commissionTotal,
            commission_sale: commissionSale,
            commission_shipping: commissionShipping,
            commission_financing: commissionFinancing,
            gross_sales: grossSales,
            shipping_income: shippingIncome,
            shipping_cost: shippingCost,
            coupon_amount: couponAmount,
            sku,
            itemsMap: new Map(itemsMap),
          });
        }
      }

      const orders = [];
      for (const [groupKey, agg] of groupMap) {
        const totalPaid = agg.total_paid_amount ?? 0;
        const netReceived = agg.net_received_amount ?? 0;
        const commissionTotal = agg.commission_total ?? 0;
        const commissionSale = agg.commission_sale ?? 0;
        const commissionShipping = agg.commission_shipping ?? 0;
        const commissionFinancing = agg.commission_financing ?? 0;
        const shippingCost = agg.shipping_cost ?? 0;
        const netRevenue = Math.max(0, netReceived - shippingCost);

        if (process.env.DEBUG_ML_FINANCE === '1') {
          const cuadra = Math.abs(commissionTotal - (totalPaid - netReceived)) < 0.02;
          console.log({
            order_id: String(groupKey),
            total_paid_amount: totalPaid,
            net_received_amount: netReceived,
            commission_total: commissionTotal,
            commission_sale: commissionSale,
            commission_shipping: commissionShipping,
            commission_financing: commissionFinancing,
            shipping_cost: shippingCost,
            net_revenue: netRevenue,
          });
          if (!cuadra) {
            console.error(`[DEBUG_ML_FINANCE] ❌ No cuadra: commission_total (${commissionTotal}) !== total_paid - net_received (${totalPaid - netReceived})`);
          }
        }

        const orderItems = [];
        const aggItemsMap = agg.itemsMap || new Map();
        for (const [itemSku, data] of aggItemsMap) {
          orderItems.push({
            sku: itemSku,
            quantity: data.quantity,
            unit_price: data.unit_price ?? (data.line_total / data.quantity),
            line_total: data.line_total,
          });
        }

        orders.push({
          id: String(groupKey),
          total: agg.total,
          currency: agg.currency,
          created_at: agg.created_at,
          status: agg.status,
          gross_sales: agg.gross_sales ?? 0,
          total_paid_amount: totalPaid,
          net_received_amount: netReceived,
          commission_total: commissionTotal,
          commission_sale: commissionSale,
          commission_shipping: commissionShipping,
          commission_financing: commissionFinancing,
          shipping_income: agg.shipping_income ?? 0,
          shipping_cost: shippingCost,
          coupon_amount: agg.coupon_amount ?? 0,
          net_revenue: netRevenue,
          advertising_cost: 0,
          tax_retention: 0,
          sku: agg.sku ?? null,
          order_items: orderItems,
        });
      }

      return orders;
    } catch (error) {
      console.error('Error obteniendo órdenes de MercadoLibre:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Obtiene métricas de publicidad por producto desde Product Ads API.
   * Requiere permisos de publicidad. Retorna cost, clicks, impressions, cpc por item_id.
   * @param {string} dateFrom - YYYY-MM-DD
   * @param {string} dateTo - YYYY-MM-DD (máx 90 días)
   * @returns {Promise<Array<{item_id: string, cost: number, clicks: number, impressions: number, cpc: number}>>}
   */
  async getAdvertisingItemsMetrics(dateFrom, dateTo) {
    try {
      const advRes = await this.client.get('/advertising/advertisers', {
        params: { product_id: 'PADS' },
        headers: { 'api-version': '2' },
      });
      const advertisers = advRes.data?.advertisers || [];
      const mlc = advertisers.find((a) => a.site_id === 'MLC') || advertisers[0];
      if (!mlc?.advertiser_id) return [];
      const advId = mlc.advertiser_id;
      const results = [];
      let offset = 0;
      const limit = 100;
      const metrics = 'clicks,prints,cost,cpc,direct_amount,indirect_amount,total_amount,direct_items_quantity,indirect_items_quantity,advertising_items_quantity,acos,roas';
      for (;;) {
        const itemsRes = await this.client.get(
          `/advertising/advertisers/${advId}/product_ads/items`,
          {
            params: {
              limit,
              offset,
              date_from: dateFrom,
              date_to: dateTo,
              metrics,
              'filters[statuses]': 'active,paused,idle',
            },
            headers: { 'api-version': '2' },
          }
        );
        const items = itemsRes.data?.results || [];
        for (const it of items) {
          const m = it.metrics || {};
          results.push({
            item_id: String(it.item_id || ''),
            cost: parseFloat(m.cost || 0) || 0,
            clicks: parseInt(m.clicks || 0, 10) || 0,
            impressions: parseInt(m.prints || 0, 10) || 0,
            cpc: parseFloat(m.cpc || 0) || 0,
            direct_amount: parseFloat(m.direct_amount || 0) || 0,
            indirect_amount: parseFloat(m.indirect_amount || 0) || 0,
            total_amount: parseFloat(m.total_amount || 0) || 0,
            direct_items_quantity: parseInt(m.direct_items_quantity || 0, 10) || 0,
            indirect_items_quantity: parseInt(m.indirect_items_quantity || 0, 10) || 0,
            advertising_items_quantity: parseInt(m.advertising_items_quantity || 0, 10) || 0,
            acos: m.acos != null ? parseFloat(m.acos) : null,
            roas: m.roas != null ? parseFloat(m.roas) : null,
          });
        }
        if (items.length < limit) break;
        offset += limit;
        if (offset >= (itemsRes.data?.paging?.total || 0)) break;
      }
      return results;
    } catch (error) {
      if (process.env.DEBUG_ML_ADS === '1') {
        console.warn('[ML Ads Items] Error:', error.response?.data || error.message);
      }
      return [];
    }
  }

  /**
   * Obtiene el gasto diario en publicidad desde la API de campaigns (Product Ads).
   * Coincide con la "Inversión" del dashboard de ML (cuando se genera el gasto).
   * @param {string} dateFrom - YYYY-MM-DD
   * @param {string} dateTo - YYYY-MM-DD (máx 90 días)
   * @returns {Promise<Array<{date: string, cost: number}>>}
   */
  async getAdvertisingCampaignsDaily(dateFrom, dateTo) {
    try {
      const advRes = await this.client.get('/advertising/advertisers', {
        params: { product_id: 'PADS' },
        headers: { 'api-version': '2' },
      });
      const advertisers = advRes.data?.advertisers || [];
      const mlc = advertisers.find((a) => a.site_id === 'MLC') || advertisers[0];
      if (!mlc?.advertiser_id) return [];
      const advId = mlc.advertiser_id;
      const byDate = {};
      let offset = 0;
      const limit = 100;
      for (;;) {
        const res = await this.client.get(
          `/advertising/advertisers/${advId}/product_ads/campaigns`,
          {
            params: {
              limit,
              offset,
              date_from: dateFrom,
              date_to: dateTo,
              metrics: 'cost',
              aggregation_type: 'DAILY',
            },
            headers: { 'api-version': '2' },
          }
        );
        const items = res.data?.results || [];
        for (const it of items) {
          const d = it.date;
          const cost = parseFloat(it.cost || 0) || 0;
          if (d) byDate[d] = (byDate[d] || 0) + cost;
        }
        if (items.length < limit) break;
        offset += limit;
        if (offset >= (res.data?.paging?.total || 0)) break;
      }
      return Object.entries(byDate).map(([date, cost]) => ({ date, cost }));
    } catch (error) {
      if (process.env.DEBUG_ML_ADS === '1') {
        console.warn('[ML Ads Campaigns] Error:', error.response?.data || error.message);
      }
      return [];
    }
  }

  /**
   * Obtiene el gasto en publicidad (Product Ads) desde la API de facturación.
   * Usa /billing/integration/monthly/periods y /summary/details para extraer cargos tipo PADS.
   * @param {number} limitPeriods - Cantidad de períodos a consultar (default 6)
   * @returns {Promise<Array<{period_date: string, amount: number}>>}
   */
  async getAdvertisingSpend(limitPeriods = 6) {
    try {
      const periodsRes = await this.client.get('/billing/integration/monthly/periods', {
        params: { group: 'ML', document_type: 'BILL', limit: limitPeriods },
      });
      const periods = periodsRes.data?.results || [];
      const results = [];
      for (const p of periods) {
        const key = p.period?.key || p.key;
        if (!key) continue;
        try {
          const summaryRes = await this.client.get(
            `/billing/integration/periods/key/${key}/summary/details`,
            { params: { group: 'ML', document_type: 'BILL' } }
          );
          const charges = summaryRes.data?.bill_includes?.charges || [];
          const pads = charges.find((c) => c.type === 'PADS' || (c.label && c.label.toLowerCase().includes('advertising')));
          const amount = pads ? parseFloat(pads.amount || 0) : 0;
          results.push({ period_date: key, amount });
        } catch (err) {
          if (process.env.DEBUG_ML_ADS === '1') {
            console.warn(`[ML Ads] No se pudo obtener detalle para período ${key}:`, err.response?.data?.message || err.message);
          }
        }
      }
      return results;
    } catch (error) {
      console.error('[ML Ads] Error obteniendo gasto en publicidad:', error.response?.data || error.message);
      return [];
    }
  }

  /**
   * Obtiene título y thumbnail de un item (para paneles de publicidad).
   * @param {string} itemId - ID del item (ej. MLC3539466112)
   * @returns {Promise<{title: string, thumbnail_url: string}|null>}
   */
  async getItemDetails(itemId) {
    try {
      const res = await this.client.get(`/items/${itemId}`);
      const item = res.data;
      const title = item.title || '';
      let thumbnail = item.thumbnail || '';
      if (!thumbnail && item.pictures?.length > 0) {
        const pic = item.pictures[0];
        thumbnail = pic.secure_url || pic.url || '';
        if (thumbnail && /-F\.(jpg|webp|png)$/i.test(thumbnail)) {
          thumbnail = thumbnail.replace(/-F\.(jpg|webp|png)$/i, '-O.$1');
        }
      }
      return { title, thumbnail_url: thumbnail || null };
    } catch (err) {
      if (process.env.DEBUG_ML_ADS === '1') {
        console.warn(`[ML Item] No se pudo obtener detalle de ${itemId}:`, err.response?.data?.message || err.message);
      }
      return null;
    }
  }

  /**
   * Busca un item en MercadoLibre por SKU
   * @param {string} sku - SKU del producto
   * @param {boolean} debug - Si es true, muestra logs de debug
   * @returns {Promise<{itemId: string, variationId: number}|null>} Objeto con itemId y variationId o null si no se encuentra
   */
  async findItemBySKU(sku, debug = false) {
    try {
      if (!sku || sku.trim() === '') {
        return null;
      }

      // Buscar items del usuario por SKU
      const response = await this.client.get(`/users/${MELI_USER_ID}/items/search`, {
        params: {
          status: 'active',
          limit: 50,
        },
      });

      const itemIds = response.data.results || [];
      
      if (debug) {
        console.log(`\n🔍 Buscando SKU: "${sku}" en ${itemIds.length} items`);
      }
      
      // Buscar el item con el SKU específico en variaciones
      for (const itemId of itemIds) {
        try {
          const itemResponse = await this.client.get(`/items/${itemId}`);
          let item = itemResponse.data;
          
          // Refrescar el item si es necesario (one-time, automático)
          item = await this.refreshItemIfNeeded(itemId, item);
          
          // Buscar SKU en variaciones - probar múltiples campos posibles
          if (item.variations && item.variations.length > 0) {
            if (debug) {
              console.log(`  📦 Item ${itemId}: ${item.title} - ${item.variations.length} variaciones`);
            }
            
            for (const variation of item.variations) {
              // Buscar en múltiples campos donde puede estar el SKU
              let variationSKU = variation.seller_custom_field || 
                                 variation.sku || 
                                 variation.seller_sku;
              
              // Si no está en los campos directos, buscar en attribute_combinations
              if (!variationSKU && variation.attribute_combinations) {
                // Buscar en attribute_combinations por ID o nombre que contenga SKU
                const skuAttr = variation.attribute_combinations.find(attr => 
                  attr.id === 'SELLER_SKU' || 
                  attr.id === 'SKU' ||
                  attr.name?.toLowerCase().includes('sku') ||
                  attr.value_name?.toLowerCase().includes('sku')
                );
                if (skuAttr) {
                  variationSKU = skuAttr.value_name || skuAttr.value_id;
                }
              }
              
              // También buscar en attributes si existe
              if (!variationSKU && variation.attributes) {
                const skuAttr = variation.attributes.find(attr => 
                  attr.id === 'SELLER_SKU' || 
                  attr.id === 'SKU' ||
                  attr.name?.toLowerCase().includes('sku')
                );
                if (skuAttr) {
                  variationSKU = skuAttr.value_name || skuAttr.value_id;
                }
              }
              
              if (debug) {
                console.log(`    🔎 Variación ${variation.id}:`);
                console.log(`       seller_custom_field: "${variation.seller_custom_field || 'NO'}"`);
                console.log(`       sku: "${variation.sku || 'NO'}"`);
                console.log(`       seller_sku: "${variation.seller_sku || 'NO'}"`);
                console.log(`       user_product_id: "${variation.user_product_id || 'NO'}"`);
                if (variation.attribute_combinations) {
                  console.log(`       attribute_combinations:`, variation.attribute_combinations.map(a => ({
                    id: a.id,
                    name: a.name,
                    value_name: a.value_name,
                    value_id: a.value_id
                  })));
                }
                if (variationSKU) {
                  console.log(`       ✅ SKU encontrado: "${variationSKU}"`);
                } else {
                  console.log(`       ❌ SKU NO encontrado en esta variación`);
                }
              }
              
              // Comparar SKU (case-insensitive y sin espacios)
              const normalizedVariationSKU = variationSKU ? variationSKU.toString().trim().toUpperCase() : '';
              const normalizedSearchSKU = sku.trim().toUpperCase();
              
              if (normalizedVariationSKU === normalizedSearchSKU) {
                if (debug) {
                  console.log(`    ✅✅✅ MATCH encontrado! Item: ${itemId}, Variación: ${variation.id}`);
                }
                return {
                  itemId,
                  variationId: variation.id
                };
              }
            }
          }
          
          // Fallback: verificar si el SKU está en el item principal (por compatibilidad)
          const itemSKU = item.seller_sku || item.sku;
          if (itemSKU) {
            const normalizedItemSKU = itemSKU.toString().trim().toUpperCase();
            const normalizedSearchSKU = sku.trim().toUpperCase();
            if (normalizedItemSKU === normalizedSearchSKU) {
              if (debug) {
                console.log(`    ✅ MATCH encontrado en item principal! Item: ${itemId}`);
              }
              // Si no tiene variaciones, devolvemos solo itemId (variationId será null)
              return {
                itemId,
                variationId: null
              };
            }
          }
        } catch (error) {
          // Continuar con el siguiente item si hay error
          if (debug) {
            console.log(`    ❌ Error procesando item ${itemId}:`, error.message);
          }
          continue;
        }
      }

      if (debug) {
        console.log(`  ⚠️  SKU "${sku}" no encontrado en ningún item`);
      }
      return null;
    } catch (error) {
      // El interceptor maneja automáticamente los 401 con retry
      console.error(`Error buscando item por SKU ${sku}:`, error.response?.data || error.message);
      return null;
    }
  }

  /**
   * Actualiza el stock de un item en MercadoLibre
   * @param {string} itemId - ID del item en MercadoLibre
   * @param {number} quantity - Nueva cantidad en stock
   * @param {number|null} variationId - ID de la variación (si tiene variaciones)
   * @returns {Promise<boolean>} true si se actualizó correctamente
   */
  async updateStock(itemId, quantity, variationId = null) {
    try {
      // Asegurar que la cantidad sea un número entero y no negativo
      const stock = Math.max(0, Math.floor(quantity));

      // Si tiene variación, actualizar la variación específica
      if (variationId !== null) {
        const response = await this.client.put(`/items/${itemId}/variations/${variationId}`, {
          available_quantity: stock,
        });
        return response.status === 200;
      } else {
        // Si no tiene variaciones, actualizar el item directamente
        const response = await this.client.put(`/items/${itemId}`, {
          available_quantity: stock,
        });
        return response.status === 200;
      }
    } catch (error) {
      // El interceptor maneja automáticamente los 401 con retry
      console.error(`Error actualizando stock para item ${itemId}:`, error.response?.data || error.message);
      return false;
    }
  }

  /**
   * Actualiza el precio de un item SIN variations.
   * @param {string} itemId
   * @param {number} price
   * @returns {Promise<boolean>}
   */
  async updateItemPrice(itemId, price) {
    try {
      const p = Number(price);
      if (!Number.isFinite(p) || p <= 0) {
        console.error(`updateItemPrice: precio inválido para ${itemId}: ${price}`);
        return false;
      }
      const response = await this.client.put(`/items/${itemId}`, { price: p });
      return response.status === 200;
    } catch (error) {
      console.error(`Error actualizando precio item ${itemId}:`, error.response?.data || error.message);
      return false;
    }
  }

  /**
   * Actualiza precios de TODAS las variations de un item en una sola llamada.
   * Requerido porque ML rechaza PUT individual a /items/{id}/variations/{varId}
   * cuando los precios entre variations hermanas difieren ("item.variations.price.different").
   *
   * @param {string} itemId
   * @param {Array<{id: number|string, price: number}>} variations
   * @returns {Promise<boolean>}
   */
  async updateItemVariationsPrices(itemId, variations) {
    try {
      if (!Array.isArray(variations) || variations.length === 0) {
        console.error(`updateItemVariationsPrices: variations vacío para ${itemId}`);
        return false;
      }
      const cleaned = [];
      for (const v of variations) {
        const id = v.id != null ? Number(v.id) : null;
        const p = Number(v.price);
        if (!id || !Number.isFinite(p) || p <= 0) {
          console.error(`updateItemVariationsPrices: variation inválida en ${itemId}:`, v);
          return false;
        }
        cleaned.push({ id, price: p });
      }
      const response = await this.client.put(`/items/${itemId}`, { variations: cleaned });
      return response.status === 200;
    } catch (error) {
      console.error(`Error actualizando variations de item ${itemId}:`, error.response?.data || error.message);
      return false;
    }
  }

  /**
   * @deprecated Usar updateItemPrice o updateItemVariationsPrices. Se mantiene
   * por compat con código que ya lo llamaba — internamente delega al endpoint
   * batch para evitar el error item.variations.price.different.
   *
   * NOTA: si pasas variationId, este método solo va a actualizar UNA variation,
   * lo cual va a fallar en ML si las hermanas tienen precios distintos. El
   * caller debería migrar a updateItemVariationsPrices con todas las variations.
   */
  async updatePrice(itemId, price, variationId = null) {
    const p = Number(price);
    if (!Number.isFinite(p) || p <= 0) {
      console.error(`updatePrice: precio inválido para ${itemId}: ${price}`);
      return false;
    }
    if (variationId !== null) {
      try {
        const response = await this.client.put(`/items/${itemId}/variations/${variationId}`, { price: p });
        return response.status === 200;
      } catch (error) {
        console.error(`Error updatePrice deprecated path item ${itemId}:`, error.response?.data || error.message);
        return false;
      }
    }
    return this.updateItemPrice(itemId, p);
  }

  /**
   * Lee el precio actual de un item o variación.
   * @param {string} itemId
   * @param {number|null} variationId
   * @returns {Promise<number|null>}
   */
  async getPrice(itemId, variationId = null) {
    try {
      const r = await this.client.get(`/items/${itemId}`);
      const item = r.data;
      if (variationId !== null && item.variations) {
        const v = item.variations.find((v) => v.id === variationId);
        if (v && v.price != null) return Number(v.price);
      }
      return item.price != null ? Number(item.price) : null;
    } catch (error) {
      console.error(`Error obteniendo precio para item ${itemId}:`, error.response?.data || error.message);
      return null;
    }
  }

  /**
   * Obtiene el stock actual de un item o variación
   * @param {string} itemId - ID del item en MercadoLibre
   * @param {number|null} variationId - ID de la variación (si tiene variaciones)
   * @returns {Promise<number|null>} Cantidad en stock o null si hay error
   */
  async getStock(itemId, variationId = null) {
    try {
      const response = await this.client.get(`/items/${itemId}`);
      const item = response.data;
      
      // Si tiene variación, buscar el stock de esa variación específica
      if (variationId !== null && item.variations) {
        const variation = item.variations.find(v => v.id === variationId);
        if (variation) {
          return variation.available_quantity || 0;
        }
      }
      
      // Si no tiene variaciones o no se encontró la variación, devolver stock del item
      return item.available_quantity || 0;
    } catch (error) {
      // El interceptor maneja automáticamente los 401 con retry
      console.error(`Error obteniendo stock para item ${itemId}:`, error.response?.data || error.message);
      return null;
    }
  }

  /**
   * Obtiene todos los items activos del usuario con sus SKUs
   * @returns {Promise<Map>} Map con SKU como clave y {itemId, variationId} como valor
   */
  async getAllItemsWithSKU() {
    try {
      const response = await this.client.get(`/users/${MELI_USER_ID}/items/search`, {
        params: {
          status: 'active',
          limit: 50,
        },
      });

      const itemIds = response.data.results || [];
      const skuItemMap = new Map();
      
      console.log(`📦 Procesando ${itemIds.length} items de MercadoLibre...`);

      for (let idx = 0; idx < itemIds.length; idx++) {
        const itemId = itemIds[idx];
        try {
          const itemResponse = await this.client.get(`/items/${itemId}`);
          let item = itemResponse.data;
          
          // Refrescar el item si es necesario (one-time, automático, con persistencia)
          item = await this.refreshItemIfNeeded(itemId, item);
          
          // Buscar SKUs en variaciones - probar múltiples campos posibles
          let skusFoundInItem = 0;
          if (item.variations && item.variations.length > 0) {
            for (const variation of item.variations) {
              // Buscar SKU en múltiples campos posibles
              let sku = variation.seller_custom_field || 
                       variation.sku || 
                       variation.seller_sku;
              
              // Si no está en los campos directos, buscar en attribute_combinations
              if (!sku && variation.attribute_combinations) {
                const skuAttr = variation.attribute_combinations.find(attr => 
                  attr.id === 'SELLER_SKU' || 
                  attr.id === 'SKU' ||
                  attr.name?.toLowerCase().includes('sku') ||
                  attr.value_name?.toLowerCase().includes('sku')
                );
                if (skuAttr) {
                  sku = skuAttr.value_name || skuAttr.value_id;
                }
              }
              
              // También buscar en attributes si existe
              if (!sku && variation.attributes) {
                const skuAttr = variation.attributes.find(attr => 
                  attr.id === 'SELLER_SKU' || 
                  attr.id === 'SKU' ||
                  attr.name?.toLowerCase().includes('sku')
                );
                if (skuAttr) {
                  sku = skuAttr.value_name || skuAttr.value_id;
                }
              }
              
              if (sku && sku.toString().trim() !== '') {
                // Normalizar SKU (uppercase, sin espacios) para evitar duplicados
                const normalizedSKU = sku.toString().trim().toUpperCase();
                skuItemMap.set(normalizedSKU, {
                  itemId,
                  variationId: variation.id
                });
                skusFoundInItem++;
              }
            }
            if (skusFoundInItem > 0) {
              console.log(`  ✓ Item ${itemId}: ${skusFoundInItem} SKUs encontrados`);
            }
          } else {
            // Fallback: si no tiene variaciones, usar SKU del item principal
            const sku = item.seller_sku || item.sku;
            if (sku && sku.toString().trim() !== '') {
              const normalizedSKU = sku.toString().trim().toUpperCase();
              skuItemMap.set(normalizedSKU, {
                itemId,
                variationId: null
              });
              console.log(`  ✓ Item ${itemId}: 1 SKU encontrado (item principal)`);
            }
          }
        } catch (error) {
          // Continuar con el siguiente item si hay error
          console.log(`  ❌ Error procesando item ${itemId}:`, error.message);
          continue;
        }
      }
      
      console.log(`\n✅ Total de SKUs encontrados: ${skuItemMap.size}`);

      return skuItemMap;
    } catch (error) {
      // El interceptor maneja automáticamente los 401 con retry
      console.error('Error obteniendo items de MercadoLibre:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Función de debug: muestra todos los SKUs encontrados en MercadoLibre
   * Útil para diagnosticar problemas de matching
   */
  async debugListAllSKUs() {
    try {
      console.log('\n🔍 DEBUG: Listando todos los SKUs de MercadoLibre...\n');
      
      const response = await this.client.get(`/users/${MELI_USER_ID}/items/search`, {
        params: {
          status: 'active',
          limit: 50,
        },
      });

      const itemIds = response.data.results || [];
      console.log(`📦 Total de items activos: ${itemIds.length}\n`);

      for (const itemId of itemIds) {
        try {
          const itemResponse = await this.client.get(`/items/${itemId}`);
          const item = itemResponse.data;
          
          console.log(`\n📦 Item: ${itemId}`);
          console.log(`   Título: ${item.title}`);
          
          if (item.variations && item.variations.length > 0) {
            console.log(`   Variaciones: ${item.variations.length}`);
            item.variations.forEach((variation, index) => {
              console.log(`\n   Variación ${index + 1} (ID: ${variation.id}):`);
              console.log(`     - seller_custom_field: "${variation.seller_custom_field || 'NO'}"`);
              console.log(`     - sku: "${variation.sku || 'NO'}"`);
              console.log(`     - seller_sku: "${variation.seller_sku || 'NO'}"`);
              console.log(`     - user_product_id: "${variation.user_product_id || 'NO'}"`);
              console.log(`     - available_quantity: ${variation.available_quantity || 0}`);
              
              // Mostrar attribute_combinations completo
              if (variation.attribute_combinations && variation.attribute_combinations.length > 0) {
                console.log(`     - attribute_combinations:`);
                variation.attribute_combinations.forEach(attr => {
                  console.log(`       * ${attr.id || 'NO_ID'} (${attr.name || 'NO_NAME'}): "${attr.value_name || attr.value_id || 'NO_VALUE'}"`);
                });
              }
              
              // Mostrar attributes si existe
              if (variation.attributes && variation.attributes.length > 0) {
                console.log(`     - attributes:`);
                variation.attributes.forEach(attr => {
                  console.log(`       * ${attr.id || 'NO_ID'} (${attr.name || 'NO_NAME'}): "${attr.value_name || attr.value_id || 'NO_VALUE'}"`);
                });
              }
              
              // Mostrar todos los campos disponibles para debugging
              console.log(`     - Campos disponibles:`, Object.keys(variation));
            });
          } else {
            console.log(`   Sin variaciones`);
            console.log(`   - seller_sku: "${item.seller_sku || 'NO'}"`);
            console.log(`   - sku: "${item.sku || 'NO'}"`);
          }
        } catch (error) {
          console.log(`   ❌ Error: ${error.message}`);
        }
      }
      
      console.log('\n✅ Fin del debug\n');
    } catch (error) {
      console.error('❌ Error en debug:', error.message);
    }
  }
}

export default MercadoLibreAPI;
