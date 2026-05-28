import express from 'express';
import { z } from 'zod';
import * as repo from '../db/repositories/price-overrides.js';
import * as cache from '../services/override-cache.js';
import * as skuCache from '../services/sku-cache.js';
import { effectiveTargetForSku } from '../services/price-sync.js';
import { adminAuth } from '../middleware/admin-auth.js';
import { logger } from '../logger.js';

const router = express.Router();
router.use(adminAuth);

const OVERRIDE_TYPES = ['absolute', 'discount_fixed', 'discount_percent', 'custom_markup'];
const PLATFORMS = ['mercadolibre', 'falabella', 'all'];
const SCOPES = ['sku', 'family'];

const createSchema = z.object({
  scope: z.enum(SCOPES),
  key: z.string().min(1).trim(),
  platform: z.enum(PLATFORMS),
  overrideType: z.enum(OVERRIDE_TYPES),
  value: z.number().finite(),
  validFrom: z.string().datetime().optional().nullable(),
  validUntil: z.string().datetime().optional().nullable(),
  note: z.string().optional().nullable(),
  active: z.boolean().optional(),
  createdBy: z.string().optional().nullable(),
});

const updateSchema = createSchema.partial();

/**
 * GET /admin/price-overrides
 *   Query: ?active=1 (default true) | ?scope=sku | ?key=B-M-NE | ?platform=mercadolibre
 *   ?stats=1 retorna stats del cache + count DB
 */
router.get('/', async (req, res) => {
  try {
    if (req.query.stats === '1') {
      const stats = await cache.getStats();
      const total = await repo.count(false);
      const active = await repo.count(true);
      return res.json({ db_total: total, db_active: active, cache: stats });
    }
    const opts = {};
    if (req.query.scope) opts.scope = req.query.scope;
    // OJO: NO usar req.query.key como filtro — choca con ?key= del auth.
    // Para filtrar por valor de key, usar ?filterKey=...
    if (req.query.filterKey) opts.key = req.query.filterKey;
    if (req.query.platform) opts.platform = req.query.platform;
    opts.activeOnly = req.query.active !== '0';
    const items = await repo.listAll(opts);
    return res.json({ count: items.length, items });
  } catch (err) {
    logger.error({ err: err.message }, 'GET /admin/price-overrides failed');
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /admin/price-overrides/preview?sku=B-M-NE&shopifyPrice=47990
 *   Devuelve el precio efectivo en cada plataforma con qué override aplicó.
 *   Útil para validar antes de crear/modificar un override.
 */
router.get('/preview', async (req, res) => {
  try {
    const { sku } = req.query;
    if (!sku) return res.status(400).json({ error: 'sku requerido' });
    let shopifyPrice = req.query.shopifyPrice ? Number(req.query.shopifyPrice) : null;

    // Si no se pasa shopifyPrice, intentar leerlo desde la última sync conocida
    // (vía notes del mapping o platform_state) — por simplicidad, requerimos el price.
    if (shopifyPrice == null || !Number.isFinite(shopifyPrice) || shopifyPrice <= 0) {
      return res.status(400).json({ error: 'shopifyPrice numérico positivo requerido para preview' });
    }

    const mapping = await skuCache.getBySku(String(sku).trim());
    if (!mapping) return res.status(404).json({ error: 'sku no encontrado en sku_mapping' });

    const mlEff = await effectiveTargetForSku(sku, shopifyPrice, 'mercadolibre');
    const fbEff = await effectiveTargetForSku(sku, shopifyPrice, 'falabella');

    return res.json({
      sku,
      shopifyPrice,
      targetBase: mlEff.base,
      mercadolibre: {
        target: mlEff.target,
        override: mlEff.override ? {
          id: mlEff.override.id,
          scope: mlEff.override.scope,
          key: mlEff.override.key,
          type: mlEff.override.overrideType,
          value: mlEff.override.value,
          note: mlEff.override.note,
        } : null,
      },
      falabella: {
        target: fbEff.target,
        override: fbEff.override ? {
          id: fbEff.override.id,
          scope: fbEff.override.scope,
          key: fbEff.override.key,
          type: fbEff.override.overrideType,
          value: fbEff.override.value,
          note: fbEff.override.note,
        } : null,
      },
    });
  } catch (err) {
    logger.error({ err: err.message }, 'GET preview failed');
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /admin/price-overrides/:id
 */
router.get('/:id(\\d+)', async (req, res) => {
  try {
    const m = await repo.getById(Number(req.params.id));
    if (!m) return res.status(404).json({ error: 'not found' });
    return res.json(m);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /admin/price-overrides
 *   Crea un nuevo override. Body: { scope, key, platform, overrideType, value,
 *   validFrom?, validUntil?, note?, active?, createdBy? }
 */
router.post('/', async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid body', issues: parsed.error.issues });
  }
  try {
    const created = await repo.create(parsed.data);
    await cache.invalidate();
    logger.info({ id: created.id, scope: created.scope, key: created.key, platform: created.platform }, 'price override creado');
    return res.json(created);
  } catch (err) {
    logger.error({ err: err.message }, 'POST /admin/price-overrides failed');
    return res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /admin/price-overrides/:id
 *   Update parcial. Solo los campos provistos se modifican.
 */
router.patch('/:id(\\d+)', async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid body', issues: parsed.error.issues });
  }
  try {
    const updated = await repo.update(Number(req.params.id), parsed.data);
    if (!updated) return res.status(404).json({ error: 'not found' });
    await cache.invalidate();
    logger.info({ id: updated.id }, 'price override actualizado');
    return res.json(updated);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /admin/price-overrides/:id
 *   Soft-delete: active = false.
 */
router.delete('/:id(\\d+)', async (req, res) => {
  try {
    const out = await repo.softDelete(Number(req.params.id));
    if (!out) return res.status(404).json({ error: 'not found' });
    await cache.invalidate();
    logger.info({ id: out.id }, 'price override soft-deleted');
    return res.json(out);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /admin/price-overrides/refresh-cache
 *   Invalida cache in-memory. Próxima lectura recarga.
 */
router.post('/refresh-cache', async (req, res) => {
  await cache.invalidate();
  return res.json({ ok: true });
});

export default router;
