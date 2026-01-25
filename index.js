import ShopifyAPI from './shopify-api.js';
import MercadoLibreAPI from './mercadolibre-api.js';
import dotenv from 'dotenv';

dotenv.config();

class StockSync {
  constructor() {
    this.shopify = new ShopifyAPI();
    this.meli = new MercadoLibreAPI();
    this.stockOffset = parseInt(process.env.STOCK_OFFSET || '1', 10);
  }

  /**
   * Calcula el stock para MercadoLibre basado en el stock de Shopify
   * @param {number} shopifyStock - Stock en Shopify
   * @returns {number} Stock para MercadoLibre (mínimo 0)
   */
  calculateMeliStock(shopifyStock) {
    if (shopifyStock === null || shopifyStock === undefined) {
      return 0;
    }
    return Math.max(0, shopifyStock - this.stockOffset);
  }

  /**
   * Sincroniza el stock de un SKU específico
   * @param {string} sku - SKU del producto
   * @returns {Promise<boolean>} true si se sincronizó correctamente
   */
  async syncSKU(sku) {
    try {
      console.log(`\nSincronizando SKU: ${sku}`);

      // Obtener stock de Shopify
      const shopifyStock = await this.shopify.getStockBySKU(sku);
      if (shopifyStock === null) {
        console.log(`  ⚠️  SKU no encontrado en Shopify`);
        return false;
      }

      console.log(`  📦 Stock en Shopify: ${shopifyStock}`);

      // Calcular stock para MercadoLibre
      const meliStock = this.calculateMeliStock(shopifyStock);
      console.log(`  🛒 Stock calculado para MercadoLibre: ${meliStock} (Shopify - ${this.stockOffset})`);

      // Buscar item en MercadoLibre (con debug si hay problema)
      const result = await this.meli.findItemBySKU(sku, false);
      if (!result) {
        console.log(`  ⚠️  SKU no encontrado en MercadoLibre`);
        console.log(`  💡 Tip: Ejecuta con --debug para ver detalles`);
        return false;
      }

      const { itemId, variationId } = result;

      // Obtener stock actual en MercadoLibre
      const currentMeliStock = await this.meli.getStock(itemId, variationId);
      console.log(`  📊 Stock actual en MercadoLibre: ${currentMeliStock}`);

      // Actualizar si es necesario
      if (currentMeliStock !== meliStock) {
        const updated = await this.meli.updateStock(itemId, meliStock, variationId);
        if (updated) {
          console.log(`  ✅ Stock actualizado en MercadoLibre: ${meliStock}`);
          return true;
        } else {
          console.log(`  ❌ Error actualizando stock en MercadoLibre`);
          return false;
        }
      } else {
        console.log(`  ✓ Stock ya está sincronizado`);
        return true;
      }
    } catch (error) {
      console.error(`  ❌ Error sincronizando SKU ${sku}:`, error.message);
      return false;
    }
  }

  /**
   * Sincroniza todos los productos que tienen SKU en común
   */
  async syncAll() {
    try {
      console.log('🔄 Iniciando sincronización de stock...\n');
      console.log(`📌 Regla aplicada: Stock MercadoLibre = Stock Shopify - ${this.stockOffset} (mínimo 0)\n`);

      // Obtener todos los SKUs de Shopify
      console.log('📥 Obteniendo productos de Shopify...');
      const shopifySKUs = await this.shopify.getAllSKUsWithStock();
      console.log(`   ✓ Encontrados ${shopifySKUs.size} SKUs en Shopify\n`);

      // Obtener todos los items de MercadoLibre
      console.log('📥 Obteniendo productos de MercadoLibre...');
      const meliItems = await this.meli.getAllItemsWithSKU();
      console.log(`   ✓ Encontrados ${meliItems.size} items en MercadoLibre\n`);

      // Encontrar SKUs en común (normalizar para comparación)
      const commonSKUs = [];
      for (const [shopifySKU] of shopifySKUs) {
        const normalizedShopifySKU = shopifySKU.trim().toUpperCase();
        // Buscar en el Map de MercadoLibre (que ya tiene SKUs normalizados)
        if (meliItems.has(normalizedShopifySKU)) {
          commonSKUs.push(shopifySKU); // Guardar el SKU original de Shopify
        }
      }

      console.log(`🔗 Encontrados ${commonSKUs.length} productos con SKU en común\n`);
      console.log('='.repeat(60));

      if (commonSKUs.length === 0) {
        console.log('⚠️  No se encontraron productos con SKU en común');
        return;
      }

      // Sincronizar cada SKU
      let successCount = 0;
      let errorCount = 0;
      let skippedCount = 0;

      for (const sku of commonSKUs) {
        const shopifyStock = shopifySKUs.get(sku);
        const meliStock = this.calculateMeliStock(shopifyStock);
        // Normalizar SKU para buscar en el Map de MercadoLibre
        const normalizedSKU = sku.trim().toUpperCase();
        const meliItem = meliItems.get(normalizedSKU);

        if (!meliItem) {
          console.log(`❌ ${sku}: No se encontró información del item en MercadoLibre`);
          errorCount++;
          continue;
        }

        const { itemId, variationId } = meliItem;

        try {
          const currentMeliStock = await this.meli.getStock(itemId, variationId);
          
          if (currentMeliStock !== meliStock) {
            const updated = await this.meli.updateStock(itemId, meliStock, variationId);
            if (updated) {
              console.log(`✅ ${sku}: Shopify(${shopifyStock}) → MercadoLibre(${meliStock})`);
              successCount++;
            } else {
              console.log(`❌ ${sku}: Error al actualizar`);
              errorCount++;
            }
          } else {
            console.log(`✓ ${sku}: Ya sincronizado (${meliStock})`);
            skippedCount++;
          }
        } catch (error) {
          console.log(`❌ ${sku}: ${error.message}`);
          errorCount++;
        }
      }

      console.log('='.repeat(60));
      console.log('\n📊 Resumen de sincronización:');
      console.log(`   ✅ Actualizados: ${successCount}`);
      console.log(`   ✓ Ya sincronizados: ${skippedCount}`);
      console.log(`   ❌ Errores: ${errorCount}`);
      console.log(`   📦 Total procesados: ${commonSKUs.length}\n`);

    } catch (error) {
      console.error('❌ Error en la sincronización:', error.message);
      throw error;
    }
  }
}

// Ejecutar sincronización
async function main() {
  try {
    const sync = new StockSync();
    
    // Verificar si se pasó un SKU específico como argumento
    const args = process.argv.slice(2);
    
    // Opción --debug para listar todos los SKUs
    if (args.includes('--debug') || args.includes('-d')) {
      await sync.meli.debugListAllSKUs();
      return;
    }
    
    // Opción --debug-sku para buscar un SKU con debug
    const debugIndex = args.findIndex(arg => arg === '--debug-sku' || arg === '-ds');
    if (debugIndex !== -1 && args[debugIndex + 1]) {
      const sku = args[debugIndex + 1];
      console.log(`\n🔍 Modo debug activado para SKU: ${sku}\n`);
      const result = await sync.meli.findItemBySKU(sku, true);
      if (result) {
        console.log(`\n✅ Resultado:`, result);
      } else {
        console.log(`\n❌ SKU no encontrado`);
      }
      return;
    }
    
    if (args.length > 0 && !args[0].startsWith('--')) {
      const sku = args[0];
      await sync.syncSKU(sku);
    } else {
      await sync.syncAll();
    }
  } catch (error) {
    console.error('Error fatal:', error.message);
    process.exit(1);
  }
}

main();
