import { describe, it, expect, vi } from 'vitest';
import FalabellaAPI from '../falabella-api.js';

/**
 * Regresión del bug que dejó 9 ventas de Falabella (28-29 may 2026) sin descontar stock:
 * getOrderItems buscaba los items en data.OrderItems, pero Falabella los envuelve en
 * data.SuccessResponse.Body.OrderItems → siempre devolvía [] y la orden parecía "sin items".
 * Además debe usar el SKU del vendedor (Sku = "MA-C-CAR"), no ShopSku (id numérico).
 */
function makeApi(rawResponse) {
  const api = Object.create(FalabellaAPI.prototype);
  api.enabled = true;
  api.call = vi.fn().mockResolvedValue(rawResponse);
  return api;
}

// Respuesta real de Falabella GetOrderItems (orden 1155057619)
const REAL_RESPONSE = {
  SuccessResponse: {
    Head: { RequestAction: 'GetOrderItems', ResponseType: 'OrderItems' },
    Body: {
      OrderItems: {
        OrderItem: {
          OrderItemId: '21538787',
          OrderId: '1155057619',
          Name: 'MOCHILA ALFORJA CHICA VALIZ - 100% CUERO',
          Sku: 'MA-C-CAR',
          ShopSku: '151288338',
          Status: 'shipped',
        },
      },
    },
  },
};

describe('FalabellaAPI.getOrderItems', () => {
  it('desenvuelve SuccessResponse.Body y devuelve el SKU del vendedor', async () => {
    const api = makeApi(JSON.stringify(REAL_RESPONSE));
    const items = await api.getOrderItems('1155057619');
    expect(items).toEqual([
      { sku: 'MA-C-CAR', quantity: 1, orderItemId: '21538787' },
    ]);
  });

  it('acepta respuesta ya parseada (objeto, no string)', async () => {
    const api = makeApi(REAL_RESPONSE);
    const items = await api.getOrderItems('1155057619');
    expect(items[0].sku).toBe('MA-C-CAR');
  });

  it('prefiere Sku sobre ShopSku (no descuenta por el id numérico de Falabella)', async () => {
    const api = makeApi(JSON.stringify(REAL_RESPONSE));
    const items = await api.getOrderItems('1155057619');
    expect(items[0].sku).not.toBe('151288338');
  });

  it('soporta múltiples items (OrderItem como array)', async () => {
    const multi = {
      SuccessResponse: {
        Body: {
          OrderItems: {
            OrderItem: [
              { OrderItemId: '1', Sku: 'MA-C-NE', Quantity: '1' },
              { OrderItemId: '2', Sku: 'MA-C-MIEL', Quantity: '2' },
            ],
          },
        },
      },
    };
    const api = makeApi(JSON.stringify(multi));
    const items = await api.getOrderItems('999');
    expect(items).toEqual([
      { sku: 'MA-C-NE', quantity: 1, orderItemId: '1' },
      { sku: 'MA-C-MIEL', quantity: 2, orderItemId: '2' },
    ]);
  });

  it('lanza error ante ErrorResponse (no lo enmascara como orden vacía)', async () => {
    const err = { ErrorResponse: { Head: { ErrorCode: 'E009', ErrorMessage: 'Access Denied' } } };
    const api = makeApi(JSON.stringify(err));
    await expect(api.getOrderItems('999')).rejects.toThrow(/E009/);
  });
});
