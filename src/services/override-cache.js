/**
 * Cache in-memory de price_overrides activos.
 *
 * Carga TODOS los overrides activos al primer uso y los indexa para lookup O(1)
 * por (sku, platform) y (family, platform). TTL 60s. Invalidable manualmente.
 *
 * Volumen esperado: pocas decenas de overrides activos. Cachear todo es trivial.
 */

import * as repo from '../db/repositories/price-overrides.js';
import { logger } from '../logger.js';
import { familyForSku } from './price-override.js';

const TTL_MS = 60_000;

let state = {
  byKeyPlatform: new Map(), // key = `${scope}:${key}:${platform}` → override (último por activo más reciente)
  all: [],
  loadedAt: 0,
};
let loadingPromise = null;

async function load() {
  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    const start = Date.now();
    const rows = await repo.listAll({ activeOnly: true });
    const map = new Map();
    const now = Date.now();
    for (const o of rows) {
      // descartar fuera de vigencia
      if (o.validFrom && new Date(o.validFrom).getTime() > now) continue;
      if (o.validUntil && new Date(o.validUntil).getTime() <= now) continue;
      const k = `${o.scope}:${o.key}:${o.platform}`;
      // Si hay 2+ del mismo key/platform/scope, conservar el más reciente
      const prev = map.get(k);
      if (!prev || new Date(o.createdAt).getTime() > new Date(prev.createdAt).getTime()) {
        map.set(k, o);
      }
    }
    state = { byKeyPlatform: map, all: [...map.values()], loadedAt: Date.now() };
    logger.debug({ count: state.all.length, ms: Date.now() - start }, 'override cache loaded');
    return state;
  })();
  try {
    return await loadingPromise;
  } finally {
    loadingPromise = null;
  }
}

async function ensureFresh() {
  if (Date.now() - state.loadedAt > TTL_MS) {
    await load();
  }
  return state;
}

/**
 * Trae los overrides activos+vigentes que aplican a (sku, platform). Array
 * (puede tener varios: sku-platform, sku-all, family-platform, family-all).
 *
 * @param {string} sku
 * @param {string} platform - 'mercadolibre' | 'falabella'
 */
export async function findActiveFor(sku, platform) {
  if (!sku || !platform) return [];
  await ensureFresh();
  const family = familyForSku(sku);
  const candidates = [
    `sku:${sku}:${platform}`,
    `sku:${sku}:all`,
  ];
  if (family) {
    candidates.push(`family:${family}:${platform}`);
    candidates.push(`family:${family}:all`);
  }
  const out = [];
  for (const k of candidates) {
    const o = state.byKeyPlatform.get(k);
    if (o) out.push(o);
  }
  return out;
}

export async function getStats() {
  await ensureFresh();
  return {
    total: state.all.length,
    loadedAt: new Date(state.loadedAt).toISOString(),
    ttlMs: TTL_MS,
    bySkuPlatform: state.all.filter((o) => o.scope === 'sku' && o.platform !== 'all').length,
    bySkuAll: state.all.filter((o) => o.scope === 'sku' && o.platform === 'all').length,
    byFamilyPlatform: state.all.filter((o) => o.scope === 'family' && o.platform !== 'all').length,
    byFamilyAll: state.all.filter((o) => o.scope === 'family' && o.platform === 'all').length,
  };
}

export async function invalidate() {
  state.loadedAt = 0;
}
