/**
 * Seed inicial de sku_mapping.
 *
 * Combina:
 *  - meli-sku-mapping.js → SKU + ml_item_id + ml_variation_id (109 entries).
 *  - Shopify getAllProducts() → SKU + shopify_variant_id + shopify_inventory_item_id.
 *  - falabella_seller_sku = sku (asumimos identidad universal; editable después).
 *
 * Idempotente: UPSERT por sku. Re-ejecutar es seguro.
 *
 * Uso: npm run seed
 */

import { logger } from '../logger.js';
import { close as closeDb } from './index.js';
import * as repo from './repositories/sku-mapping.js';
import ShopifyAPI from '../../shopify-api.js';
import {
  meliVariationIdToSku,
  meliItemIdToSkus,
} from '../../meli-sku-mapping.js';

async function buildMeliIndex() {
  const bySku = new Map();
  for (const [variationIdStr, sku] of meliVariationIdToSku) {
    for (const [itemId, skus] of meliItemIdToSkus) {
      if (skus.includes(sku)) {
        bySku.set(sku, { ml_item_id: itemId, ml_variation_id: variationIdStr });
        break;
      }
    }
  }
  return bySku;
}

async function buildShopifyIndex() {
  const shopify = new ShopifyAPI();
  logger.info('descargando productos de Shopify (1 sola llamada paginada)...');
  const products = await shopify.getAllProducts();
  let variantsWithSku = 0;
  let variantsWithoutSku = 0;
  const bySku = new Map();
  for (const product of products) {
    for (const variant of product.variants || []) {
      const sku = (variant.sku || '').trim();
      if (!sku) {
        variantsWithoutSku++;
        continue;
      }
      variantsWithSku++;
      if (bySku.has(sku)) {
        logger.warn(
          { sku, prev: bySku.get(sku), now: { product: product.title, variant: variant.title } },
          'SKU duplicado en Shopify (se usa el último visto)',
        );
      }
      bySku.set(sku, {
        shopify_variant_id: variant.id,
        shopify_inventory_item_id: variant.inventory_item_id,
        shopify_product_title: product.title,
        shopify_variant_title: variant.title,
      });
    }
  }
  logger.info({ products: products.length, variantsWithSku, variantsWithoutSku }, 'shopify index listo');
  return bySku;
}

async function run() {
  logger.info('seed sku_mapping: inicio');

  const meliIndex = await buildMeliIndex();
  logger.info({ meli_skus: meliIndex.size }, 'meli index listo (desde meli-sku-mapping.js)');

  const shopifyIndex = await buildShopifyIndex();

  const allSkus = new Set([...meliIndex.keys(), ...shopifyIndex.keys()]);
  const mappings = [];
  const stats = { both: 0, onlyMeli: 0, onlyShopify: 0 };

  for (const sku of allSkus) {
    const meli = meliIndex.get(sku);
    const shop = shopifyIndex.get(sku);
    if (meli && shop) stats.both++;
    else if (meli) stats.onlyMeli++;
    else stats.onlyShopify++;

    mappings.push({
      sku,
      shopifyVariantId: shop?.shopify_variant_id ?? null,
      shopifyInventoryItemId: shop?.shopify_inventory_item_id ?? null,
      mlItemId: meli?.ml_item_id ?? null,
      mlVariationId: meli?.ml_variation_id ?? null,
      falabellaSellerSku: sku,
      active: true,
      notes: shop ? `${shop.shopify_product_title} — ${shop.shopify_variant_title}` : null,
    });
  }

  logger.info({ total: mappings.length, ...stats }, 'mappings listos para upsert');

  const before = await repo.count();
  const written = await repo.bulkUpsert(mappings);
  const after = await repo.count();

  logger.info(
    { written: written.length, rows_before: before, rows_after: after, new_rows: after - before },
    'seed completado',
  );

  // Reportar SKUs sin link en alguna plataforma para revisión manual.
  const missingMl = mappings.filter((m) => !m.mlItemId).map((m) => m.sku);
  const missingShopify = mappings.filter((m) => !m.shopifyInventoryItemId).map((m) => m.sku);

  if (missingMl.length > 0) {
    logger.warn({ count: missingMl.length, sample: missingMl.slice(0, 10) }, 'SKUs sin link a ML');
  }
  if (missingShopify.length > 0) {
    logger.warn(
      { count: missingShopify.length, sample: missingShopify.slice(0, 10) },
      'SKUs sin link a Shopify (probablemente solo en ML)',
    );
  }
}

run()
  .then(() => closeDb())
  .then(() => process.exit(0))
  .catch(async (err) => {
    logger.error({ err: err.message, stack: err.stack }, 'seed falló');
    await closeDb().catch(() => {});
    process.exit(1);
  });
