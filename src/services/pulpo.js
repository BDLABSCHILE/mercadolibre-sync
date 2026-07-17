/**
 * Cliente mínimo de la API pública de Pulpo (pulpo.valiz.cl — plataforma de
 * marketing de BDLABS). Docs: app/settings/api-docs en el repo de Pulpo.
 *
 * - POST /api/v1/track   → registra un evento y enrola al contacto en los flows
 *                          LIVE con ese trigger (acá: event "back_in_stock").
 * - POST /api/v1/profiles → upsert del contacto (consent email subscribed).
 *
 * Auth: Bearer pk_pulpo_* (scope full). La llave vive SOLO en el server
 * (env PULPO_TRACK_API_KEY) — jamás en el storefront. Sin llave configurada la
 * integración queda apagada (fail-safe): se acumula waitlist pero no se avisa.
 *
 * Límites de Pulpo: properties ≤30 claves, strings ≤500 chars, sin < >.
 * Rate limit 300 req/min por llave.
 */

import { config } from '../config.js';

const TIMEOUT_MS = 10_000;

export function isEnabled() {
  return Boolean(config.PULPO_TRACK_API_KEY);
}

/** Sanitiza un valor para properties de Pulpo: sin < >, tope 500 chars. */
function cleanProp(v) {
  if (v == null) return undefined;
  const s = String(v).replace(/[<>]/g, '').trim();
  return s ? s.slice(0, 500) : undefined;
}

/** Builder puro del body de track (exportado para tests). */
export function buildTrackBody({ email, phone, sku, productName, productUrl }) {
  const properties = {};
  const cSku = cleanProp(sku);
  const cName = cleanProp(productName);
  const cUrl = cleanProp(productUrl);
  if (cSku) properties.sku = cSku;
  if (cName) properties.productName = cName;
  if (cUrl) properties.productUrl = cUrl;

  const body = { event: 'back_in_stock', properties };
  // Ambos identificadores cuando existen: Pulpo matchea por email primero y adjunta
  // el teléfono al contacto (habilita el paso WhatsApp del flow). Mandar solo email
  // dejaría al contacto sin teléfono → Pulpo saltaría el aviso por WhatsApp.
  if (email) body.email = email;
  if (phone) body.phone = phone;
  return body;
}

async function post(path, body) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${config.PULPO_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.PULPO_TRACK_API_KEY}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Pulpo ${path} HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    return { ok: true, status: res.status };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Dispara el evento back_in_stock para un contacto → Pulpo lo enrola en el flow
 * "Back in stock" (debe estar LIVE en el panel de Pulpo) y envía email/WhatsApp.
 */
export async function trackBackInStock({ email, phone, sku, productName, productUrl }) {
  if (!isEnabled()) throw new Error('Pulpo no configurado (PULPO_TRACK_API_KEY)');
  return post('/api/v1/track', buildTrackBody({ email, phone, sku, productName, productUrl }));
}

/**
 * Upsert best-effort del contacto al momento de suscribirse.
 * DELIBERADAMENTE minimalista: sin `consent` (no se regala consentimiento de
 * marketing a nombre de un correo que cualquiera pudo tipear en un form público)
 * y sin phone (el teléfono viaja recién en el track del aviso). El evento
 * back_in_stock vía /track no necesita consent previo para disparar el flow.
 */
export async function upsertProfile({ email, firstName }) {
  if (!isEnabled()) return { ok: false, skipped: true };
  const body = {};
  if (email) body.email = email;
  if (firstName) body.firstName = cleanProp(firstName);
  return post('/api/v1/profiles', body);
}
