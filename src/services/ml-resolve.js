/**
 * Resuelve el item/variación de MercadoLibre para un SKU al redistribuir stock.
 *
 * Prioriza la tabla de mapeo (sku_mapping vía sku-cache): es la fuente de verdad y
 * funciona para billeteras/catálogo cuyo SKU vive en el user_product de ML. El scan
 * en vivo (meli.findItemBySKU) NO los encuentra —no pagina más de 50 items ni resuelve
 * user_products—, por lo que queda SOLO como fallback para SKUs sin mapeo de ML.
 *
 * Antes, la redistribución por-venta usaba findItemBySKU directo → para billeteras
 * devolvía null y el stock de ML quedaba stale hasta el reconcile. Resolviendo por
 * sku_mapping primero (igual que el reconciler), la baja de ML es inmediata para todos.
 *
 * @param {string} sku
 * @param {{ skuCache: { getBySku: Function }, meli: { findItemBySKU: Function } }} deps
 * @returns {Promise<{itemId: string, variationId: number|null, via: 'mapping'|'scan'}|null>}
 */
export async function resolveMlTarget(sku, { skuCache, meli } = {}) {
  const safeSku = sku ? String(sku).trim() : '';
  if (!safeSku) return null;

  // 1) Tabla de mapeo (sku_mapping): cubre catálogo/padre y billeteras por igual.
  const mapping = await skuCache.getBySku(safeSku);
  if (mapping && mapping.mlItemId) {
    return {
      itemId: mapping.mlItemId,
      variationId:
        mapping.mlVariationId != null && mapping.mlVariationId !== ''
          ? Number(mapping.mlVariationId)
          : null,
      via: 'mapping',
    };
  }

  // 2) Fallback legacy: scan en vivo (solo sirve si el SKU está en la variación del item).
  const found = await meli.findItemBySKU(safeSku);
  if (found && found.itemId) {
    return { itemId: found.itemId, variationId: found.variationId ?? null, via: 'scan' };
  }

  return null;
}
