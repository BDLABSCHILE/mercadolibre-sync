import MercadoLibreAPI from './mercadolibre-api.js';
import dotenv from 'dotenv';

dotenv.config();

const ITEM_ID = 'MLC3539517694';

// Mapping VARIATION_ID → SKU (FUENTE DE VERDAD)
const VARIATION_SKU_MAP = {
  '189749746668': 'MA-G-CHA',        // Charol
  '189749746686': 'MA-G-SENE',       // Serpiente Negra
  '189749746684': 'MA-G-NEGA',       // Negro Gastado
  '189749746670': 'MA-G-CRU',        // Crudo
  '189749746672': 'MA-G-DEN',        // Denim
  '189749746666': 'MA-G-CAR',        // Caramelo
  '189749746676': 'MA-G-MOKA',       // Moka
  '189749746664': 'MA-G-CAM',        // Camel
  '189749746678': 'MA-G-MUS',        // Verde Musgo
  '189749746662': 'MA-G-CAFGA',      // Café Gastado
  '189749746674': 'MA-G-MIEL',       // Miel
  '189749746682': 'MA-G-NE',         // Negro
  '189749746680': 'MA-G-MUSE',       // Mocha Mousse
};

async function updateSKUs() {
  try {
    console.log('🚀 Iniciando actualización de SKUs para item:', ITEM_ID);
    console.log(`📦 Total de variaciones a actualizar: ${Object.keys(VARIATION_SKU_MAP).length}\n`);

    const meli = new MercadoLibreAPI();
    
    // Obtener el item actual para verificar variaciones
    const itemResponse = await meli.client.get(`/items/${ITEM_ID}`);
    const item = itemResponse.data;
    
    console.log(`📋 Item: ${item.title}`);
    console.log(`📊 Variaciones existentes: ${item.variations?.length || 0}\n`);

    let successCount = 0;
    let errorCount = 0;
    const results = [];

    // Iterar sobre el mapping completo
    for (const [variationId, sku] of Object.entries(VARIATION_SKU_MAP)) {
      try {
        console.log(`🔄 Actualizando variación ${variationId} → SKU: ${sku}`);
        
        // Hacer PUT a /items/{ITEM_ID}/variations/{VARIATION_ID}
        const response = await meli.client.put(`/items/${ITEM_ID}/variations/${variationId}`, {
          seller_custom_field: sku
        });

        if (response.status === 200) {
          console.log(`  ✅ Variación ${variationId} actualizada correctamente\n`);
          successCount++;
          results.push({ variationId, sku, status: 'success' });
        } else {
          console.log(`  ⚠️  Variación ${variationId} devolvió status: ${response.status}\n`);
          errorCount++;
          results.push({ variationId, sku, status: 'warning', statusCode: response.status });
        }

        // Pequeño delay para evitar rate limiting
        await new Promise(resolve => setTimeout(resolve, 150));

      } catch (error) {
        console.error(`  ❌ Error actualizando variación ${variationId}:`, error.response?.data || error.message);
        errorCount++;
        results.push({ variationId, sku, status: 'error', error: error.message });
      }
    }

    // Esperar un momento para que la API procese todos los cambios
    console.log('\n⏳ Esperando a que la API procese los cambios...');
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Verificar: leer el item completo de nuevo y listar todas las variaciones con su seller_custom_field
    console.log('\n🔍 Verificando resultados...\n');
    const verifyResponse = await meli.client.get(`/items/${ITEM_ID}`);
    const verifiedItem = verifyResponse.data;

    console.log('📊 Estado final de todas las variaciones:\n');
    console.log('='.repeat(80));
    
    if (verifiedItem.variations && verifiedItem.variations.length > 0) {
      verifiedItem.variations.forEach((variation, index) => {
        const color = variation.attribute_combinations?.find(a => a.id === 'COLOR')?.value_name || 'N/A';
        const sku = variation.seller_custom_field || '❌ NO TIENE SKU';
        const expectedSku = VARIATION_SKU_MAP[variation.id.toString()];
        const match = expectedSku && sku === expectedSku ? '✅' : expectedSku ? '⚠️' : '';
        
        console.log(`${index + 1}. Variación ${variation.id} (${color}):`);
        console.log(`   SKU actual: ${sku}`);
        if (expectedSku) {
          console.log(`   SKU esperado: ${expectedSku} ${match}`);
        }
        console.log('');
      });
    }

    console.log('='.repeat(80));
    console.log('\n📈 Resumen de actualización:');
    console.log(`   ✅ Exitosas: ${successCount}`);
    console.log(`   ⚠️  Advertencias: ${errorCount - results.filter(r => r.status === 'error').length}`);
    console.log(`   ❌ Errores: ${results.filter(r => r.status === 'error').length}`);
    console.log(`   📦 Total procesadas: ${Object.keys(VARIATION_SKU_MAP).length}\n`);

    // Verificar que todas las variaciones del mapping tienen SKU
    const missingSKUs = [];
    verifiedItem.variations?.forEach(variation => {
      const variationIdStr = variation.id.toString();
      if (VARIATION_SKU_MAP[variationIdStr] && !variation.seller_custom_field) {
        missingSKUs.push({ variationId: variationIdStr, expectedSku: VARIATION_SKU_MAP[variationIdStr] });
      }
    });

    if (missingSKUs.length > 0) {
      console.log('⚠️  Variaciones que aún no tienen SKU después de la actualización:');
      missingSKUs.forEach(m => {
        console.log(`   - Variación ${m.variationId}: esperado ${m.expectedSku}`);
      });
      console.log('\n💡 Puede ser necesario esperar unos segundos y ejecutar de nuevo.\n');
    } else {
      console.log('✅ Todas las variaciones del mapping tienen SKU correctamente asignado!\n');
    }

  } catch (error) {
    console.error('❌ Error fatal:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

// Ejecutar automáticamente
updateSKUs();
