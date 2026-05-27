/**
 * Sincronización de precios Shopify → ML + Falabella.
 *
 * Reglas importantes de la API de ML:
 * - Cuando un item tiene `variations`, TODAS las variations deben tener el
 *   mismo precio. Si las actualizas una a una, ML rechaza con
 *   `item.variations.price.different`. Por eso usamos `PUT /items/{id}` con
 *   el array completo `{variations: [{id, price}, ...]}` en una sola llamada.
 *
 * Anti-loop por debounce de valor: si el target == last_synced_price, no
 * hacemos nada. Esto rompe ecos de webhooks (Shopify dispara products/update
 * tras cualquier write nuestro; nuestro target == último synced → no-op).
 */

import { logger } from '../logger.js';
import { priceForMarketplace, pricesEqual } from './price.js';
import * as platformState from '../db/repositories/platform-state.js';
import * as skuCache from './sku-cache.js';
import * as locks from '../db/repositories/sku-locks.js';

/**
 * Batch update de precios de las variations de un item ML.
 * Persiste last_synced_price para cada SKU exitoso.
 *
 * @param {string} itemId
 * @param {Array<{sku: string, mlVariationId: number|string, target: number}>} variants
 * @param {{ meli }} clients
 * @param {{ reason?: string, force?: boolean }} opts
 * @returns {Promise<{itemId, total, updated, unchanged, failed, results: Array}>}
 */
export async function syncMlItemPrices(itemId, variants, clients, opts = {}) {
  const reason = opts.reason || 'shopify_price';
  const result = { itemId, total: variants.length, updated: 0, unchanged: 0, failed: 0, results: [] };

  if (variants.length === 0) return result;

  // Filtrar variants cuyo target ya está sincronizado (debounce). Si TODOS están
  // synced, no llamamos a ML; si AL MENOS UNO cambió, mandamos todas (ML obliga
  // a que las variations compartan precio, así que la única forma segura es
  // mandar el array completo con el target deseado de cada una).
  const variantsWithState = [];
  let anyChanged = opts.force === true;
  for (const v of variants) {
    const state = await platformState.get(v.sku, 'mercadolibre');
    const prevPrice = state?.price ?? null;
    const changed = !pricesEqual(prevPrice, v.target);
    if (changed) anyChanged = true;
    variantsWithState.push({ ...v, prevPrice });
  }

  if (!anyChanged) {
    for (const v of variantsWithState) {
      result.unchanged++;
      result.results.push({ sku: v.sku, marketplace: 'mercadolibre', ok: true, reason: 'unchanged', price: v.target });
    }
    logger.debug({ itemId, count: variants.length }, 'ml item: todos los variants ya sincronizados, skip');
    return result;
  }

  // Si hay targets distintos entre variations, ML rechaza. Usamos el max y
  // log warning para que el usuario lo sepa (asunción: variations hermanas
  // deberían tener el mismo precio Shopify; si no, hay drift en el catálogo).
  const targets = variants.map((v) => v.target);
  const maxTarget = Math.max(...targets);
  const allSame = targets.every((t) => t === maxTarget);
  if (!allSame) {
    logger.warn(
      { itemId, targets, chosen: maxTarget, skus: variants.map((v) => v.sku) },
      'ml item: variations con targets distintos; uso el max para satisfacer regla ML',
    );
  }

  const payload = variantsWithState.map((v) => ({ id: Number(v.mlVariationId), price: maxTarget }));

  try {
    const ok = await clients.meli.updateItemVariationsPrices(itemId, payload);
    if (!ok) throw new Error('updateItemVariationsPrices returned false');

    // Persistir last_synced_price para cada SKU del grupo.
    for (const v of variantsWithState) {
      await platformState.setPrice(v.sku, 'mercadolibre', maxTarget, reason);
      logger.info(
        { sku: v.sku, itemId, prev: v.prevPrice, target: maxTarget, reason },
        'ml price actualizado (batch)',
      );
      result.updated++;
      result.results.push({
        sku: v.sku, marketplace: 'mercadolibre', ok: true,
        prevPrice: v.prevPrice, price: maxTarget,
      });
    }
  } catch (err) {
    logger.error({ itemId, err: err.message, skus: variants.map((v) => v.sku) }, 'ml batch update falló');
    for (const v of variantsWithState) {
      result.failed++;
      result.results.push({
        sku: v.sku, marketplace: 'mercadolibre', ok: false,
        reason: 'error', error: err.message,
      });
    }
  }

  return result;
}

/**
 * Sincroniza Falabella para un SKU (single, con lock y debounce).
 */
async function syncFalabellaForSku({ sku, target, mapping, clients, reason, force }) {
  try {
    const state = await platformState.get(sku, 'falabella');
    if (!force && state && pricesEqual(state.price, target)) {
      logger.debug({ sku, target }, 'falabella price already synced, skip');
      return { marketplace: 'falabella', ok: true, reason: 'unchanged', price: target };
    }
    await locks.withLock(sku, async () => {
      await clients.falabella.updatePriceBySKU(mapping.falabellaSellerSku, target);
      await platformState.setPrice(sku, 'falabella', target, reason);
    });
    logger.info(
      { sku, platform: 'falabella', prev: state?.price ?? null, target, reason },
      'falabella price actualizado',
    );
    return { marketplace: 'falabella', ok: true, prevPrice: state?.price ?? null, price: target };
  } catch (err) {
    logger.error({ sku, platform: 'falabella', err: err.message }, 'error actualizando precio falabella');
    return { marketplace: 'falabella', ok: false, reason: 'error', error: err.message };
  }
}

/**
 * Sincroniza precio de UN SKU.
 *
 * Para items ML con variations: actualiza TODAS las variations del item al
 * mismo target (necesario por la regla de ML). El target se calcula a partir
 * del shopifyPrice del SKU recibido y se aplica a todas las hermanas.
 *
 * Limitación conocida: si las hermanas tienen distintos precios en Shopify,
 * este flujo igualará todas al target del SKU recibido. El barrido masivo
 * (syncAllPricesFromShopify) hace lo correcto leyendo el precio real de cada
 * variation.
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
    if (mapping.mlVariationId) {
      // Item con variations: hay que actualizar TODAS al mismo target.
      const siblings = await skuCache.getByMlItem(mapping.mlItemId);
      const variants = siblings.map((s) => ({
        sku: s.sku,
        mlVariationId: s.mlVariationId,
        target, // asumimos hermanas mismo target. Caso edge documentado arriba.
      }));
      const mlRes = await syncMlItemPrices(mapping.mlItemId, variants, clients, { reason, force: opts.force });
      // Buscar el resultado del SKU específico
      const myRes = mlRes.results.find((r) => r.sku === sku) || { marketplace: 'mercadolibre', ok: false, reason: 'missing_in_batch' };
      out.results.push(myRes);
    } else {
      // Item sin variations: PUT directo al item.
      try {
        const state = await platformState.get(sku, 'mercadolibre');
        if (!opts.force && state && pricesEqual(state.price, target)) {
          out.results.push({ marketplace: 'mercadolibre', ok: true, reason: 'unchanged', price: target });
        } else {
          await locks.withLock(sku, async () => {
            const ok = await clients.meli.updateItemPrice(mapping.mlItemId, target);
            if (!ok) throw new Error('updateItemPrice returned false');
            await platformState.setPrice(sku, 'mercadolibre', target, reason);
          });
          logger.info({ sku, platform: 'mercadolibre', prev: state?.price ?? null, target, reason }, 'ml price actualizado (item sin variations)');
          out.results.push({ marketplace: 'mercadolibre', ok: true, prevPrice: state?.price ?? null, price: target });
        }
      } catch (err) {
        logger.error({ sku, err: err.message }, 'error actualizando ml item');
        out.results.push({ marketplace: 'mercadolibre', ok: false, reason: 'error', error: err.message });
      }
    }
  } else {
    out.results.push({ marketplace: 'mercadolibre', ok: false, reason: 'no_ml_link' });
  }

  // ---- Falabella ----
  if (clients.falabella && !opts.skipFalabella && mapping.falabellaSellerSku) {
    out.results.push(await syncFalabellaForSku({ sku, target, mapping, clients, reason, force: opts.force }));
  }

  return out;
}

/**
 * Sincroniza precios de todas las variantes de un producto Shopify.
 * Útil desde el webhook products/update.
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

/**
 * Barrido general de precios desde Shopify.
 * Agrupa SKUs por ml_item_id para batch update (regla ML).
 */
export async function syncAllPricesFromShopify(shopifyClient, clients, opts = {}) {
  const dryRun = Boolean(opts.dryRun);
  const onlyWithMlMapping = opts.onlyWithMlMapping !== false;
  const delayMs = opts.delayMs ?? 500;
  const reason = opts.reason || 'sync_all_prices';
  const skuFilter = (opts.skus || []).map((s) => String(s).trim().toUpperCase()).filter(Boolean);
  const prefixes = (opts.skuPrefixes || []).map((s) => String(s).trim().toUpperCase()).filter(Boolean);

  logger.info(
    { dryRun, onlyWithMlMapping, delayMs, skuFilterCount: skuFilter.length, prefixCount: prefixes.length },
    'sync-all-prices: inicio',
  );

  const products = await shopifyClient.getAllProducts();
  logger.info({ products: products.length }, 'sync-all-prices: productos Shopify cargados');

  // 1) Extraer items con SKU + precio válido (aplica filtros).
  const items = [];
  for (const product of products) {
    for (const v of product.variants || []) {
      const sku = (v.sku || '').trim();
      if (!sku) continue;
      const upper = sku.toUpperCase();
      if (skuFilter.length > 0 && !skuFilter.includes(upper)) continue;
      if (prefixes.length > 0 && !prefixes.some((p) => upper.startsWith(p))) continue;
      const priceNum = Number(v.price);
      if (!Number.isFinite(priceNum) || priceNum <= 0) continue;
      items.push({ sku, shopifyPrice: priceNum, productTitle: product.title, variantTitle: v.title });
    }
  }

  logger.info({ items: items.length }, 'sync-all-prices: items con SKU+precio válido');

  const summary = {
    dryRun, total: items.length,
    updatedMl: 0, unchangedMl: 0, failedMl: 0, skippedMl: 0,
    updatedFb: 0, unchangedFb: 0, failedFb: 0, skippedFb: 0,
    skippedNoMapping: 0,
    mlItemsProcessed: 0,
    samples: [],
  };

  // 2) Agrupar por ml_item_id. Items sin mlItemId quedan en "noMl" para Falabella-only.
  const byMlItem = new Map(); // mlItemId → [{sku, shopifyPrice, target, mlVariationId, mapping}]
  const noMl = [];            // [{sku, shopifyPrice, target, mapping}]

  for (const item of items) {
    const mapping = await skuCache.getBySku(item.sku);
    if (!mapping) {
      summary.skippedNoMapping++;
      continue;
    }
    const target = priceForMarketplace(item.shopifyPrice);
    if (target == null) continue;

    const entry = { ...item, target, mapping };
    if (mapping.mlItemId) {
      const list = byMlItem.get(mapping.mlItemId) || [];
      list.push(entry);
      byMlItem.set(mapping.mlItemId, list);
    } else {
      if (onlyWithMlMapping && !mapping.falabellaSellerSku) {
        // sin ML ni Falabella: no hay nada que hacer
      }
      noMl.push(entry);
    }
  }

  if (dryRun) {
    // Reportar willChange por marketplace usando platform_state.
    for (const [mlItemId, group] of byMlItem) {
      for (const e of group) {
        const stateMl = await platformState.get(e.sku, 'mercadolibre');
        const willChangeMl = !pricesEqual(stateMl?.price, e.target);
        let willChangeFb = false;
        let hasFb = Boolean(e.mapping.falabellaSellerSku);
        if (hasFb) {
          const stateFb = await platformState.get(e.sku, 'falabella');
          willChangeFb = !pricesEqual(stateFb?.price, e.target);
        }
        if (summary.samples.length < 20) {
          summary.samples.push({
            sku: e.sku, productTitle: e.productTitle, variantTitle: e.variantTitle,
            shopifyPrice: e.shopifyPrice, target: e.target,
            ml: { mapped: true, lastSynced: stateMl?.price ?? null, willChange: willChangeMl },
            falabella: { mapped: hasFb, lastSynced: null, willChange: willChangeFb },
          });
        }
        willChangeMl ? summary.updatedMl++ : summary.unchangedMl++;
        if (hasFb) (willChangeFb ? summary.updatedFb++ : summary.unchangedFb++); else summary.skippedFb++;
      }
    }
    for (const e of noMl) {
      summary.skippedMl++;
      const hasFb = Boolean(e.mapping.falabellaSellerSku);
      if (hasFb) {
        const stateFb = await platformState.get(e.sku, 'falabella');
        const willChangeFb = !pricesEqual(stateFb?.price, e.target);
        willChangeFb ? summary.updatedFb++ : summary.unchangedFb++;
      } else {
        summary.skippedFb++;
      }
    }
    logger.info(summary, 'sync-all-prices: dry-run resumen');
    return summary;
  }

  // 3) Procesar ML por item (batch). Luego procesar Falabella SKU por SKU.
  const allFalabellaItems = []; // recolección para procesar al final con delays

  for (const [mlItemId, group] of byMlItem) {
    const variantsForMl = group.map((e) => ({
      sku: e.sku, mlVariationId: e.mapping.mlVariationId, target: e.target,
    }));

    try {
      const mlRes = await syncMlItemPrices(mlItemId, variantsForMl, clients, { reason });
      summary.mlItemsProcessed++;
      summary.updatedMl += mlRes.updated;
      summary.unchangedMl += mlRes.unchanged;
      summary.failedMl += mlRes.failed;
    } catch (err) {
      logger.error({ mlItemId, err: err.message }, 'sync-all-prices: error en batch ML');
      summary.failedMl += group.length;
    }

    // Recolectar Falabella de este grupo
    for (const e of group) {
      if (clients.falabella && e.mapping.falabellaSellerSku) {
        allFalabellaItems.push(e);
      } else {
        summary.skippedFb++;
      }
    }

    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  }

  // Items sin ML: solo Falabella (si tienen)
  for (const e of noMl) {
    summary.skippedMl++;
    if (clients.falabella && e.mapping.falabellaSellerSku) {
      allFalabellaItems.push(e);
    } else {
      summary.skippedFb++;
    }
  }

  // 4) Procesar Falabella SKU por SKU con delay (rate-limit friendly).
  for (let i = 0; i < allFalabellaItems.length; i++) {
    const e = allFalabellaItems[i];
    const r = await syncFalabellaForSku({
      sku: e.sku, target: e.target, mapping: e.mapping, clients, reason,
    });
    if (r.ok && r.reason === 'unchanged') summary.unchangedFb++;
    else if (r.ok) summary.updatedFb++;
    else summary.failedFb++;

    if ((i + 1) % 25 === 0) {
      logger.info({ progress: `fb ${i + 1}/${allFalabellaItems.length}`, sku: e.sku }, 'sync-all-prices: progreso falabella');
    }
    if (delayMs > 0 && i < allFalabellaItems.length - 1) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  logger.info(summary, 'sync-all-prices: resumen');
  return summary;
}
