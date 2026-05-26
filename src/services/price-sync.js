/**
 * Sincronización de precios Shopify → ML + Falabella.
 *
 * Para un SKU dado:
 *   1. Resolver mapping (DB cache).
 *   2. Calcular precio target = round_up_to_990(shopifyPrice * 1.3).
 *   3. Por cada marketplace habilitado:
 *      a. Comparar con last_synced_price (DB).
 *      b. Si difiere → actualizar el marketplace (con lock por SKU).
 *      c. Persistir last_synced_price.
 *
 * Anti-loop por debounce de valor: si el precio target == last_synced_price, no
 * hace nada. Esto rompe ecos de webhooks (Shopify dispara products/update tras
 * cualquier write nuestro, pero nuestro target == último synced → no-op).
 */

import { logger } from '../logger.js';
import { priceForMarketplace, pricesEqual } from './price.js';
import * as platformState from '../db/repositories/platform-state.js';
import * as skuCache from './sku-cache.js';
import * as locks from '../db/repositories/sku-locks.js';

/**
 * Sincroniza precio de un SKU a los marketplaces habilitados.
 * @param {string} sku
 * @param {number} shopifyPrice
 * @param {{ meli, falabella }} clients
 * @param {{ reason?: string, force?: boolean, skipFalabella?: boolean }} opts
 * @returns {Promise<{sku, target, results: Array<{marketplace, ok, prevPrice?, reason?, error?}>}>}
 */
export async function syncPriceForSku(sku, shopifyPrice, clients, opts = {}) {
  const target = priceForMarketplace(shopifyPrice);
  const reason = opts.reason || 'shopify_price';
  const out = { sku, shopifyPrice, target, results: [] };

  if (target == null) {
    logger.warn({ sku, shopifyPrice }, 'precio target inválido, skip');
    out.results.push({ marketplace: 'all', ok: false, reason: 'invalid_target' });
    return out;
  }

  const mapping = await skuCache.getBySku(sku);
  if (!mapping) {
    logger.warn({ sku }, 'SKU sin mapping en DB, skip price sync');
    out.results.push({ marketplace: 'all', ok: false, reason: 'no_mapping' });
    return out;
  }

  // ---- MercadoLibre ----
  if (mapping.mlItemId) {
    out.results.push(await syncOne({
      sku, target, mapping, platform: 'mercadolibre', reason, force: opts.force,
      update: async () => clients.meli.updatePrice(
        mapping.mlItemId, target,
        mapping.mlVariationId ? Number(mapping.mlVariationId) : null,
      ),
    }));
  } else {
    logger.debug({ sku }, 'sin ml_item_id, skip ML price sync');
    out.results.push({ marketplace: 'mercadolibre', ok: false, reason: 'no_ml_link' });
  }

  // ---- Falabella ----
  if (clients.falabella && !opts.skipFalabella && mapping.falabellaSellerSku) {
    out.results.push(await syncOne({
      sku, target, mapping, platform: 'falabella', reason, force: opts.force,
      update: async () => {
        await clients.falabella.updatePriceBySKU(mapping.falabellaSellerSku, target);
        return true;
      },
    }));
  }

  return out;
}

async function syncOne({ sku, target, platform, reason, force, update }) {
  try {
    const state = await platformState.get(sku, platform);
    if (!force && state && pricesEqual(state.price, target)) {
      logger.debug({ sku, platform, target }, 'price already synced, skip');
      return { marketplace: platform, ok: true, reason: 'unchanged', price: target };
    }

    await locks.withLock(sku, async () => {
      const ok = await update();
      if (!ok) throw new Error(`${platform}.updatePrice returned false`);
      await platformState.setPrice(sku, platform, target, reason);
    });

    logger.info(
      { sku, platform, prev: state?.price ?? null, target, reason },
      'price actualizado',
    );
    return { marketplace: platform, ok: true, prevPrice: state?.price ?? null, price: target };
  } catch (err) {
    logger.error({ sku, platform, err: err.message }, 'error actualizando precio');
    return { marketplace: platform, ok: false, reason: 'error', error: err.message };
  }
}

/**
 * Sincroniza precios de TODAS las variantes de un producto Shopify.
 * Útil desde el webhook products/update.
 *
 * @param {object} product - payload products/update de Shopify
 * @param {{ meli, falabella }} clients
 * @param {{ reason?: string }} opts
 */
export async function syncPriceForShopifyProduct(product, clients, opts = {}) {
  if (!product || !Array.isArray(product.variants)) {
    return { product_id: product?.id, results: [] };
  }
  const results = [];
  for (const v of product.variants) {
    const sku = (v.sku || '').trim();
    if (!sku) continue;
    const priceNum = Number(v.price);
    if (!Number.isFinite(priceNum) || priceNum <= 0) continue;
    const r = await syncPriceForSku(sku, priceNum, clients, opts);
    results.push(r);
  }
  return { product_id: product.id, product_title: product.title, results };
}
