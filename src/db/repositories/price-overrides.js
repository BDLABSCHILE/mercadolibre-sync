import { query } from '../index.js';

const COLS = 'id, scope, key, platform, override_type, value, valid_from, valid_until, note, active, created_by, created_at, updated_at';

function rowTo(o) {
  if (!o) return null;
  return {
    id: o.id,
    scope: o.scope,
    key: o.key,
    platform: o.platform,
    overrideType: o.override_type,
    value: Number(o.value),
    validFrom: o.valid_from,
    validUntil: o.valid_until,
    note: o.note,
    active: o.active,
    createdBy: o.created_by,
    createdAt: o.created_at,
    updatedAt: o.updated_at,
  };
}

/**
 * Lista TODOS los overrides (activos e inactivos, válidos y caducados).
 * Filtros opcionales por scope, key, platform, activeOnly.
 */
export async function listAll(opts = {}) {
  const where = [];
  const params = [];
  let p = 1;
  if (opts.scope) { where.push(`scope = $${p++}`); params.push(opts.scope); }
  if (opts.key) { where.push(`key = $${p++}`); params.push(opts.key); }
  if (opts.platform) { where.push(`platform = $${p++}`); params.push(opts.platform); }
  if (opts.activeOnly) where.push('active = true');
  const sql = `SELECT ${COLS} FROM price_overrides ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC`;
  const res = await query(sql, params);
  return res.rows.map(rowTo);
}

/**
 * Trae overrides ACTIVOS y VÁLIDOS ahora para un (sku, family, platform).
 * Devuelve array; el caller debe resolver prioridad (sku > family, platform específica > 'all').
 *
 * @param {string} sku
 * @param {string|null} family - prefijo de familia (ej. 'B-M')
 * @param {string} platform - 'mercadolibre' o 'falabella'
 */
export async function findActiveFor(sku, family, platform) {
  const res = await query(
    `SELECT ${COLS} FROM price_overrides
     WHERE active = true
       AND (valid_from IS NULL OR valid_from <= now())
       AND (valid_until IS NULL OR valid_until > now())
       AND (
         (scope = 'sku' AND key = $1)
         OR (scope = 'family' AND $2 IS NOT NULL AND key = $2)
       )
       AND (platform = $3 OR platform = 'all')`,
    [String(sku).trim(), family ? String(family).trim() : null, platform],
  );
  return res.rows.map(rowTo);
}

/**
 * Crea un override nuevo.
 */
export async function create(input) {
  const required = ['scope', 'key', 'platform', 'overrideType', 'value'];
  for (const k of required) {
    if (input[k] == null || input[k] === '') throw new Error(`create: campo requerido faltante: ${k}`);
  }
  const res = await query(
    `INSERT INTO price_overrides (scope, key, platform, override_type, value, valid_from, valid_until, note, active, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING ${COLS}`,
    [
      input.scope,
      String(input.key).trim(),
      input.platform,
      input.overrideType,
      Number(input.value),
      input.validFrom || null,
      input.validUntil || null,
      input.note || null,
      input.active !== false,
      input.createdBy || null,
    ],
  );
  return rowTo(res.rows[0]);
}

/**
 * Update parcial por id.
 */
export async function update(id, changes) {
  const fields = [];
  const params = [];
  let p = 1;
  const map = {
    scope: 'scope',
    key: 'key',
    platform: 'platform',
    overrideType: 'override_type',
    value: 'value',
    validFrom: 'valid_from',
    validUntil: 'valid_until',
    note: 'note',
    active: 'active',
  };
  for (const [k, col] of Object.entries(map)) {
    if (k in changes) {
      fields.push(`${col} = $${p++}`);
      params.push(changes[k]);
    }
  }
  if (fields.length === 0) {
    const res = await query(`SELECT ${COLS} FROM price_overrides WHERE id = $1`, [id]);
    return rowTo(res.rows[0]);
  }
  params.push(id);
  const res = await query(
    `UPDATE price_overrides SET ${fields.join(', ')} WHERE id = $${p} RETURNING ${COLS}`,
    params,
  );
  return rowTo(res.rows[0]);
}

/**
 * Soft delete: active=false. Mantiene historial.
 */
export async function softDelete(id) {
  const res = await query(
    `UPDATE price_overrides SET active = false WHERE id = $1 RETURNING ${COLS}`,
    [id],
  );
  return rowTo(res.rows[0]);
}

export async function getById(id) {
  const res = await query(`SELECT ${COLS} FROM price_overrides WHERE id = $1`, [id]);
  return rowTo(res.rows[0]);
}

export async function count(activeOnly = true) {
  const res = await query(
    activeOnly
      ? `SELECT COUNT(*)::int AS n FROM price_overrides WHERE active = true`
      : `SELECT COUNT(*)::int AS n FROM price_overrides`,
  );
  return res.rows[0]?.n ?? 0;
}
