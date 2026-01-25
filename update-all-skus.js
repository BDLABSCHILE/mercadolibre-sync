import MercadoLibreAPI from './mercadolibre-api.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Mapeo completo de SKU → { item_id, variation_id, color }
 * Basado en los datos obtenidos de get-variations.js y los SKUs de la imagen
 */
const SKU_MAPPING = {
  // ========== CARTERA ZARGA (MLC3535073664) ==========
  'CT-G-NE': { item_id: 'MLC3535073664', variation_id: 189654907244, color: 'Negro' },
  'CT-G-CAFGA': { item_id: 'MLC3535073664', variation_id: 189654907246, color: 'Café Gastado' },
  'CT-G-CAM': { item_id: 'MLC3535073664', variation_id: 189654907248, color: 'Camel' },
  'CT-G-CAR': { item_id: 'MLC3535073664', variation_id: 189654907250, color: 'Caramelo' },
  'CT-G-DEN': { item_id: 'MLC3535073664', variation_id: 189654907252, color: 'Denim' },
  'CT-G-MOKA': { item_id: 'MLC3535073664', variation_id: 189654907254, color: 'Moka' },
  'CT-G-MUSE': { item_id: 'MLC3535073664', variation_id: 189654907256, color: 'Mocha Mousse' },
  'CT-G-NEGA': { item_id: 'MLC3535073664', variation_id: 189654907258, color: 'Negro Gastado' },

  // ========== PORTA PASAPORTE (MLC3539375298) ==========
  'PP-M-CAR': { item_id: 'MLC3539375298', variation_id: 196203833777, color: 'Caramelo' },
  'PP-M-CRU': { item_id: 'MLC3539375298', variation_id: 196203833779, color: 'Crudo' },
  'PP-M-DENIM': { item_id: 'MLC3539375298', variation_id: 196203833781, color: 'Denim' },
  'PP-M-MOKA': { item_id: 'MLC3539375298', variation_id: 196203833783, color: 'Moka' },
  'PP-M-NEGRO': { item_id: 'MLC3539375298', variation_id: 196203833785, color: 'Negro' },

  // ========== BANANO MIDI (MLC3539387920) ==========
  'B-M-CAFGA': { item_id: 'MLC3539387920', variation_id: 189749736598, color: 'Café Gastado' },
  'B-M-CAM': { item_id: 'MLC3539387920', variation_id: 189749736600, color: 'Camel' },
  'B-M-CAR': { item_id: 'MLC3539387920', variation_id: 189749736602, color: 'Caramelo' },
  'B-M-CHA': { item_id: 'MLC3539387920', variation_id: 189749736604, color: 'Charol' },
  'B-M-CRU': { item_id: 'MLC3539387920', variation_id: 189749736606, color: 'Crudo' },
  'B-M-DEN': { item_id: 'MLC3539387920', variation_id: 189749736608, color: 'Denim' },
  'B-M-MIEL': { item_id: 'MLC3539387920', variation_id: 189749736610, color: 'Miel' },
  'B-M-MOKA': { item_id: 'MLC3539387920', variation_id: 189749736612, color: 'Moka' },
  'B-M-MUS': { item_id: 'MLC3539387920', variation_id: 189749736614, color: 'Verde musgo' },
  'B-M-MUSE': { item_id: 'MLC3539387920', variation_id: 189749736616, color: 'Mocha Mousse' },
  'B-M-NE': { item_id: 'MLC3539387920', variation_id: 189749736618, color: 'Negro' },
  'B-M-NEGA': { item_id: 'MLC3539387920', variation_id: 189749736620, color: 'Negro Gastado' },
  'B-M-SENE': { item_id: 'MLC3539387920', variation_id: 189749736622, color: 'Serpiente Negra' },

  // ========== MOCHILA ALFORJA CHICA (MLC3539608750) ==========
  'MA-C-CAFGA': { item_id: 'MLC3539608750', variation_id: 196203871333, color: 'Café Gastado' },
  'MA-C-CAM': { item_id: 'MLC3539608750', variation_id: 196203871335, color: 'Camel' },
  'MA-C-CAR': { item_id: 'MLC3539608750', variation_id: 196203871337, color: 'Caramelo' },
  'MA-C-CHA': { item_id: 'MLC3539608750', variation_id: 196203871339, color: 'Charol' },
  'MA-C-CRU': { item_id: 'MLC3539608750', variation_id: 196203871341, color: 'Crudo' },
  'MA-C-DEN': { item_id: 'MLC3539608750', variation_id: 196203871343, color: 'Denim' },
  'MA-C-MIEL': { item_id: 'MLC3539608750', variation_id: 196203871345, color: 'Miel' },
  'MA-C-MOKA': { item_id: 'MLC3539608750', variation_id: 196203871347, color: 'Moka' },
  'MA-C-MUS': { item_id: 'MLC3539608750', variation_id: 196203871349, color: 'Verde musgo' },
  'MA-C-MUSE': { item_id: 'MLC3539608750', variation_id: 196203871351, color: 'Mocha Mousse' },
  'MA-C-NE': { item_id: 'MLC3539608750', variation_id: 196203871353, color: 'Negro' },
  'MA-C-NEGA': { item_id: 'MLC3539608750', variation_id: 196203871355, color: 'Negro Gastado' },
  'MA-C-SENE': { item_id: 'MLC3539608750', variation_id: 196203871357, color: 'Serpiente negra' },

  // ========== TARJETERO (MLC3539440116) ==========
  'TJ-C-NE': { item_id: 'MLC3539440116', variation_id: 189749808526, color: 'Negro' },

  // ========== BANANO CHICO (MLC3539440132) ==========
  'B-C-CAFGA': { item_id: 'MLC3539440132', variation_id: 189749808580, color: 'Café Gastado' },
  'B-C-CAM': { item_id: 'MLC3539440132', variation_id: 189749808582, color: 'Camel' },
  'B-C-CAR': { item_id: 'MLC3539440132', variation_id: 189749808584, color: 'Caramelo' },
  'B-C-CHA': { item_id: 'MLC3539440132', variation_id: 189749808586, color: 'Charol' },
  'B-C-CRU': { item_id: 'MLC3539440132', variation_id: 189749808588, color: 'Crudo' },
  'B-C-DEN': { item_id: 'MLC3539440132', variation_id: 189749808590, color: 'Denim' },
  'B-C-MIEL': { item_id: 'MLC3539440132', variation_id: 189749808592, color: 'Miel' },
  'B-C-MOKA': { item_id: 'MLC3539440132', variation_id: 189749808594, color: 'Moka' },
  'B-C-MUS': { item_id: 'MLC3539440132', variation_id: 189749808596, color: 'Verde musgo' },
  'B-C-MUSE': { item_id: 'MLC3539440132', variation_id: 189749808598, color: 'Mocha Mousse' },
  'B-C-NE': { item_id: 'MLC3539440132', variation_id: 189749808600, color: 'Negro' },
  'B-C-NEGA': { item_id: 'MLC3539440132', variation_id: 189749808602, color: 'Negro Gastado' },
  'B-C-SENE': { item_id: 'MLC3539440132', variation_id: 189749808604, color: 'Serpiente Negra' },

  // ========== BANANO GRANDE (MLC3539440134) ==========
  'B-G-CAFGA': { item_id: 'MLC3539440134', variation_id: 189749808606, color: 'Café Gastado' },
  'B-G-CAM': { item_id: 'MLC3539440134', variation_id: 189749808608, color: 'Camel' },
  'B-G-CAR': { item_id: 'MLC3539440134', variation_id: 189749808610, color: 'Caramelo' },
  'B-G-CHA': { item_id: 'MLC3539440134', variation_id: 189749808612, color: 'Charol' },
  'B-G-CRU': { item_id: 'MLC3539440134', variation_id: 189749808614, color: 'Crudo' },
  'B-G-DEN': { item_id: 'MLC3539440134', variation_id: 189749808616, color: 'Denim' },
  'B-G-MIEL': { item_id: 'MLC3539440134', variation_id: 189749808618, color: 'Miel' },
  'B-G-MOKA': { item_id: 'MLC3539440134', variation_id: 189749808620, color: 'Moka' },
  'B-G-MUS': { item_id: 'MLC3539440134', variation_id: 189749808622, color: 'Verde musgo' },
  'B-G-MUSE': { item_id: 'MLC3539440134', variation_id: 189749808624, color: 'Mocha Mousse' },
  'B-G-NE': { item_id: 'MLC3539440134', variation_id: 189749808626, color: 'Negro' },
  'B-G-NEGA': { item_id: 'MLC3539440134', variation_id: 189749808628, color: 'Negro Gastado' },
  'B-G-SENE': { item_id: 'MLC3539440134', variation_id: 189749808630, color: 'Serpiente Negra' },

  // ========== TABAQUERA (MLC3539466112) ==========
  'T-M-CAFGA': { item_id: 'MLC3539466112', variation_id: 196203745941, color: 'Café Gastado' },
  'T-M-CAM': { item_id: 'MLC3539466112', variation_id: 196203745943, color: 'Camel' },
  'T-M-CAR': { item_id: 'MLC3539466112', variation_id: 196203745945, color: 'Caramelo' },
  'T-M-CHA': { item_id: 'MLC3539466112', variation_id: 196203745947, color: 'Charol' },
  'T-M-CRU': { item_id: 'MLC3539466112', variation_id: 196203745949, color: 'Crudo' },
  'T-M-DEN': { item_id: 'MLC3539466112', variation_id: 196203745951, color: 'Denim' },
  'T-M-MIEL': { item_id: 'MLC3539466112', variation_id: 196203745953, color: 'Miel' },
  'T-M-MOKA': { item_id: 'MLC3539466112', variation_id: 196203745955, color: 'Moka' },
  'T-M-MUS': { item_id: 'MLC3539466112', variation_id: 196203745957, color: 'Verde musgo' },
  'T-M-NE': { item_id: 'MLC3539466112', variation_id: 196203745959, color: 'Negro' },
  'T-M-NEGA': { item_id: 'MLC3539466112', variation_id: 196203745961, color: 'Negro Gastado' },
  'T-M-SENE': { item_id: 'MLC3539466112', variation_id: 196203745963, color: 'Serpiente Negra' },

  // ========== MOCHILA CHICA (MLC3539608746) ==========
  'M-C-CAFGA': { item_id: 'MLC3539608746', variation_id: 196203871279, color: 'Café Gastado' },
  'M-C-CAM': { item_id: 'MLC3539608746', variation_id: 196203871281, color: 'Camel' },
  'M-C-CAR': { item_id: 'MLC3539608746', variation_id: 196203871283, color: 'Caramelo' },
  'M-C-CHA': { item_id: 'MLC3539608746', variation_id: 196203871285, color: 'Charol' },
  'M-C-CRU': { item_id: 'MLC3539608746', variation_id: 196203871287, color: 'Crudo' },
  'M-C-DEN': { item_id: 'MLC3539608746', variation_id: 196203871289, color: 'Denim' },
  'M-C-MIEL': { item_id: 'MLC3539608746', variation_id: 196203871291, color: 'Miel' },
  'M-C-MOKA': { item_id: 'MLC3539608746', variation_id: 196203871293, color: 'Moka' },
  'M-C-MUS': { item_id: 'MLC3539608746', variation_id: 196203871295, color: 'Verde musgo' },
  'M-C-NE': { item_id: 'MLC3539608746', variation_id: 196203871297, color: 'Negro' },
  'M-C-NEGA': { item_id: 'MLC3539608746', variation_id: 196203871299, color: 'Negro Gastado' },
  'M-C-SENE': { item_id: 'MLC3539608746', variation_id: 196203871301, color: 'Serpiente Negra' },
};

async function updateAllSKUs() {
  try {
    console.log('🚀 Iniciando actualización masiva de SKUs en MercadoLibre');
    console.log(`📦 Total de SKUs a actualizar: ${Object.keys(SKU_MAPPING).length}\n`);
    console.log('='.repeat(80));

    const meli = new MercadoLibreAPI();
    
    let successCount = 0;
    let errorCount = 0;
    let skippedCount = 0;
    const results = [];

    // Agrupar por item_id para mostrar progreso por producto
    const itemsMap = {};
    for (const [sku, data] of Object.entries(SKU_MAPPING)) {
      if (!itemsMap[data.item_id]) {
        itemsMap[data.item_id] = [];
      }
      itemsMap[data.item_id].push({ sku, ...data });
    }

    // Iterar sobre cada item
    for (const [itemId, variations] of Object.entries(itemsMap)) {
      console.log(`\n📋 Procesando item: ${itemId}`);
      console.log(`   Variaciones: ${variations.length}`);
      console.log('-'.repeat(80));

      // Obtener título del item
      let itemTitle = 'N/A';
      try {
        const itemResponse = await meli.client.get(`/items/${itemId}`);
        itemTitle = itemResponse.data.title;
        console.log(`   Título: ${itemTitle}\n`);
      } catch (error) {
        console.log(`   ⚠️  No se pudo obtener título del item\n`);
      }

      // Procesar cada variación de este item
      for (const { sku, variation_id, color } of variations) {
        try {
          console.log(`   🔄 ${sku} → Variación ${variation_id} (${color})`);

          // Hacer PUT a /items/{ITEM_ID}/variations/{VARIATION_ID}
          const response = await meli.client.put(`/items/${itemId}/variations/${variation_id}`, {
            seller_custom_field: sku
          });

          if (response.status === 200) {
            console.log(`      ✅ Actualizado correctamente\n`);
            successCount++;
            results.push({ sku, item_id: itemId, variation_id, color, status: 'success' });
          } else {
            console.log(`      ⚠️  Status: ${response.status}\n`);
            errorCount++;
            results.push({ sku, item_id: itemId, variation_id, color, status: 'warning', statusCode: response.status });
          }

          // Delay para evitar rate limiting
          await new Promise(resolve => setTimeout(resolve, 150));

        } catch (error) {
          console.error(`      ❌ Error: ${error.response?.data?.message || error.message}\n`);
          errorCount++;
          results.push({ 
            sku, 
            item_id: itemId, 
            variation_id, 
            color, 
            status: 'error', 
            error: error.response?.data?.message || error.message 
          });
        }
      }
    }

    // Esperar a que la API procese todos los cambios
    console.log('\n⏳ Esperando a que la API procese los cambios...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Verificación: leer algunos items para confirmar
    console.log('\n🔍 Verificando resultados (muestra de 3 items)...\n');
    const sampleItems = Object.keys(itemsMap).slice(0, 3);
    
    for (const itemId of sampleItems) {
      try {
        const verifyResponse = await meli.client.get(`/items/${itemId}`);
        const item = verifyResponse.data;
        const itemVariations = itemsMap[itemId];
        
        console.log(`📊 ${item.title} (${itemId}):`);
        let foundCount = 0;
        
        item.variations?.forEach(variation => {
          const matchingSKU = itemVariations.find(
            v => v.variation_id === variation.id
          );
          
          if (matchingSKU) {
            const hasSKU = variation.seller_custom_field === matchingSKU.sku;
            console.log(`   ${hasSKU ? '✅' : '⚠️'} Variación ${variation.id} (${matchingSKU.color}): ${variation.seller_custom_field || 'SIN SKU'} ${hasSKU ? '' : `(esperado: ${matchingSKU.sku})`}`);
            if (hasSKU) foundCount++;
          }
        });
        
        console.log(`   📈 ${foundCount}/${itemVariations.length} SKUs correctos\n`);
      } catch (error) {
        console.error(`   ❌ Error verificando ${itemId}: ${error.message}\n`);
      }
    }

    // Resumen final
    console.log('='.repeat(80));
    console.log('\n📈 RESUMEN FINAL');
    console.log('='.repeat(80));
    console.log(`   ✅ Exitosas: ${successCount}`);
    console.log(`   ❌ Errores: ${errorCount}`);
    console.log(`   📦 Total procesadas: ${Object.keys(SKU_MAPPING).length}`);
    console.log(`   📊 Items procesados: ${Object.keys(itemsMap).length}\n`);

    // Mostrar errores si los hay
    const errors = results.filter(r => r.status === 'error');
    if (errors.length > 0) {
      console.log('❌ SKUs con errores:');
      errors.forEach(e => {
        console.log(`   - ${e.sku} (${e.item_id}/${e.variation_id}): ${e.error}`);
      });
      console.log('');
    }

    console.log('✅ Proceso completado');
    console.log('\n💡 Ahora puedes ejecutar `node index.js` para sincronizar stock\n');

  } catch (error) {
    console.error('❌ Error fatal:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

// Ejecutar automáticamente
updateAllSKUs();
