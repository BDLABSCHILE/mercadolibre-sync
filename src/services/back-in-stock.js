/**
 * "Avísame cuando llegue" (back in stock) — reemplazo de la app SW Back in Stock.
 *
 * Flujo:
 *   storefront (producto agotado) → POST /api/back-in-stock/subscribe → waitlist en Neon.
 *   Cuando el stock Shopify de un SKU con esperas vuelve a ser > 0 (webhook inventory,
 *   reconciliación, o barrido al boot) → por cada espera pendiente: evento back_in_stock
 *   a Pulpo → Pulpo (flow LIVE) manda el email/WhatsApp.
 *
 * Garantías:
 *  - Claim POR FILA justo antes de enviar (UPDATE ... WHERE notified_at IS NULL):
 *    webhook y reconcile concurrentes no duplican avisos, y si el proceso muere a
 *    mitad de camino a lo más una fila queda colgada — recoverStaleClaims() la
 *    devuelve a pendiente en el próximo barrido (at-least-once).
 *  - Un aviso POR PERSONA por barrido: si el mismo correo espera varios SKUs que
 *    reponen juntos, se envía uno y el resto queda pendiente para el siguiente
 *    ciclo (el motor de Pulpo deduplica corridas activas y su smart sending
 *    omitiría los extras — mejor espaciarlos que perderlos).
 *  - Matching de SKU case-insensitive en DB y en el mapa de stock.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const SKU_RE = /^[A-Z0-9._-]{1,64}$/;
const MAX_PENDING_PER_EMAIL = 10;

/** Normaliza teléfono chileno a E.164 (+56...). Devuelve null si no es válido. */
export function normalizePhone(raw) {
  if (!raw) return null;
  let s = String(raw).replace(/[\s().-]/g, '');
  if (!s) return null;
  if (/^9\d{8}$/.test(s)) s = `+56${s}`;          // 9XXXXXXXX → +569XXXXXXXX
  else if (/^569\d{8}$/.test(s)) s = `+${s}`;     // 569XXXXXXXX → +569XXXXXXXX
  if (!/^\+\d{8,15}$/.test(s)) return null;       // E.164 genérico como fallback
  return s;
}

/**
 * Valida y normaliza el input del formulario del storefront.
 * Solo sku + email + phone: el título/URL del producto se resuelven SERVER-SIDE
 * (nunca se confía en texto del cliente que terminaría dentro de un correo).
 * @returns {{ok:true, honeypot?:true, value?:object}|{ok:false, error:string}}
 */
export function normalizeSubscription(input = {}) {
  // Honeypot: campo invisible "website" — si viene lleno es un bot. Fingimos éxito.
  if (typeof input.website === 'string' && input.website.trim() !== '') {
    return { ok: true, honeypot: true };
  }

  const email = String(input.email || '').trim().toLowerCase();
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    return { ok: false, error: 'Correo inválido' };
  }

  const sku = String(input.sku || '').trim().toUpperCase();
  if (!SKU_RE.test(sku)) {
    return { ok: false, error: 'SKU inválido' };
  }

  // Teléfono opcional (para aviso por WhatsApp vía Pulpo). Inválido → se descarta
  // en silencio: no bloqueamos la suscripción por un teléfono mal tipeado.
  const phone = normalizePhone(input.phone);

  return { ok: true, value: { sku, email, phone } };
}

/**
 * Lógica completa del endpoint público de suscripción (testeable sin Express).
 * @param {object} input  body del request
 * @param {{ getProduct: (sku:string)=>Promise<object|null>, repo, pulpo, logger,
 *           maxPendingPerEmail?: number }} deps
 * @returns {Promise<{status:number, body:object}>}
 */
export async function handleSubscribe(input, deps) {
  const { getProduct, repo, pulpo, logger, maxPendingPerEmail = MAX_PENDING_PER_EMAIL } = deps;

  const parsed = normalizeSubscription(input || {});
  if (!parsed.ok) return { status: 400, body: { ok: false, error: parsed.error } };
  if (parsed.honeypot) return { status: 200, body: { ok: true } }; // bot: fingir éxito

  const { sku, email, phone } = parsed.value;

  // El SKU debe existir en la tienda (server-side; también nos da título/URL confiables).
  const product = await getProduct(sku);
  if (!product) return { status: 400, body: { ok: false, error: 'Producto desconocido' } };

  // Producto CON stock → no hay nada que esperar. No guardamos (cierra el abuso de
  // suscribir correos ajenos a productos disponibles para dispararles avisos).
  if (product.stock > 0) {
    return { status: 200, body: { ok: true, available: true } };
  }

  // Tope de esperas activas por persona (anti-spam / anti-bombing).
  const pendingCount = await repo.countPendingByEmail(email);
  if (pendingCount >= maxPendingPerEmail) {
    return { status: 429, body: { ok: false, error: 'Demasiadas esperas activas para este correo' } };
  }

  const { entry, isNew } = await repo.subscribe({
    sku,
    email,
    phone,
    productTitle: product.title,
    productUrl: product.url,
    source: 'storefront',
  });
  logger.info({ sku: entry.sku, isNew }, 'back-in-stock: suscripción registrada');

  // Upsert best-effort del contacto en Pulpo. Solo email y SIN consent de marketing:
  // no se regala consentimiento a nombre de terceros; el aviso back-in-stock viaja
  // por /track. (El teléfono llega a Pulpo recién con el track del aviso.)
  if (pulpo.isEnabled()) {
    pulpo.upsertProfile({ email })
      .catch((err) => logger.warn({ err: err.message }, 'back-in-stock: upsert perfil Pulpo falló (no crítico)'));
  }

  return { status: 200, body: { ok: true } };
}

/**
 * Avisa a las esperas pendientes de un SKU porque volvió el stock.
 * @param {string} sku
 * @param {number} stock  stock Shopify observado (solo avisa si > 0)
 * @param {{ repo, pulpo, logger, delayMs?: number }} deps
 * @param {{ source?: string, skipEmails?: Set<string> }} opts
 *   skipEmails: correos ya avisados en este barrido (dedupe por persona entre SKUs);
 *   se actualiza in-place con los correos avisados acá.
 */
export async function notifyPendingForSku(sku, stock, deps, opts = {}) {
  const { repo, pulpo, logger, delayMs = 250 } = deps;
  const source = opts.source || 'unknown';
  const skipEmails = opts.skipEmails || new Set();

  if (!Number.isFinite(stock) || stock <= 0) return { sku, skipped: 'no_stock', notified: 0, failed: 0, deferred: 0 };
  // Sin Pulpo configurado NO reclamamos filas: quedan pendientes para cuando se active.
  if (!pulpo.isEnabled()) return { sku, skipped: 'pulpo_disabled', notified: 0, failed: 0, deferred: 0 };

  const pending = await repo.listPendingBySku(sku);
  if (pending.length === 0) return { sku, notified: 0, failed: 0, deferred: 0 };

  logger.info({ sku, stock, count: pending.length, source }, 'back-in-stock: avisando esperas');

  let notified = 0;
  let failed = 0;
  let deferred = 0;
  for (const row of pending) {
    const emailKey = (row.email || '').toLowerCase();
    // Máximo un aviso por persona por barrido; el resto sale en el próximo ciclo.
    if (skipEmails.has(emailKey)) {
      deferred++;
      continue;
    }

    // Claim atómico por fila, justo antes de enviar. null = otro proceso la tomó.
    const entry = await repo.claimEntry(row.id);
    if (!entry) continue;

    try {
      await pulpo.trackBackInStock({
        email: entry.email,
        phone: entry.phone,
        sku,
        productName: entry.productTitle,
        productUrl: entry.productUrl,
      });
      await repo.markSent(entry.id);
      skipEmails.add(emailKey);
      notified++;
    } catch (err) {
      failed++;
      logger.warn({ sku, id: entry.id, err: err.message }, 'back-in-stock: fallo aviso, vuelve a pendiente');
      await repo.releaseClaim(entry.id, err.message).catch(() => {});
    }
    // Suave con el rate limit de Pulpo (300/min); irrelevante para listas chicas.
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  }

  logger.info({ sku, notified, failed, deferred, source }, 'back-in-stock: avisos completados');
  return { sku, notified, failed, deferred };
}

/**
 * Barrido para la reconciliación: cruza los SKUs con esperas pendientes contra el
 * mapa de stock Shopify ya cargado y avisa los que repusieron. Nunca lanza.
 * @param {Map<string, number>} shopifyStockMap  (claves con el case original de Shopify)
 */
export async function notifyPendingFromStockMap(shopifyStockMap, deps, opts = {}) {
  const { repo, pulpo, logger } = deps;
  const out = { checked: 0, notified: 0, failed: 0, deferred: 0, recovered: 0 };
  try {
    if (!pulpo.isEnabled()) return { ...out, skipped: 'pulpo_disabled' };

    // Repara claims huérfanos de corridas anteriores (proceso muerto entre claim y send).
    out.recovered = await repo.recoverStaleClaims({ olderThanMinutes: 15 });
    if (out.recovered > 0) logger.warn({ recovered: out.recovered }, 'back-in-stock: claims huérfanos recuperados');

    // Mapa con claves normalizadas (los SKUs de la waitlist van en mayúscula).
    const stockUpper = new Map();
    for (const [k, v] of shopifyStockMap) stockUpper.set(String(k).trim().toUpperCase(), v);

    const skipEmails = new Set(); // un aviso por persona por barrido, entre SKUs
    const skus = await repo.pendingSkus();
    for (const sku of skus) {
      const stock = stockUpper.get(sku);
      if (!Number.isFinite(stock) || stock <= 0) continue;
      out.checked++;
      const r = await notifyPendingForSku(sku, stock, deps, { ...opts, skipEmails });
      out.notified += r.notified || 0;
      out.failed += r.failed || 0;
      out.deferred += r.deferred || 0;
    }
  } catch (err) {
    logger.warn({ err: err.message }, 'back-in-stock: barrido falló (no afecta la reconciliación)');
  }
  return out;
}

/**
 * Barrido liviano para el arranque del server: si hay esperas pendientes, consulta
 * el stock real SOLO de esos SKUs y avisa los repuestos. En Render free el proceso
 * despierta con cualquier tráfico → esto acota la latencia de avisos aunque el
 * webhook de inventario no esté llegando. Nunca lanza.
 * @param {{ repo, pulpo, logger }} deps
 * @param {(sku:string)=>Promise<number|null>} getStock  p.ej. shopify.getStockBySKU
 */
export async function sweepPendingOnBoot(deps, getStock, opts = {}) {
  const { repo, pulpo, logger } = deps;
  try {
    if (!pulpo.isEnabled()) return { skipped: 'pulpo_disabled' };
    const skus = await repo.pendingSkus();
    if (skus.length === 0) return { checked: 0 };
    const stockMap = new Map();
    for (const sku of skus) {
      try {
        const s = await getStock(sku);
        if (s != null) stockMap.set(sku, s);
      } catch (err) {
        logger.warn({ sku, err: err.message }, 'back-in-stock boot: error leyendo stock');
      }
    }
    return await notifyPendingFromStockMap(stockMap, deps, { ...opts, source: opts.source || 'boot' });
  } catch (err) {
    logger.warn({ err: err.message }, 'back-in-stock boot: barrido falló');
    return { error: err.message };
  }
}
