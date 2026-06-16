import { describe, it, expect, vi } from 'vitest';
import { resolveMlTarget } from '../src/services/ml-resolve.js';

/**
 * resolveMlTarget prioriza sku_mapping (cache) sobre el scan en vivo, para que la
 * redistribución por-venta baje el stock de ML también en billeteras/catálogo (cuyo
 * SKU vive en el user_product y findItemBySKU NO encuentra).
 */
describe('resolveMlTarget', () => {
  it('resuelve por sku_mapping (billetera) SIN tocar el scan que falla', async () => {
    const skuCache = {
      getBySku: vi.fn(async () => ({ sku: 'BI-G-CAM', mlItemId: 'MLC3539647052', mlVariationId: '177998877' })),
    };
    const meli = { findItemBySKU: vi.fn(async () => null) };
    const t = await resolveMlTarget('BI-G-CAM', { skuCache, meli });
    expect(t).toEqual({ itemId: 'MLC3539647052', variationId: 177998877, via: 'mapping' });
    expect(meli.findItemBySKU).not.toHaveBeenCalled();
  });

  it('mlVariationId null → variationId null (item sin variaciones)', async () => {
    const skuCache = { getBySku: vi.fn(async () => ({ sku: 'X', mlItemId: 'MLC999', mlVariationId: null })) };
    const meli = { findItemBySKU: vi.fn() };
    const t = await resolveMlTarget('X', { skuCache, meli });
    expect(t).toEqual({ itemId: 'MLC999', variationId: null, via: 'mapping' });
  });

  it('sin mapeo de ML → cae al scan legacy', async () => {
    const skuCache = { getBySku: vi.fn(async () => null) };
    const meli = { findItemBySKU: vi.fn(async () => ({ itemId: 'MLC1', variationId: 55 })) };
    const t = await resolveMlTarget('Y', { skuCache, meli });
    expect(t).toEqual({ itemId: 'MLC1', variationId: 55, via: 'scan' });
    expect(meli.findItemBySKU).toHaveBeenCalledWith('Y');
  });

  it('mapping existe pero sin mlItemId → usa scan', async () => {
    const skuCache = { getBySku: vi.fn(async () => ({ sku: 'Z', mlItemId: null, mlVariationId: null })) };
    const meli = { findItemBySKU: vi.fn(async () => ({ itemId: 'MLC2', variationId: null })) };
    const t = await resolveMlTarget('Z', { skuCache, meli });
    expect(t).toEqual({ itemId: 'MLC2', variationId: null, via: 'scan' });
  });

  it('no encontrado en ningún lado → null', async () => {
    const skuCache = { getBySku: vi.fn(async () => null) };
    const meli = { findItemBySKU: vi.fn(async () => null) };
    const t = await resolveMlTarget('NADA', { skuCache, meli });
    expect(t).toBeNull();
  });

  it('sku vacío → null sin llamar dependencias', async () => {
    const skuCache = { getBySku: vi.fn() };
    const meli = { findItemBySKU: vi.fn() };
    const t = await resolveMlTarget('   ', { skuCache, meli });
    expect(t).toBeNull();
    expect(skuCache.getBySku).not.toHaveBeenCalled();
    expect(meli.findItemBySKU).not.toHaveBeenCalled();
  });
});
