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

      // Actualizar usando inventory_levels/adjust
      const response = await this.client.post('/inventory_levels/adjust.json', {
        location_id: locationId,
        inventory_item_id: inventoryItemId,
        quantity_adjustment: quantityAdjustment
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
