/**
 * Cálculo de precio para marketplaces.
 *
 * Regla del negocio (Valiz):
 *   precio_marketplace = round_up_to_ending(precio_shopify * markup, ending)
 *
 * markup default 1.3, ending default 990 (CLP estética chilena).
 *
 * Si el cálculo intermedio ya termina en `ending`, no salta al siguiente.
 *
 * Ejemplos con ending=990:
 *   18.000  * 1.3 = 23.400     → 23.990
 *   18.200  * 1.3 = 23.660     → 23.990
 *   18.500  * 1.3 = 24.050     → 24.990
 *   19.223  * 1.3 = 24.989,9   → 24.990
 *   19.224  * 1.3 = 24.991,2   → 25.990
 */

import { config } from '../config.js';

const DEFAULT_MARKUP = config.PRICE_MARKUP;
const DEFAULT_ENDING = config.PRICE_ROUND_ENDING;

/**
 * Redondea n hacia arriba al próximo número >= n cuyo último tramo de 1000
 * termina exactamente en `ending`. Asume ending < 1000.
 *
 * Si n ya cumple la condición, retorna n (no salta).
 */
export function roundUpToEnding(n, ending = DEFAULT_ENDING) {
  if (!Number.isFinite(n)) return null;
  if (n <= 0) return 0;
  if (ending < 0 || ending >= 1000 || !Number.isInteger(ending)) {
    throw new Error(`roundUpToEnding: ending debe ser entero en [0, 999], recibido ${ending}`);
  }
  const thousands = Math.floor(n / 1000);
  const candidate = thousands * 1000 + ending;
  return candidate >= n ? candidate : candidate + 1000;
}

/**
 * Aplica markup y redondea. Si shopifyPrice es null/undefined/<=0, retorna null.
 */
export function priceForMarketplace(shopifyPrice, { markup = DEFAULT_MARKUP, ending = DEFAULT_ENDING } = {}) {
  if (shopifyPrice == null) return null;
  const p = Number(shopifyPrice);
  if (!Number.isFinite(p) || p <= 0) return null;
  return roundUpToEnding(p * markup, ending);
}

/**
 * Helper para comparar dos precios con tolerancia (evita oscilaciones por floats).
 * Retorna true si son iguales dentro de la tolerancia (default 0.5 CLP).
 */
export function pricesEqual(a, b, tolerance = 0.5) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(Number(a) - Number(b)) < tolerance;
}
