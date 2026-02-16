import axios from 'axios';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const MELI_USER_ID = process.env.MELI_USER_ID;

if (!MELI_USER_ID) {
  throw new Error('MELI_USER_ID debe estar configurado en .env');
}

// Obtener el directorio actual para ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Archivo de persistencia para items refrescados
const REFRESHED_ITEMS_FILE = path.join(__dirname, '.meli-refreshed-items.json');

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
