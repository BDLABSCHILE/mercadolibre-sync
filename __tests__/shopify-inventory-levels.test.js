import { describe, it, expect, vi } from 'vitest';
import ShopifyAPI from '../shopify-api.js';

/**
 * getInventoryLevelsByItemIds lee el stock REAL desde inventory_levels (autoritativo),
 * en lotes de 50 ids, sumando `available` por inventory_item_id a través de ubicaciones.
 * Reemplaza la lectura con lag de variant.inventory_quantity en getStockBySKU/reconciler.
 */
function makeApi(getImpl) {
  const api = Object.create(ShopifyAPI.prototype);
  api.client = { get: vi.fn(getImpl) };
  return api;
}

describe('ShopifyAPI.getInventoryLevelsByItemIds', () => {
  it('suma available por inventory_item_id a través de ubicaciones', async () => {
    const api = makeApi(async () => ({
      data: {
        inventory_levels: [
          { inventory_item_id: 111, location_id: 1, available: 2 },
          { inventory_item_id: 111, location_id: 2, available: 3 },
          { inventory_item_id: 222, location_id: 1, available: 0 },
        ],
      },
    }));
    const map = await api.getInventoryLevelsByItemIds([111, 222]);
    expect(map.get('111')).toBe(5);
    expect(map.get('222')).toBe(0); // 0 real se respeta (no se confunde con "ausente")
  });

  it('hace lotes de 50 ids (51 ids => 2 llamadas)', async () => {
    const api = makeApi(async () => ({ data: { inventory_levels: [] } }));
    const ids = Array.from({ length: 51 }, (_, i) => i + 1);
    await api.getInventoryLevelsByItemIds(ids);
    expect(api.client.get).toHaveBeenCalledTimes(2);
  });

  it('deduplica ids y omite null/undefined', async () => {
    const api = makeApi(async () => ({ data: { inventory_levels: [] } }));
    await api.getInventoryLevelsByItemIds([1, 1, null, undefined, 2]);
    const url = api.client.get.mock.calls[0][0];
    expect(api.client.get).toHaveBeenCalledTimes(1);
    expect(url).toContain('inventory_item_ids=1,2');
  });

  it('un id sin nivel devuelto queda ausente del Map (el caller hace fallback)', async () => {
    const api = makeApi(async () => ({ data: { inventory_levels: [{ inventory_item_id: 111, available: 4 }] } }));
    const map = await api.getInventoryLevelsByItemIds([111, 999]);
    expect(map.get('111')).toBe(4);
    expect(map.has('999')).toBe(false);
  });
});
