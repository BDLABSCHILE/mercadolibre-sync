/**
 * Reconciliador periódico de stock.
 *
 * Shopify es fuente de verdad. Para cada SKU activo en sku_mapping:
 *   esperado_ml = max(0, stock_shopify - STOCK_OFFSET)
 *   esperado_fb = max(0, stock_shopify - STOCK_OFFSET_FALABELLA)
 *
 * Compara con el stock real en cada marketplace. Si difiere → auto-corrige.
 *
 * Eficiencia:
 *   - 1 sola llamada Shopify (getAllProducts paginado).
 *   - ML: 1 GET por ml_item_id (~10 calls para 103 SKUs en 10 familias).
 *   - Falabella: 1-2 GETs (getAllProducts paginado).
 *
 * Locks por SKU: si hay sync activo (venta procesándose), saltamos ese SKU y
 * lo reintentamos al próximo ciclo.
 */

import { config } from '../config.js';
import { logger } from '../logger.js';
import * as skuMappingRepo from '../db/repositories/sku-mapping.js';
import * as platformState from '../db/repositories/platform-state.js';
import * as locks from '../db/repositories/sku-locks.js';
import { query } from '../db/index.js';

const ML_PLATFORM = 'mercadolibre';
const FB_PLATFORM = 'falabella';

function calcMlStock(shopifyStock) {
  return Math.max(0, shopifyStock - config.STOCK_OFFSET);
}

function calcFbStock(shopifyStock) {
  return Math.max(0, shopifyStock - (config.STOCK_OFFSET_FALABELLA ?? config.STOCK_OFFSET));
}

/**
 * @param {{ shopify, meli, falabella }} clients
 * @param {{
 *   dryRun?: boolean,
 *   skus?: string[],
 *   delayMs?: number,
 *   skipMl?: boolean,
 *   skipFalabella?: boolean,
 * }} opts
 */
export async function reconcileStock(clients, opts = {}) {
  const dryRun = Boolean(opts.dryRun);
  const delayMs = opts.delayMs ?? 0;
  const skuFilter = (opts.skus || []).map((s) => String(s).trim().toUpperCase()).filter(Boolean);
  const startedAt = new Date();

  logger.info(
    { dryRun, skuFilterCount: skuFilter.length, skipMl: !!opts.skipMl, skipFb: !!opts.skipFalabella },
    'reconcile: inicio',
  );

  // 1) Cargar mappings activos
  const mappings = await skuMappingRepo.listAll({ activeOnly: true });
  const filteredMappings = skuFilter.length === 0
    ? mappings
    : mappings.filter((m) => skuFilter.includes(m.sku.toUpperCase()));
  logger.info({ totalMappings: mappings.length, afterFilter: filteredMappings.length }, 'reconcile: mappings cargados');

  // 2) Cargar stock Shopify (autoritativo desde inventory_levels, no el variant.inventory_quantity
  //    que tiene lag y haría reconciliar valores stale en un reconcile on-demand tras editar stock).
  const shopifyMap = new Map();
  try {
    const products = await clients.shopify.getAllProducts();
    // Mapear sku -> inventory_item_id y juntar los ids para leer niveles reales en lote.
    const skuToItemId = new Map();
    const itemIds = [];
    for (const p of products) {
      for (const v of p.variants || []) {
        const sku = (v.sku || '').trim();
        if (!sku) continue;
        if (v.inventory_item_id != null) {
          skuToItemId.set(sku, String(v.inventory_item_id));
          itemIds.push(v.inventory_item_id);
        }
        // Fallback inicial: variant.inventory_quantity (se reemplaza por el real más abajo si existe).
        shopifyMap.set(sku, Number.isFinite(v.inventory_quantity) ? v.inventory_quantity : 0);
      }
    }
    let realLevels = new Map();
    try {
      realLevels = await clients.shopify.getInventoryLevelsByItemIds(itemIds);
    } catch (errLvls) {
      logger.warn({ err: errLvls.message }, 'reconcile: no se pudieron leer inventory_levels, uso variant.inventory_quantity');
    }
    for (const [sku, itemId] of skuToItemId) {
      if (realLevels.has(itemId)) shopifyMap.set(sku, realLevels.get(itemId));
    }
  } catch (err) {
    logger.error({ err: err.message }, 'reconcile: error cargando Shopify');
    throw err;
  }
  logger.info({ shopifySkus: shopifyMap.size }, 'reconcile: Shopify cargado');

  // 3) Cargar stock ML por item (1 GET por ml_item_id)
  const mlStockBySku = new Map();
  if (!opts.skipMl) {
    const itemIds = [...new Set(filteredMappings.filter((m) => m.mlItemId).map((m) => m.mlItemId))];
    for (const itemId of itemIds) {
      try {
        const resp = await clients.meli.client.get(`/items/${itemId}`);
        const item = resp.data;
        if (item.variations && item.variations.length > 0) {
          for (const v of item.variations) {
            const m = filteredMappings.find((x) => String(x.mlVariationId) === String(v.id));
            if (m) mlStockBySku.set(m.sku, Number.isFinite(v.available_quantity) ? v.available_quantity : 0);
          }
        } else {
          const m = filteredMappings.find((x) => x.mlItemId === itemId && !x.mlVariationId);
          if (m) mlStockBySku.set(m.sku, Number.isFinite(item.available_quantity) ? item.available_quantity : 0);
        }
      } catch (err) {
        logger.warn({ itemId, err: err.message }, 'reconcile: error leyendo item ML');
      }
    }
    logger.info({ mlSkus: mlStockBySku.size }, 'reconcile: ML cargado');
  }

  // 4) Cargar stock Falabella
  const fbStockBySku = new Map();
  if (!opts.skipFalabella && clients.falabella) {
    try {
      const fbProducts = await clients.falabella.getAllProducts();
      for (const [sellerSku, info] of fbProducts) {
        if (info.stock != null) fbStockBySku.set(sellerSku, info.stock);
      }
      logger.info({ fbSkus: fbStockBySku.size }, 'reconcile: Falabella cargado');
    } catch (err) {
      logger.warn({ err: err.message }, 'reconcile: error cargando Falabella, se saltan correcciones FB');
    }
  }

  // 5) Comparar y corregir
  const summary = {
    dryRun,
    startedAt: startedAt.toISOString(),
    totalSkus: filteredMappings.length,
    shopifyMissing: 0,
    mlDriftFixed: 0,
    mlConsistent: 0,
    mlSkippedNoMapping: 0,
    mlSkippedLocked: 0,
    mlFailed: 0,
    fbDriftFixed: 0,
    fbConsistent: 0,
    fbSkippedNoMapping: 0,
    fbSkippedLocked: 0,
    fbFailed: 0,
    samples: [],
  };

  for (let i = 0; i < filteredMappings.length; i++) {
    const m = filteredMappings[i];
    const sku = m.sku;
    const shopStock = shopifyMap.get(sku);
    if (shopStock == null) {
      summary.shopifyMissing++;
      continue;
    }

    // ---- ML ----
    if (!opts.skipMl && m.mlItemId) {
      const expected = calcMlStock(shopStock);
      const actual = mlStockBySku.get(sku);
      if (actual == null) {
        summary.mlSkippedNoMapping++;
      } else if (actual === expected) {
        summary.mlConsistent++;
      } else {
        if (dryRun) {
          if (summary.samples.length < 30) {
            summary.samples.push({ sku, platform: 'mercadolibre', shopStock, expected, actual, drift: actual - expected });
          }
          summary.mlDriftFixed++;
        } else {
          const owner = locks.newOwnerId('reconciler-ml');
          const acq = await locks.acquire(sku, owner, 60);
          if (!acq.acquired) {
            summary.mlSkippedLocked++;
          } else {
            try {
              const ok = await clients.meli.updateStock(m.mlItemId, expected, m.mlVariationId ? Number(m.mlVariationId) : null);
              if (ok) {
                await platformState.setStock(sku, ML_PLATFORM, expected, 'reconciliation');
                await query(
                  `INSERT INTO stock_events (sku, platform, source, source_ref, delta, new_value, ok)
                   VALUES ($1, $2, 'reconciliation', 'reconcile', $3, $4, true)`,
                  [sku, ML_PLATFORM, expected - actual, expected],
                );
                logger.info({ sku, platform: 'mercadolibre', shopStock, expected, prev: actual }, 'reconcile: drift corregido');
                summary.mlDriftFixed++;
              } else {
                logger.warn({ sku }, 'reconcile ml: updateStock retornó false');
                summary.mlFailed++;
              }
            } catch (err) {
              logger.error({ sku, err: err.message }, 'reconcile ml: error');
              summary.mlFailed++;
            } finally {
              await locks.release(sku, owner).catch(() => {});
            }
          }
        }
      }
    }

    // ---- Falabella ----
    if (!opts.skipFalabella && clients.falabella && m.falabellaSellerSku) {
      const expected = calcFbStock(shopStock);
      const actual = fbStockBySku.get(m.falabellaSellerSku);
      if (actual == null) {
        summary.fbSkippedNoMapping++;
      } else if (actual === expected) {
        summary.fbConsistent++;
      } else {
        if (dryRun) {
          if (summary.samples.length < 30) {
            summary.samples.push({ sku, platform: 'falabella', shopStock, expected, actual, drift: actual - expected });
          }
          summary.fbDriftFixed++;
        } else {
          const owner = locks.newOwnerId('reconciler-fb');
          const acq = await locks.acquire(sku, owner, 60);
          if (!acq.acquired) {
            summary.fbSkippedLocked++;
          } else {
            try {
              await clients.falabella.updateStockBySKU(m.falabellaSellerSku, expected);
              await platformState.setStock(sku, FB_PLATFORM, expected, 'reconciliation');
              await query(
                `INSERT INTO stock_events (sku, platform, source, source_ref, delta, new_value, ok)
                 VALUES ($1, $2, 'reconciliation', 'reconcile', $3, $4, true)`,
                [sku, FB_PLATFORM, expected - actual, expected],
              );
              logger.info({ sku, platform: 'falabella', shopStock, expected, prev: actual }, 'reconcile: drift corregido');
              summary.fbDriftFixed++;
            } catch (err) {
              logger.error({ sku, err: err.message }, 'reconcile fb: error');
              summary.fbFailed++;
            } finally {
              await locks.release(sku, owner).catch(() => {});
            }
          }
        }
      }
    }

    if (delayMs > 0 && i < filteredMappings.length - 1) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
    if ((i + 1) % 25 === 0) {
      logger.info({ progress: `${i + 1}/${filteredMappings.length}` }, 'reconcile: progreso');
    }
  }

  summary.finishedAt = new Date().toISOString();
  summary.durationSec = Math.round((Date.now() - startedAt.getTime()) / 1000);
  logger.info(summary, 'reconcile: resumen');
  return summary;
}
