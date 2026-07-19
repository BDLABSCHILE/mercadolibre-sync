/**
 * API JSON para consumo desde la Plataforma Valiz (la sección Promociones muestra
 * precios/stock por canal y cambia precios). Auth por X-Admin-Key (SYNC_ALL_SECRET),
 * igual que los demás /admin. Reusa loadSkuRows (mismos datos que el panel) y el
 * mecanismo de overrides.
 */
import express from 'express';
import { adminAuth } from '../middleware/admin-auth.js';
import { loadSkuRows } from './admin-ui.js';
import * as priceOverrideRepo from '../db/repositories/price-overrides.js';
import * as overrideCache from '../services/override-cache.js';
import { syncAllPricesFromShopify } from '../services/price-sync.js';
import { familyForSku } from '../services/price-override.js';
import { logger } from '../logger.js';

const router = express.Router();
router.use(express.json());
router.use(adminAuth);

function getClients(req) {
  return req.app.locals.clients;
}

/**
 * GET /admin/api/skus — precios y stock por canal (JSON). ?liveStock=1 para stock
 * en vivo de los marketplaces (más lento). Sin él, usa el último stock sincronizado.
 */
router.get('/skus', async (req, res, next) => {
  try {
    const liveStock = req.query.liveStock === '1' || req.query.liveStock === 'true';
    const rows = await loadSkuRows(getClients(req), { liveStock });
    res.json({ count: rows.length, liveStock, rows });
  } catch (err) {
    logger.error({ err: err.message }, 'GET /admin/api/skus failed');
    next(err);
  }
});

/**
 * POST /admin/api/override — fija el precio de un canal (crea un override 'absolute'
 * y dispara el sync). Body: { sku, platform: 'mercadolibre'|'falabella',
 * scope: 'sku'|'family', value: <precio exacto> }.
 * OJO ML: usar scope='family' (ML comparte precio entre variantes del mismo item).
 * Falabella: scope='sku' (están separados).
 */
router.post('/override', async (req, res, next) => {
  try {
    const b = req.body || {};
    const sku = String(b.sku || '').trim();
    if (!sku) return res.status(400).json({ error: 'sku requerido' });
    if (b.platform !== 'mercadolibre' && b.platform !== 'falabella') {
      return res.status(400).json({ error: "platform debe ser 'mercadolibre' o 'falabella'" });
    }
    const value = Number(b.value);
    if (!Number.isFinite(value) || value <= 0) {
      return res.status(400).json({ error: 'value debe ser un precio positivo' });
    }
    const scope = b.scope === 'family' ? 'family' : 'sku';
    const family = familyForSku(sku);

    const input = {
      scope,
      key: scope === 'family' ? family : sku,
      platform: b.platform,
      overrideType: 'absolute', // precio final exacto
      value: Math.round(value),
      validFrom: null,
      validUntil: null,
      note: b.note || 'Cambio de precio desde Promociones (plataforma)',
      createdBy: 'plataforma',
    };
    const created = await priceOverrideRepo.create(input);
    await overrideCache.invalidate();
    logger.info({ ...input, id: created.id }, 'override creado via plataforma');

    // Disparar el sync de precios acotado (sku o familia) y esperar el resumen.
    const clients = getClients(req);
    const syncOpts =
      scope === 'family'
        ? { skuPrefixes: [family + '-'], reason: 'plataforma_override_family' }
        : { skus: [sku], reason: 'plataforma_override_sku' };
    const summary = await syncAllPricesFromShopify(clients.shopify, clients, {
      dryRun: false,
      delayMs: 500,
      ...syncOpts,
    });

    res.json({
      ok: true,
      overrideId: created.id,
      scope,
      key: input.key,
      platform: b.platform,
      value: input.value,
      summary,
    });
  } catch (err) {
    logger.error({ err: err.message }, 'POST /admin/api/override failed');
    next(err);
  }
});

/**
 * POST /admin/api/override/clear — "vuelve a normal": desactiva los overrides
 * activos de un canal para un SKU (scope='sku') o familia (scope='family') y
 * re-sincroniza, con lo que el precio vuelve a la regla base (Shopify×1,3→990).
 * Body: { sku, platform:'mercadolibre'|'falabella', scope:'sku'|'family' }.
 */
router.post('/override/clear', async (req, res, next) => {
  try {
    const b = req.body || {};
    const sku = String(b.sku || '').trim();
    if (!sku) return res.status(400).json({ error: 'sku requerido' });
    if (b.platform !== 'mercadolibre' && b.platform !== 'falabella') {
      return res.status(400).json({ error: "platform debe ser 'mercadolibre' o 'falabella'" });
    }
    const scope = b.scope === 'family' ? 'family' : 'sku';
    const family = familyForSku(sku);
    const key = scope === 'family' ? family : sku;

    // Desactiva (soft-delete) todos los overrides activos de ese scope/key/canal.
    const activos = await priceOverrideRepo.listAll({ scope, key, platform: b.platform, activeOnly: true });
    let cleared = 0;
    for (const o of activos) {
      await priceOverrideRepo.softDelete(o.id);
      cleared += 1;
    }
    await overrideCache.invalidate();
    logger.info({ sku, platform: b.platform, scope, key, cleared }, 'override(s) reseteados via plataforma');

    // Re-sync acotado → el precio vuelve al markup (ya sin override).
    const clients = getClients(req);
    const syncOpts =
      scope === 'family'
        ? { skuPrefixes: [family + '-'], reason: 'plataforma_reset_family' }
        : { skus: [sku], reason: 'plataforma_reset_sku' };
    const summary = await syncAllPricesFromShopify(clients.shopify, clients, {
      dryRun: false,
      delayMs: 500,
      ...syncOpts,
    });

    res.json({ ok: true, cleared, scope, key, platform: b.platform, summary });
  } catch (err) {
    logger.error({ err: err.message }, 'POST /admin/api/override/clear failed');
    next(err);
  }
});

export default router;
