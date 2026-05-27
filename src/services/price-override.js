/**
 * Lógica pura de aplicación de overrides sobre el precio target.
 *
 * Los overrides modifican la regla general (shopify * markup → redondeo 990)
 * por SKU o por familia. Permiten descuentos, precios absolutos, markups
 * custom y descuentos porcentuales.
 */

import { config } from '../config.js';
import { roundUpToEnding } from './price.js';

const ROUND_ENDING = config.PRICE_ROUND_ENDING;

/**
 * Extrae la familia de un SKU. La familia es el prefijo antes de la última
 * sección. Ej:
 *   B-M-NE    → 'B-M'
 *   MA-G-CHA  → 'MA-G'
 *   TJ-C-NE   → 'TJ-C'
 *   FOO       → null (sin guiones, no se puede inferir familia)
 *
 * Esto matchea las 10 familias del catálogo Valiz. Si el modelo cambia,
 * actualizar esta lógica o pasarlo como mapping explícito.
 */
export function familyForSku(sku) {
  if (!sku || typeof sku !== 'string') return null;
  const parts = sku.trim().split('-');
  if (parts.length < 2) return null;
  return parts.slice(0, parts.length - 1).join('-');
}

/**
 * De un array de overrides activos para un SKU, elige el que aplica con la
 * prioridad correcta:
 *   1. scope='sku' con platform específica (más específico)
 *   2. scope='sku' con platform='all'
 *   3. scope='family' con platform específica
 *   4. scope='family' con platform='all'
 *
 * Si hay 2+ overrides del mismo tier (poco común), gana el más reciente
 * (max(created_at)).
 *
 * @param {Array<Object>} overrides - resultado de findActiveFor del repo
 * @param {string} platform - 'mercadolibre' | 'falabella'
 * @returns {Object|null} el override que aplica, o null si ninguno
 */
export function pickOverride(overrides, platform) {
  if (!Array.isArray(overrides) || overrides.length === 0) return null;

  const score = (o) => {
    let s = 0;
    if (o.scope === 'sku') s += 100;
    else if (o.scope === 'family') s += 50;
    if (o.platform === platform) s += 10;
    else if (o.platform === 'all') s += 5;
    return s;
  };

  const sorted = [...overrides].sort((a, b) => {
    const ds = score(b) - score(a);
    if (ds !== 0) return ds;
    // tie-breaker: más reciente
    const ta = new Date(a.createdAt).getTime() || 0;
    const tb = new Date(b.createdAt).getTime() || 0;
    return tb - ta;
  });

  return sorted[0];
}

/**
 * Aplica un override sobre el target base.
 *
 * @param {number} targetBase - el precio que la regla general calcularía
 * @param {Object} override - { overrideType, value, ... }
 * @param {number} shopifyPrice - precio Shopify (necesario para custom_markup)
 * @returns {number|null} precio efectivo, o null si el cálculo es inválido
 */
export function applyOverride(targetBase, override, shopifyPrice) {
  if (!override) return targetBase;
  const v = Number(override.value);
  if (!Number.isFinite(v)) return targetBase;

  switch (override.overrideType) {
    case 'absolute': {
      // precio exacto (ej. 58990)
      if (v <= 0) return null;
      return Math.round(v);
    }
    case 'discount_fixed': {
      // resta v pesos al target base. No redondea (la idea es que el resultado
      // sigue cerca del 990, ej. 61990 - 3000 = 58990).
      const out = targetBase - v;
      if (out <= 0) return 0;
      return Math.round(out);
    }
    case 'discount_percent': {
      // resta v% al target base. Redondea a ending para mantener estética.
      if (v <= 0 || v >= 100) return targetBase;
      const out = targetBase * (1 - v / 100);
      if (out <= 0) return 0;
      return roundUpToEnding(out, ROUND_ENDING);
    }
    case 'custom_markup': {
      // shopify * v (markup custom), redondeado a ending.
      if (v <= 0) return null;
      const p = Number(shopifyPrice);
      if (!Number.isFinite(p) || p <= 0) return null;
      return roundUpToEnding(p * v, ROUND_ENDING);
    }
    default:
      return targetBase;
  }
}

/**
 * Helper de alto nivel: dado un SKU, su shopifyPrice, el target base y el array
 * de overrides activos, devuelve el precio efectivo + cuál override aplicó (o null).
 */
export function effectivePrice({ sku, shopifyPrice, targetBase, overrides, platform }) {
  const chosen = pickOverride(overrides, platform);
  if (!chosen) return { effective: targetBase, override: null };
  const effective = applyOverride(targetBase, chosen, shopifyPrice);
  return { effective, override: chosen };
}
