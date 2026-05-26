import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

class ShopifyAPI {
  constructor() {
    this.storeUrl = process.env.SHOPIFY_STORE_URL;
    this.accessToken = process.env.SHOPIFY_ACCESS_TOKEN;
    
    if (!this.storeUrl || !this.accessToken) {
      throw new Error('SHOPIFY_STORE_URL y SHOPIFY_ACCESS_TOKEN deben estar configurados en .env');
    }

    // Asegurar que la URL no tenga https://
    this.storeUrl = this.storeUrl.replace(/^https?:\/\//, '');
    
    this.baseURL = `https://${this.storeUrl}/admin/api/2024-01`;
    this.client = axios.create({
      baseURL: this.baseURL,
      headers: {
        'X-Shopify-Access-Token': this.accessToken,
        'Content-Type': 'application/json',
      },
    });
    this.setup429Retry();
  }

  /** Reintento con backoff ante 429 (rate limit). */
  setup429Retry() {
    this.client.interceptors.response.use(
      (res) => res,
      async (err) => {
        const config = err.config;
        if (err.response?.status !== 429 || !config || (config._retry429Count || 0) >= 2) return Promise.reject(err);
        config._retry429Count = (config._retry429Count || 0) + 1;
        const waitMs = config._retry429Count === 1 ? 8000 : 20000;
        console.warn(`⚠️  Shopify 429 (rate limit). Esperando ${waitMs / 1000}s antes de reintento ${config._retry429Count}/2...`);
        await new Promise(r => setTimeout(r, waitMs));
        return this.client(config);
      }
    );
  }

  /**
   * Obtiene todos los productos con sus variantes y stock
   * @returns {Promise<Array>} Array de productos con variantes
   */
  async getAllProducts() {
    try {
      const products = [];
      let hasNextPage = true;
      let pageInfo = null;

      while (hasNextPage) {
        let url = '/products.json?limit=250';
        if (pageInfo) {
          url += `&page_info=${pageInfo}`;
        }

        const response = await this.client.get(url);
        const newProducts = response.data.products || [];
        products.push(...newProducts);

        // Verificar si hay más páginas
        const linkHeader = response.headers.link;
        if (linkHeader && linkHeader.includes('rel="next"')) {
          const nextMatch = linkHeader.match(/<[^>]+page_info=([^>]+)>; rel="next"/);
          if (nextMatch) {
            pageInfo = nextMatch[1];
          } else {
            hasNextPage = false;
          }
        } else {
          hasNextPage = false;
        }
      }

      return products;
    } catch (error) {
      console.error('Error obteniendo productos de Shopify:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Obtiene el stock de un producto por SKU
   * @param {string} sku - SKU del producto
   * @returns {Promise<number|null>} Cantidad en stock o null si no se encuentra
   */
  async getStockBySKU(sku) {
    try {
      if (!sku || sku.trim() === '') {
        return null;
      }

      console.log(`   🔍 Buscando SKU "${sku}" en productos de Shopify...`);
      const products = await this.getAllProducts();
      console.log(`   📦 Total productos cargados: ${products.length}`);
      
      for (const product of products) {
        for (const variant of product.variants || []) {
          // Comparar SKU (case-insensitive para mayor flexibilidad)
          const variantSKU = variant.sku ? variant.sku.trim() : '';
          const searchSKU = sku.trim();
          
          if (variantSKU.toUpperCase() === searchSKU.toUpperCase()) {
            console.log(`   ✅ SKU encontrado en producto "${product.title}", variante "${variant.title}"`);
            console.log(`   📋 inventory_item_id: ${variant.inventory_item_id}`);
            console.log(`   📦 variant.inventory_quantity: ${variant.inventory_quantity}`);
            
            // Obtener el inventario real desde la API de inventario
            const inventoryItemId = variant.inventory_item_id;
            if (inventoryItemId) {
              try {
                const inventoryResponse = await this.client.get(
                  `/inventory_items/${inventoryItemId}.json`
                );
                const inventoryItem = inventoryResponse.data.inventory_item;
                
                // Obtener las ubicaciones de inventario
                const locationsResponse = await this.client.get(
                  `/inventory_items/${inventoryItemId}/locations.json`
                );
                
                let totalStock = 0;
                if (locationsResponse.data.locations) {
                  for (const location of locationsResponse.data.locations) {
                    const inventoryLevelResponse = await this.client.get(
                      `/inventory_levels.json?inventory_item_ids=${inventoryItemId}&location_ids=${location.id}`
                    );
                    if (inventoryLevelResponse.data.inventory_levels?.length > 0) {
                      totalStock += inventoryLevelResponse.data.inventory_levels[0].available || 0;
                    }
                  }
                }
                
                const finalStock = totalStock > 0 ? totalStock : (variant.inventory_quantity || 0);
                console.log(`   ✅ Stock total calculado: ${finalStock} (de ${locationsResponse.data.locations?.length || 0} ubicaciones)`);
                return finalStock;
              } catch (inventoryError) {
                // Si falla obtener inventory_item, usar el stock del variant como fallback
                console.warn(`   ⚠️  Error obteniendo inventory_item ${inventoryItemId}, usando variant.inventory_quantity:`, inventoryError.response?.data || inventoryError.message);
                return variant.inventory_quantity || 0;
              }
            }
            
            return variant.inventory_quantity || 0;
          }
        }
      }

      console.log(`   ⚠️  SKU "${sku}" no encontrado en ningún producto`);
      return null;
    } catch (error) {
      console.error(`   ❌ Error obteniendo stock para SKU ${sku}:`, error.response?.data || error.message);
      if (error.response?.status === 404) {
        console.error(`   💡 El SKU podría existir pero el inventory_item no es accesible. Verifica permisos de la API.`);
      }
      return null;
    }
  }

  /**
   * Obtiene órdenes/ventas de Shopify
   * Usa GraphQL para obtener totalRefundedSet y totalDiscountsSet exactos (REST no los incluye)
   * @param {Object} options - Opciones de filtrado
   * @param {string} options.createdAtMin - Fecha mínima (ISO 8601)
   * @param {string} options.createdAtMax - Fecha máxima (ISO 8601)
   * @param {string} options.status - Estado: any, open, closed, cancelled
   * @param {number} options.limit - Límite por página (máx 250)
   * @returns {Promise<Array<{id: string, total: number, created_at: string, status: string}>>}
   */
  async getOrders(options = {}) {
    try {
      const useGraphQL = process.env.SHOPIFY_USE_GRAPHQL !== '0';
      if (useGraphQL) {
        return await this.getOrdersGraphQL(options);
      }
      return await this.getOrdersREST(options);
    } catch (error) {
      console.error('Error obteniendo órdenes de Shopify:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Órdenes vía GraphQL (incluye totalRefundedSet y totalDiscountsSet exactos)
   */
  async getOrdersGraphQL(options = {}) {
    const orders = [];
    let cursor = null;
    const limit = Math.min(options.limit || 250, 250);
    const from = options.createdAtMin || '2019-01-01T00:00:00Z';
    const to = options.createdAtMax || new Date().toISOString();
    const queryFilter = `created_at:>=${from} created_at:<=${to} test:false`;

    const query = `query ($cursor: String, $limit: Int!, $query: String!) {
      orders(first: $limit, after: $cursor, query: $query, sortKey: CREATED_AT) {
        edges {
          cursor
          node {
            id
            name
            createdAt
            displayFinancialStatus
            displayFulfillmentStatus
            currencyCode
            subtotalPriceSet { shopMoney { amount } }
            totalDiscountsSet { shopMoney { amount } }
            totalPriceSet { shopMoney { amount } }
            totalRefundedSet { shopMoney { amount } }
            totalTaxSet { shopMoney { amount } }
            currentShippingPriceSet { shopMoney { amount } }
            refunds(first: 20) {
              id
              createdAt
              totalRefundedSet { shopMoney { amount } }
              refundLineItems(first: 5) {
                nodes { subtotalSet { shopMoney { amount } } }
              }
              transactions(first: 1) {
                nodes { processedAt }
              }
            }
            transactions(first: 20) {
              id
              kind
              amountSet { shopMoney { amount } }
              processedAt
            }
            returns(first: 5) {
              nodes {
                id
                returnLineItems(first: 10) {
                  nodes {
                    ... on ReturnLineItem {
                      quantity
                      withCodeDiscountedTotalPriceSet { shopMoney { amount } }
                    }
                  }
                }
                refunds(first: 5) {
                  nodes {
                    id
                    createdAt
                    totalRefundedSet { shopMoney { amount } }
                    transactions(first: 1) {
                      nodes { processedAt }
                    }
                  }
                }
              }
            }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }`;

    let hasNextPage = true;
    while (hasNextPage) {
      const variables = { limit, query: queryFilter, cursor };
      const response = await this.client.post('/graphql.json', { query, variables });
      const data = response.data?.data?.orders;
      if (!data) throw new Error(response.data?.errors?.[0]?.message || 'GraphQL error');

      for (const edge of data.edges || []) {
        const n = edge.node;
        const id = n.id?.replace('gid://shopify/Order/', '') || '';
        const subtotal = parseFloat(n.subtotalPriceSet?.shopMoney?.amount || 0);
        const discounts = parseFloat(n.totalDiscountsSet?.shopMoney?.amount || 0);
        const total = parseFloat(n.totalPriceSet?.shopMoney?.amount || 0);
        const refundsTotal = parseFloat(n.totalRefundedSet?.shopMoney?.amount || 0);
        const shipping = parseFloat(n.currentShippingPriceSet?.shopMoney?.amount || 0);
        const grossSales = subtotal + discounts;

        // Shopify "Devoluciones" = solo valor de productos devueltos (excluye reembolsos de envío)
        const productRefundAmount = (r) => {
          const lineItems = r?.refundLineItems?.nodes || [];
          const sum = lineItems.reduce((s, li) => s + parseFloat(li?.subtotalSet?.shopMoney?.amount || 0), 0);
          return sum > 0 ? sum : null;
        };
        const refundList = (Array.isArray(n.refunds) ? n.refunds : []).map(r => {
          const productAmt = productRefundAmount(r);
          return { ...r, _amountOverride: (productAmt ?? 0) > 0 ? productAmt : 0 };
        });
        const refundsFromReturns = (n.returns?.nodes || []).flatMap(ret => {
          const lineTotal = (ret?.returnLineItems?.nodes || []).reduce(
            (sum, li) => sum + parseFloat(li?.withCodeDiscountedTotalPriceSet?.shopMoney?.amount || 0) * (li?.quantity || 1),
            0
          );
          return (ret?.refunds?.nodes || []).map(r => {
            const productAmt = productRefundAmount(r);
            return { ...r, _amountOverride: (productAmt ?? null) > 0 ? productAmt : (lineTotal > 0 ? lineTotal : null) };
          });
        });
        const fromRefundsOrReturns = [...refundList, ...refundsFromReturns];
        const totalFromRefunds = fromRefundsOrReturns.reduce(
          (s, r) => s + (r?._amountOverride ?? parseFloat(r?.totalRefundedSet?.shopMoney?.amount || 0)),
          0
        );
        // Solo usar transactions cuando NO hay refunds/returns en la API (ej. Wasabil Connector).
        // Si hay refunds con monto 0 (solo envío), NO sumar transactions (incluirían envío y sobre-contaríamos).
        const refundsFromTransactions = fromRefundsOrReturns.length === 0 && totalFromRefunds === 0
          ? (n.transactions || [])
              .filter(tx => tx?.kind === 'REFUND')
              .map(tx => ({
                id: tx?.id?.replace('gid://shopify/OrderTransaction/', '') || `tx-${Math.random().toString(36).slice(2)}`,
                processed_at: tx?.processedAt,
                amount: Math.abs(parseFloat(tx?.amountSet?.shopMoney?.amount || 0)),
              }))
              .filter(r => r.amount > 0 && r.processed_at)
          : [];
        const allRefunds = [...fromRefundsOrReturns, ...refundsFromTransactions];
        const seen = new Set();
        const refundDetails = allRefunds
          .map(r => {
            const tx = r?.transactions?.nodes?.[0];
            const processedAt = r?.processed_at ?? tx?.processedAt ?? r?.createdAt;
            const amount = r?.amount ?? r?._amountOverride ?? parseFloat(r?.totalRefundedSet?.shopMoney?.amount || 0);
            const refundId = (r?.id || '').replace('gid://shopify/Refund/', '') || r?.id || '';
            return {
              id: refundId || `refund-${id}-${Math.random().toString(36).slice(2)}`,
              processed_at: processedAt,
              amount,
            };
          })
          .filter(r => r.amount > 0 && r.processed_at && !seen.has(r.id) && (seen.add(r.id), true));

        const refundTx = (n.transactions || []).filter(t => t?.kind === 'REFUND');
        orders.push({
          id,
          name: n.name || null,
          _transactions: process.env.DEBUG_REFUNDS ? refundTx : undefined,
          total,
          currency: n.currencyCode || 'CLP',
          created_at: n.createdAt,
          status: n.displayFinancialStatus || n.displayFulfillmentStatus || 'unknown',
          gross_sales: grossSales,
          discounts,
          refunds: refundsTotal,
          refund_details: refundDetails,
          shipping_income: shipping,
          total_paid_amount: total,
        });
      }

      hasNextPage = data?.pageInfo?.hasNextPage && data.edges?.length > 0;
      cursor = data?.pageInfo?.endCursor || null;
    }

    return orders;
  }

  /**
   * Órdenes vía REST (fallback, sin devoluciones por defecto)
   */
  async getOrdersREST(options = {}) {
    const orders = [];
    let hasNextPage = true;
    let pageInfo = null;

    while (hasNextPage) {
      const params = new URLSearchParams();
      params.set('limit', String(options.limit || 250));
      if (pageInfo) {
        params.set('page_info', pageInfo);
      } else {
        params.set('status', options.status || 'any');
        if (options.createdAtMin) params.set('created_at_min', options.createdAtMin);
        if (options.createdAtMax) params.set('created_at_max', options.createdAtMax);
      }

      const response = await this.client.get(`/orders.json?${params.toString()}`);
      const newOrders = response.data.orders || [];
      orders.push(...newOrders);

      const linkHeader = response.headers.link;
      if (linkHeader && linkHeader.includes('rel="next"')) {
        const nextMatch = linkHeader.match(/<[^>]+page_info=([^>]+)>; rel="next"/);
        pageInfo = nextMatch ? nextMatch[1] : null;
        hasNextPage = !!pageInfo;
      } else {
        hasNextPage = false;
      }
    }

    return orders.map(o => {
      const total = parseFloat(o.total_price || 0);
      const subtotal = parseFloat(o.subtotal_price || o.current_subtotal_price || 0);
      const discounts = parseFloat(o.current_total_discounts || o.total_discounts || 0);
      const totalTax = parseFloat(o.total_tax || o.current_total_tax || 0);
      const grossSales = subtotal + discounts;
      let shippingIncome = 0;
      if (Array.isArray(o.shipping_lines) && o.shipping_lines.length > 0) {
        for (const sl of o.shipping_lines) {
          const p = sl.price ?? sl.price_set?.shop_money?.amount ?? sl.price_set?.presentment_money?.amount;
          shippingIncome += parseFloat(p || 0);
        }
      }
      if (shippingIncome === 0 && total > 0 && total > subtotal) {
        shippingIncome = Math.max(0, total - subtotal - totalTax);
      }
      let refundsAmount = 0;
      const refundDetails = [];
      if (Array.isArray(o.refunds)) {
        for (const r of o.refunds) {
          const amt = parseFloat(r.total ?? 0);
          refundsAmount += amt;
          const lineItems = r.refund_line_items || [];
          let productAmount = 0;
          for (const li of lineItems) {
            const sub = li.subtotal_set?.shop_money?.amount ?? li.subtotal;
            productAmount += parseFloat(sub ?? 0);
          }
          const amount = productAmount > 0 ? productAmount : amt;
          const processedAt = r.processed_at ?? r.created_at;
          if (amount > 0 && processedAt) {
            refundDetails.push({
              id: String(r.id ?? ''),
              processed_at: processedAt,
              amount,
            });
          }
        }
      }
      return {
        id: String(o.id),
        total,
        currency: o.currency || 'CLP',
        created_at: o.created_at,
        status: o.financial_status || o.fulfillment_status || 'unknown',
        gross_sales: grossSales,
        discounts,
        refunds: refundsAmount,
        refund_details: refundDetails,
        shipping_income: shippingIncome,
        total_paid_amount: total,
      };
    });
  }

  /**
   * Obtiene todos los SKUs con su stock actual
   * @returns {Promise<Map>} Map con SKU como clave y stock como valor
   */
  async getAllSKUsWithStock() {
    try {
      const products = await this.getAllProducts();
      const skuStockMap = new Map();

      for (const product of products) {
        for (const variant of product.variants || []) {
          if (variant.sku && variant.sku.trim() !== '') {
            const stock = variant.inventory_quantity || 0;
            skuStockMap.set(variant.sku, stock);
          }
        }
      }

      return skuStockMap;
    } catch (error) {
      console.error('Error obteniendo SKUs con stock:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Actualiza el stock de un producto por SKU
   * @param {string} sku - SKU del producto
   * @param {number} quantity - Cantidad a descontar (debe ser positiva, se convertirá a negativa)
   * @returns {Promise<boolean>} true si se actualizó correctamente
   */
  async updateStockBySKU(sku, quantity) {
    try {
      if (!sku || sku.trim() === '') {
        console.error('❌ SKU vacío o inválido');
        return false;
      }

      if (quantity <= 0) {
        console.error(`❌ Cantidad inválida: ${quantity} (debe ser positiva)`);
        return false;
      }

      const locationId = process.env.SHOPIFY_LOCATION_ID;
      if (!locationId) {
        console.error('❌ SHOPIFY_LOCATION_ID no configurado en .env');
        return false;
      }

      // Buscar el variant por SKU
      const products = await this.getAllProducts();
      let inventoryItemId = null;
      let variantTitle = null;

      for (const product of products) {
        for (const variant of product.variants || []) {
          if (variant.sku === sku) {
            inventoryItemId = variant.inventory_item_id;
            variantTitle = variant.title || product.title;
            break;
          }
        }
        if (inventoryItemId) break;
      }

      if (!inventoryItemId) {
        console.error(`❌ SKU ${sku} no encontrado en Shopify`);
        return false;
      }

      // Obtener stock actual antes de descontar
      const currentStock = await this.getStockBySKU(sku);
      if (currentStock === null) {
        console.error(`❌ No se pudo obtener stock actual para SKU ${sku}`);
        return false;
      }

      // Descontar cantidad (quantity_adjustment debe ser negativo)
      const quantityAdjustment = -Math.abs(quantity);
      const newStock = Math.max(0, currentStock + quantityAdjustment);

      console.log(`📉 Descontando stock: SKU=${sku}, Actual=${currentStock}, Descuento=${quantity}, Nuevo=${newStock}`);

      // Actualizar usando inventory_levels/adjust (Shopify espera available_adjustment)
      const response = await this.client.post('/inventory_levels/adjust.json', {
        location_id: locationId,
        inventory_item_id: inventoryItemId,
        available_adjustment: quantityAdjustment
      });

      if (response.status === 200) {
        const adjustedStock = response.data.inventory_level?.available || newStock;
        console.log(`✅ Stock actualizado en Shopify: SKU=${sku} (${variantTitle}), Stock anterior=${currentStock}, Stock nuevo=${adjustedStock}`);
        return true;
      } else {
        console.error(`❌ Error actualizando stock: Status ${response.status}`);
        return false;
      }

    } catch (error) {
      console.error(`❌ Error actualizando stock para SKU ${sku}:`, error.response?.data || error.message);
      return false;
    }
  }
}

export default ShopifyAPI;
