/**
 * Router del dashboard UI HTML.
 * Server-rendered con HTMX para interactividad.
 */

import express from 'express';
import { uiAuth } from '../middleware/ui-auth.js';
import { layout } from '../ui/layout.js';
import * as views from '../ui/views.js';
import * as skuMappingRepo from '../db/repositories/sku-mapping.js';
import * as platformState from '../db/repositories/platform-state.js';
import * as priceOverrideRepo from '../db/repositories/price-overrides.js';
import * as overrideCache from '../services/override-cache.js';
import * as skuCache from '../services/sku-cache.js';
import { priceForMarketplace } from '../services/price.js';
import { effectiveTargetForSku, syncAllPricesFromShopify } from '../services/price-sync.js';
import { reconcileStock } from '../services/reconciler.js';
import { familyForSku, pickOverride } from '../services/price-override.js';
import { logger } from '../logger.js';

const router = express.Router();
router.use(express.urlencoded({ extended: true }));
router.use(uiAuth);

// Acceso a clients via locals (los inyectamos desde webhook-server.js).
function getClients(req) {
  return req.app.locals.clients;
}

/**
 * Carga el conjunto de filas para la tabla principal. Hace 1 llamada a Shopify
 * (paginada) + lectura completa de mappings + platform_state + overrides.
 */
async function loadSkuRows(clients, filters = {}) {
  const mappings = await skuMappingRepo.listAll({ activeOnly: true });

  // Mapa SKU → shopifyPrice (1 llamada paginada)
  const products = await clients.shopify.getAllProducts();
  const shopifyMap = new Map();
  const titleMap = new Map();
  for (const p of products) {
    for (const v of p.variants || []) {
      const sku = (v.sku || '').trim();
      if (!sku) continue;
      const price = Number(v.price);
      shopifyMap.set(sku, Number.isFinite(price) ? price : null);
      titleMap.set(sku, p.title);
    }
  }

  // Cargar overrides activos en cache una vez para todo el barrido
  await overrideCache.invalidate(); // forzar fresh para datos consistentes

  const rows = [];
  for (const m of mappings) {
    const shopifyPrice = shopifyMap.get(m.sku);
    if (shopifyPrice == null) continue;

    const family = familyForSku(m.sku);
    const targetBase = priceForMarketplace(shopifyPrice);
    const mlEff = m.mlItemId ? await effectiveTargetForSku(m.sku, shopifyPrice, 'mercadolibre') : { target: null, override: null };
    const fbEff = m.falabellaSellerSku ? await effectiveTargetForSku(m.sku, shopifyPrice, 'falabella') : { target: null, override: null };
    const mlState = await platformState.get(m.sku, 'mercadolibre');
    const fbState = await platformState.get(m.sku, 'falabella');

    rows.push({
      sku: m.sku,
      family,
      productTitle: titleMap.get(m.sku) || m.notes,
      shopifyPrice,
      targetBase,
      targetMl: mlEff.target,
      mlOverride: mlEff.override,
      mlSynced: mlState?.price ?? null,
      targetFb: fbEff.target,
      fbOverride: fbEff.override,
      fbSynced: fbState?.price ?? null,
    });
  }

  // Filtros
  const search = (filters.search || '').trim().toLowerCase();
  const family = (filters.family || '').trim();
  const hasOverride = filters.hasOverride;
  const hasDrift = filters.hasDrift;

  return rows.filter((r) => {
    if (search) {
      const haystack = `${r.sku} ${r.productTitle || ''}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    if (family && r.family !== family) return false;
    if (hasOverride === 'yes' && !(r.mlOverride || r.fbOverride)) return false;
    if (hasOverride === 'no' && (r.mlOverride || r.fbOverride)) return false;
    if (hasDrift === 'yes') {
      const ml = r.targetMl != null && r.mlSynced != null && r.targetMl !== r.mlSynced;
      const fb = r.targetFb != null && r.fbSynced != null && r.targetFb !== r.fbSynced;
      if (!ml && !fb) return false;
    }
    return true;
  });
}

/**
 * GET /admin/ui — página principal
 */
router.get('/', async (req, res, next) => {
  try {
    const filters = {
      search: req.query.search,
      family: req.query.family,
      hasOverride: req.query.hasOverride,
      hasDrift: req.query.hasDrift,
    };
    const rows = await loadSkuRows(getClients(req), filters);
    const content = views.skusTable(rows, filters);
    res.type('html').send(layout({ title: 'SKUs', content, active: 'skus' }));
  } catch (err) { next(err); }
});

/**
 * GET /admin/ui/skus — endpoint HTMX para refresh de tabla con filtros
 */
router.get('/skus', async (req, res, next) => {
  try {
    const filters = {
      search: req.query.search,
      family: req.query.family,
      hasOverride: req.query.hasOverride,
      hasDrift: req.query.hasDrift,
    };
    const rows = await loadSkuRows(getClients(req), filters);
    res.type('html').send(views.skusTableInner(rows));
  } catch (err) { next(err); }
});

/**
 * GET /admin/ui/skus/:sku/edit — modal de edición de overrides
 */
router.get('/skus/:sku/edit', async (req, res, next) => {
  try {
    const sku = req.params.sku;
    const m = await skuMappingRepo.findBySku(sku);
    if (!m) return res.status(404).send('SKU no encontrado');

    const products = await getClients(req).shopify.getAllProducts();
    let shopifyPrice = null;
    let productTitle = null;
    for (const p of products) {
      for (const v of p.variants || []) {
        if ((v.sku || '').trim() === sku) {
          shopifyPrice = Number(v.price);
          productTitle = p.title;
        }
      }
    }

    const family = familyForSku(sku);
    const targetBase = priceForMarketplace(shopifyPrice);
    const mlEff = m.mlItemId ? await effectiveTargetForSku(sku, shopifyPrice, 'mercadolibre') : { target: null, override: null };
    const fbEff = m.falabellaSellerSku ? await effectiveTargetForSku(sku, shopifyPrice, 'falabella') : { target: null, override: null };

    // Contar hermanas en el item ML (importante: ML obliga a precio común
    // entre variants del mismo item). Si hay >1, un override scope=sku solo
    // surte efecto en Falabella.
    let mlSiblingsCount = 0;
    if (m.mlItemId) {
      const siblings = await skuCache.getByMlItem(m.mlItemId);
      mlSiblingsCount = siblings.length;
    }

    res.type('html').send(views.skuEditModal({
      sku, family, shopifyPrice, productTitle, targetBase,
      targetMl: mlEff.target, mlOverride: mlEff.override,
      targetFb: fbEff.target, fbOverride: fbEff.override,
      mlSiblingsCount,
      syncStartedFor: req._syncStartedFor || null,
    }));
  } catch (err) { next(err); }
});

/**
 * POST /admin/ui/overrides/create — crea override desde el form Y dispara sync
 *
 * El sync va en background (setImmediate) para responder al usuario rápido.
 * - scope=sku   → syncAllPricesFromShopify con filtro skus=[sku]
 * - scope=family → syncAllPricesFromShopify con filtro skuPrefixes=[family+'-']
 *
 * En ambos casos los logs de Render muestran el progreso. El modal se cierra y
 * la tabla principal puede refrescarse para ver el nuevo precio.
 */
router.post('/overrides/create', async (req, res, next) => {
  try {
    const b = req.body;
    const family = familyForSku(b.returnSku);
    const input = {
      scope: b.scope,
      key: b.scope === 'family' ? family : b.returnSku,
      platform: b.platform,
      overrideType: b.overrideType,
      value: Number(b.value),
      validFrom: b.validFrom || null,
      validUntil: b.validUntil || null,
      note: b.note || null,
      createdBy: req.uiUser || 'admin-ui',
    };
    const created = await priceOverrideRepo.create(input);
    await overrideCache.invalidate();
    logger.info({ ...input, id: created.id }, 'override creado via UI');

    // Disparar sync en background con el filtro apropiado.
    const clients = getClients(req);
    const syncOpts = b.scope === 'family'
      ? { skuPrefixes: [family + '-'], reason: 'admin_ui_override_family' }
      : { skus: [b.returnSku], reason: 'admin_ui_override_sku' };
    setImmediate(async () => {
      try {
        logger.info({ overrideId: created.id, ...syncOpts }, 'auto-sync tras crear override: inicio');
        const summary = await syncAllPricesFromShopify(clients.shopify, clients, {
          dryRun: false,
          delayMs: 1500,
          ...syncOpts,
        });
        logger.info({ overrideId: created.id, ...summary }, 'auto-sync tras crear override: completado');
      } catch (e) {
        logger.error({ overrideId: created.id, err: e.message }, 'auto-sync tras crear override: error');
      }
    });

    // Re-renderizar el modal con el override aplicado + banner de éxito.
    req.params = { sku: b.returnSku };
    req._syncStartedFor = b.scope === 'family' ? `familia ${family}` : `SKU ${b.returnSku}`;
    return router.handle(Object.assign(req, { method: 'GET', url: `/skus/${encodeURIComponent(b.returnSku)}/edit` }), res, next);
  } catch (err) { next(err); }
});

/**
 * DELETE /admin/ui/overrides/:id — soft-delete
 */
router.delete('/overrides/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await priceOverrideRepo.softDelete(id);
    await overrideCache.invalidate();
    logger.info({ id }, 'override eliminado via UI');
    // Respuesta vacía: HTMX hace swap del row
    res.type('html').send('');
  } catch (err) { next(err); }
});

/**
 * GET /admin/ui/overrides — lista todos
 */
router.get('/overrides', async (req, res, next) => {
  try {
    const items = await priceOverrideRepo.listAll({ activeOnly: true });
    res.type('html').send(layout({
      title: 'Ajustes manuales',
      content: views.overridesList(items),
      active: 'overrides',
    }));
  } catch (err) { next(err); }
});

/**
 * GET /admin/ui/operations — página de operaciones
 */
router.get('/operations', async (req, res) => {
  res.type('html').send(layout({
    title: 'Operaciones',
    content: views.operationsPage(),
    active: 'ops',
  }));
});

/**
 * POST /admin/ui/ops/sync-all-prices — disparar sync, retorna HTML
 */
router.post('/ops/sync-all-prices', async (req, res, next) => {
  try {
    const dryRun = req.query.dry_run === 'true';
    const clients = getClients(req);
    if (dryRun) {
      const summary = await syncAllPricesFromShopify(clients.shopify, clients, { dryRun: true });
      return res.type('html').send(views.operationResult({ title: 'Sync precios', summary, isDryRun: true }));
    }
    // background
    res.type('html').send(views.operationResult({
      title: 'Sync precios',
      summary: { message: 'Iniciado en background. Revisa logs.' },
      isDryRun: false,
    }));
    (async () => {
      try {
        const summary = await syncAllPricesFromShopify(clients.shopify, clients, { dryRun: false, delayMs: 2500 });
        logger.info(summary, 'sync-all-prices completado (via UI)');
      } catch (err) { logger.error({ err: err.message }, 'sync-all-prices ui error'); }
    })();
  } catch (err) { next(err); }
});

/**
 * POST /admin/ui/ops/reconcile-stock
 */
router.post('/ops/reconcile-stock', async (req, res, next) => {
  try {
    const dryRun = req.query.dry_run === 'true';
    const clients = getClients(req);
    if (dryRun) {
      const summary = await reconcileStock(clients, { dryRun: true });
      return res.type('html').send(views.operationResult({ title: 'Reconciliación stock', summary, isDryRun: true }));
    }
    res.type('html').send(views.operationResult({
      title: 'Reconciliación stock',
      summary: { message: 'Iniciado en background. Revisa logs.' },
      isDryRun: false,
    }));
    (async () => {
      try {
        const summary = await reconcileStock(clients, { dryRun: false });
        logger.info(summary, 'reconcile completado (via UI)');
      } catch (err) { logger.error({ err: err.message }, 'reconcile ui error'); }
    })();
  } catch (err) { next(err); }
});

// Error handler local
router.use((err, req, res, next) => {
  logger.error({ err: err.message, stack: err.stack, path: req.path }, 'UI error');
  res.status(500).type('html').send(`<pre>Error: ${err.message}</pre>`);
});

export default router;
