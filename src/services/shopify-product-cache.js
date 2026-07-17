/**
 * Cache en memoria de productos Shopify indexados por SKU (TTL corto).
 *
 * Lo usa el endpoint público de back-in-stock para: (1) validar que el SKU exista
 * de verdad en la tienda, (2) verificar que esté agotado (no se aceptan esperas de
 * productos con stock — cierra el abuso de "suscribir a terceros a SKUs con stock
 * para que les lleguen correos"), y (3) resolver título y URL del producto
 * SERVER-SIDE (jamás se confía en el texto que manda el cliente: ese texto
 * terminaría dentro de un correo legítimo de Valiz → phishing).
 *
 * Nota: usa variant.inventory_quantity (puede tener segundos de lag), suficiente
 * como guard de UX; la verdad autoritativa del aviso sigue siendo inventory_levels
 * vía los triggers de notificación.
 */

const STORE_BASE = 'https://www.valiz.cl';

export function makeProductCache(shopifyClient, { ttlMs = 10 * 60_000 } = {}) {
  let bySku = new Map();
  let loadedAt = 0;
  let loading = null;

  async function load() {
    if (loading) return loading;
    loading = (async () => {
      const products = await shopifyClient.getAllProducts();
      const next = new Map();
      for (const p of products) {
        for (const v of p.variants || []) {
          const sku = (v.sku || '').trim().toUpperCase();
          if (!sku) continue;
          next.set(sku, {
            title: p.title,
            url: p.handle ? `${STORE_BASE}/products/${p.handle}` : null,
            stock: Number.isFinite(v.inventory_quantity) ? v.inventory_quantity : 0,
          });
        }
      }
      bySku = next;
      loadedAt = Date.now();
      return bySku;
    })();
    try {
      return await loading;
    } finally {
      loading = null;
    }
  }

  return {
    /** @returns {Promise<{title:string, url:string|null, stock:number}|null>} */
    async getBySku(sku) {
      if (!sku) return null;
      if (Date.now() - loadedAt > ttlMs) await load();
      return bySku.get(String(sku).trim().toUpperCase()) || null;
    },
    /** Para tests/diagnóstico. */
    _size() {
      return bySku.size;
    },
  };
}
