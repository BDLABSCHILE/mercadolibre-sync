import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mockeamos el repo de DB para no tocar Postgres en el test unitario.
vi.mock('../../db/repositories/sku-mapping.js', () => ({
  listAll: vi.fn(),
}));

import * as repo from '../../db/repositories/sku-mapping.js';
import * as skuCache from '../sku-cache.js';

// Filas de prueba que imitan sku_mapping.
const ROWS = [
  // SKU sin item ML mapeado (como BI-G-MUS antes del fix): solo Falabella.
  { sku: 'BI-G-MUS', mlItemId: null, mlVariationId: null, falabellaSellerSku: 'BI-G-MUS' },
  // SKU dentro de un listing padre con variaciones.
  { sku: 'B-M-MUSE', mlItemId: 'MLC3539387920', mlVariationId: '189654907244', falabellaSellerSku: null },
  // SKU en un item ML sin variaciones (item con 1 solo SKU).
  { sku: 'X-SOLO', mlItemId: 'MLCSOLO', mlVariationId: null, falabellaSellerSku: null },
];

beforeEach(async () => {
  repo.listAll.mockResolvedValue(ROWS);
  await skuCache.invalidate(); // fuerza recarga del cache con los ROWS mockeados
});

describe('resolveFromMlOrderItem — resolución por seller_sku', () => {
  it('resuelve por seller_sku aunque el item_id (publicación de catálogo) NO esté mapeado', async () => {
    // Caso BI-G-MUS: venta entró por MLC3617696150 (catálogo, no mapeado),
    // pero la orden trae seller_sku=BI-G-MUS.
    const r = await skuCache.resolveFromMlOrderItem('MLC3617696150', null, 'BI-G-MUS');
    expect(r?.sku).toBe('BI-G-MUS');
    expect(r?.via).toBe('seller_sku');
  });

  it('seller_sku tiene prioridad sobre item_id/variation_id', async () => {
    // Aunque el itemId/variation resolverían a X-SOLO, el seller_sku manda.
    const r = await skuCache.resolveFromMlOrderItem('MLCSOLO', null, 'BI-G-MUS');
    expect(r?.sku).toBe('BI-G-MUS');
    expect(r?.via).toBe('seller_sku');
  });

  it('normaliza espacios en el seller_sku', async () => {
    const r = await skuCache.resolveFromMlOrderItem('MLCX', null, '  B-M-MUSE  ');
    expect(r?.sku).toBe('B-M-MUSE');
    expect(r?.via).toBe('seller_sku');
  });
});

describe('resolveFromMlOrderItem — fallbacks (comportamiento histórico)', () => {
  it('cae a variation_id cuando no hay seller_sku', async () => {
    const r = await skuCache.resolveFromMlOrderItem('MLC3539387920', '189654907244', null);
    expect(r?.sku).toBe('B-M-MUSE');
    expect(r?.via).toBe('variation');
  });

  it('cae a item_id (1 SKU) cuando no hay seller_sku ni variation', async () => {
    const r = await skuCache.resolveFromMlOrderItem('MLCSOLO', null, null);
    expect(r?.sku).toBe('X-SOLO');
    expect(r?.via).toBe('item');
  });

  it('si el seller_sku no existe en la DB, cae al fallback por item', async () => {
    const r = await skuCache.resolveFromMlOrderItem('MLCSOLO', null, 'NO-EXISTE');
    expect(r?.sku).toBe('X-SOLO');
    expect(r?.via).toBe('item');
  });

  it('retorna null cuando nada resuelve', async () => {
    const r = await skuCache.resolveFromMlOrderItem('MLC-DESCONOCIDO', null, 'TAMPOCO-EXISTE');
    expect(r).toBe(null);
  });
});
