import * as repo from '../db/repositories/sku-mapping.js';
import { logger } from '../logger.js';

const TTL_MS = 60_000;

let cache = {
  bySku: new Map(),
  byMlVariation: new Map(),
  byFalabellaSellerSku: new Map(),
  byMlItem: new Map(),
  loadedAt: 0,
};

let loadingPromise = null;

async function load() {
  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    const start = Date.now();
    const rows = await repo.listAll({ activeOnly: true });
    const next = {
      bySku: new Map(),
      byMlVariation: new Map(),
      byFalabellaSellerSku: new Map(),
      byMlItem: new Map(),
      loadedAt: Date.now(),
    };
    for (const m of rows) {
      next.bySku.set(m.sku, m);
      if (m.mlVariationId) next.byMlVariation.set(m.mlVariationId, m);
      if (m.falabellaSellerSku) next.byFalabellaSellerSku.set(m.falabellaSellerSku, m);
      if (m.mlItemId) {
        const list = next.byMlItem.get(m.mlItemId) || [];
        list.push(m);
        next.byMlItem.set(m.mlItemId, list);
      }
    }
    cache = next;
    logger.debug({ count: rows.length, ms: Date.now() - start }, 'sku cache loaded');
    return cache;
  })();
  try {
    return await loadingPromise;
  } finally {
    loadingPromise = null;
  }
}

async function ensureFresh() {
  if (Date.now() - cache.loadedAt > TTL_MS) {
    await load();
  }
  return cache;
}

export async function getBySku(sku) {
  if (!sku) return null;
  const c = await ensureFresh();
  return c.bySku.get(String(sku).trim()) || null;
}

export async function getByMlVariation(variationId) {
  if (variationId == null) return null;
  const c = await ensureFresh();
  return c.byMlVariation.get(String(variationId)) || null;
}

export async function getByFalabellaSellerSku(sellerSku) {
  if (!sellerSku) return null;
  const c = await ensureFresh();
  return c.byFalabellaSellerSku.get(String(sellerSku).trim()) || null;
}

export async function getByMlItem(itemId) {
  if (!itemId) return [];
  const c = await ensureFresh();
  return c.byMlItem.get(String(itemId)) || [];
}

/**
 * Resolver determinístico para órdenes ML.
 * - Si hay variation_id: lookup directo. Devuelve { sku } o null.
 * - Si no hay variation_id: chequea cuántos SKUs tiene ese item.
 *   1 SKU → { sku } | múltiples → { sku: null, ambiguous: true } | 0 → null.
 */
export async function resolveFromMlOrderItem(itemId, variationId) {
  if (variationId != null && variationId !== '') {
    const m = await getByMlVariation(variationId);
    return m ? { sku: m.sku, mapping: m } : null;
  }
  const skus = await getByMlItem(itemId);
  if (skus.length === 1) return { sku: skus[0].sku, mapping: skus[0] };
  if (skus.length > 1) return { sku: null, ambiguous: true, candidates: skus.map((s) => s.sku) };
  return null;
}

export async function invalidate() {
  cache.loadedAt = 0;
}

export async function getStats() {
  await ensureFresh();
  return {
    total: cache.bySku.size,
    withMlVariation: cache.byMlVariation.size,
    withFalabellaSeller: cache.byFalabellaSellerSku.size,
    mlItems: cache.byMlItem.size,
    loadedAt: new Date(cache.loadedAt).toISOString(),
    ttlMs: TTL_MS,
  };
}
