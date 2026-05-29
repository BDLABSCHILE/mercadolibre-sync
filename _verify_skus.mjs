// Script temporal de verificación read-only (solo GETs, sin PUTs de refresh).
// Ejercita: paginación scan + resolveVariationSku/resolveItemSku + user-products.
import MercadoLibreAPI from './mercadolibre-api.js';

const meli = new MercadoLibreAPI();

const itemIds = await meli.getAllActiveItemIds();
console.log(`Items activos (scan): ${itemIds.length}`);

const skuMap = new Map();
let viaUserProduct = 0;
let noVariations = 0;
let withVariations = 0;

for (const itemId of itemIds) {
  try {
    const { data: item } = await meli.client.get(`/items/${itemId}`);
    if (item.variations && item.variations.length > 0) {
      withVariations++;
      for (const v of item.variations) {
        const before = meli.userProductCache.size;
        const sku = await meli.resolveVariationSku(v);
        if (sku) {
          if (!v.seller_custom_field && !v.sku && !v.seller_sku && v.user_product_id) viaUserProduct++;
          skuMap.set(sku.toUpperCase(), { itemId, variationId: v.id });
        }
      }
    } else {
      noVariations++;
      const sku = await meli.resolveItemSku(item);
      if (sku) skuMap.set(sku.toUpperCase(), { itemId, variationId: null });
    }
  } catch (e) {
    console.log(`  err ${itemId}: ${e.message}`);
  }
}

console.log(`Items con variaciones: ${withVariations} | sin variaciones: ${noVariations}`);
console.log(`SKUs resueltos vía user_product_id: ${viaUserProduct}`);
console.log(`user-products consultados (cache size): ${meli.userProductCache.size}`);
console.log(`TOTAL SKUs resueltos: ${skuMap.size}`);

const biG = [...skuMap.keys()].filter((s) => s.startsWith('BI-G-')).sort();
console.log(`Billeteras BI-G-* resueltas (${biG.length}): ${biG.join(', ')}`);
