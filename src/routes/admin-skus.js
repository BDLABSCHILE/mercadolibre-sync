import express from 'express';
import { z } from 'zod';
import * as repo from '../db/repositories/sku-mapping.js';
import * as cache from '../services/sku-cache.js';
import { adminAuth } from '../middleware/admin-auth.js';
import { logger } from '../logger.js';

const router = express.Router();

router.use(adminAuth);

const upsertSchema = z.object({
  sku: z.string().min(1).trim(),
  shopifyVariantId: z.union([z.string(), z.number()]).optional().nullable(),
  shopifyInventoryItemId: z.union([z.string(), z.number()]).optional().nullable(),
  mlItemId: z.string().optional().nullable(),
  mlVariationId: z.union([z.string(), z.number()]).optional().nullable(),
  falabellaSellerSku: z.string().optional().nullable(),
  active: z.boolean().optional(),
  notes: z.string().optional().nullable(),
});

/**
 * GET /admin/skus
 *   Query: ?active=0 incluye inactivos. ?stats=1 retorna stats del cache.
 */
router.get('/', async (req, res) => {
  try {
    if (req.query.stats === '1') {
      const stats = await cache.getStats();
      const total = await repo.count();
      return res.json({ db_total: total, cache: stats });
    }
    const activeOnly = req.query.active !== '0';
    const rows = await repo.listAll({ activeOnly });
    return res.json({ count: rows.length, items: rows });
  } catch (err) {
    logger.error({ err: err.message }, 'GET /admin/skus failed');
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /admin/skus/:sku
 */
router.get('/:sku', async (req, res) => {
  try {
    const m = await repo.findBySku(req.params.sku);
    if (!m) return res.status(404).json({ error: 'not found', sku: req.params.sku });
    return res.json(m);
  } catch (err) {
    logger.error({ err: err.message, sku: req.params.sku }, 'GET /admin/skus/:sku failed');
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /admin/skus
 *   Body: { sku, shopifyVariantId?, shopifyInventoryItemId?, mlItemId?,
 *           mlVariationId?, falabellaSellerSku?, active?, notes? }
 *   Upsert. Invalida cache.
 */
router.post('/', async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid body', issues: parsed.error.issues });
  }
  try {
    const m = await repo.upsert(parsed.data);
    await cache.invalidate();
    logger.info({ sku: m.sku }, 'sku mapping upserted via admin');
    return res.json(m);
  } catch (err) {
    logger.error({ err: err.message, body: req.body }, 'POST /admin/skus failed');
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /admin/skus/:sku/deactivate  → soft-delete (active=false)
 * POST /admin/skus/:sku/activate    → restaura
 */
router.post('/:sku/deactivate', async (req, res) => {
  try {
    const m = await repo.setActive(req.params.sku, false);
    if (!m) return res.status(404).json({ error: 'not found', sku: req.params.sku });
    await cache.invalidate();
    return res.json(m);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/:sku/activate', async (req, res) => {
  try {
    const m = await repo.setActive(req.params.sku, true);
    if (!m) return res.status(404).json({ error: 'not found', sku: req.params.sku });
    await cache.invalidate();
    return res.json(m);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /admin/skus/refresh-cache  → invalida cache in-memory (próxima lectura recarga).
 */
router.post('/refresh-cache', async (req, res) => {
  await cache.invalidate();
  return res.json({ ok: true, message: 'cache invalidated' });
});

export default router;
