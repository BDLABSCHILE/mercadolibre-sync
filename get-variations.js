import MercadoLibreAPI from './mercadolibre-api.js';
import dotenv from 'dotenv';

dotenv.config();

// Array de ITEM_IDs a consultar
const ITEM_IDS = [
  'MLC3535073664',
  'MLC3539375298',
  'MLC3539387920',
  'MLC3539608750',
  'MLC3539440116',
  'MLC3539440132',
  'MLC3539440134',
  'MLC3539466112',
  'MLC3539608746'
];

async function getVariations() {
  try {
    console.log('🔍 Obteniendo variaciones de MercadoLibre...\n');
    console.log(`📦 Total de items a consultar: ${ITEM_IDS.length}\n`);
    console.log('='.repeat(80));

    const meli = new MercadoLibreAPI();
    const allResults = [];

    // Iterar uno por uno sobre cada ITEM_ID
    for (let i = 0; i < ITEM_IDS.length; i++) {
      const itemId = ITEM_IDS[i];
      
      try {
        console.log(`\n📋 ITEM_ID: ${itemId}`);
        console.log('-'.repeat(80));

        // Hacer GET a /items/{ITEM_ID}
        const response = await meli.client.get(`/items/${itemId}`);
        const item = response.data;

        console.log(`Título: ${item.title}`);
        console.log(`Variaciones: ${item.variations?.length || 0}\n`);

        // Por cada item, recorrer item.variations
        if (item.variations && item.variations.length > 0) {
          item.variations.forEach((variation, index) => {
            // Extraer attribute_combinations (ej: color)
            const attributes = variation.attribute_combinations || [];
            
            // Construir objeto con la información requerida
            const variationData = {
              item_id: itemId,
              variation_id: variation.id,
              attributes: attributes.map(attr => ({
                id: attr.id,
                name: attr.name,
                value_id: attr.value_id,
                value_name: attr.value_name
              })),
              seller_custom_field: variation.seller_custom_field || null
            };

            // Agregar a resultados
            allResults.push(variationData);

            // Mostrar en consola
            console.log(`Variación ${index + 1}:`);
            console.log(JSON.stringify(variationData, null, 2));
            console.log('');
          });
        } else {
          console.log('⚠️  Este item no tiene variaciones\n');
        }

      } catch (error) {
        // Manejar errores sin cortar el loop completo
        console.error(`❌ Error consultando item ${itemId}:`, error.response?.data || error.message);
        console.log('');
        continue;
      }

      // Separador entre items
      if (i < ITEM_IDS.length - 1) {
        console.log('='.repeat(80));
      }
    }

    // Resumen final
    console.log('\n' + '='.repeat(80));
    console.log('📊 RESUMEN FINAL');
    console.log('='.repeat(80));
    console.log(`Total de items consultados: ${ITEM_IDS.length}`);
    console.log(`Total de variaciones encontradas: ${allResults.length}`);
    console.log(`Variaciones con seller_custom_field: ${allResults.filter(r => r.seller_custom_field).length}`);
    console.log(`Variaciones sin seller_custom_field: ${allResults.filter(r => !r.seller_custom_field).length}`);
    console.log('\n✅ Proceso completado\n');

  } catch (error) {
    console.error('❌ Error fatal:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

// Ejecutar automáticamente
getVariations();
