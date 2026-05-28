import { describe, it, expect } from 'vitest';
import { priceForMarketplace, roundUpToEnding, pricesEqual } from '../price.js';

describe('roundUpToEnding', () => {
  it('redondea al próximo número terminado en 990', () => {
    expect(roundUpToEnding(23400)).toBe(23990);
    expect(roundUpToEnding(23660)).toBe(23990);
    expect(roundUpToEnding(24050)).toBe(24990);
  });

  it('si ya termina en 990, lo mantiene (no salta)', () => {
    expect(roundUpToEnding(23990)).toBe(23990);
    expect(roundUpToEnding(24990)).toBe(24990);
    expect(roundUpToEnding(990)).toBe(990);
  });

  it('decimales cerca del próximo 990: redondea hacia arriba', () => {
    expect(roundUpToEnding(24989.9)).toBe(24990);
    expect(roundUpToEnding(24991.2)).toBe(25990);
  });

  it('precio chico: redondea al primer 990 disponible', () => {
    expect(roundUpToEnding(500)).toBe(990);
    expect(roundUpToEnding(100)).toBe(990);
    expect(roundUpToEnding(990)).toBe(990);
  });

  it('precio cero o negativo retorna 0', () => {
    expect(roundUpToEnding(0)).toBe(0);
    expect(roundUpToEnding(-100)).toBe(0);
  });

  it('non-finite retorna null', () => {
    expect(roundUpToEnding(NaN)).toBe(null);
    expect(roundUpToEnding(Infinity)).toBe(null);
  });

  it('ending custom funciona', () => {
    expect(roundUpToEnding(23400, 500)).toBe(23500);
    expect(roundUpToEnding(23400, 0)).toBe(24000);
    expect(roundUpToEnding(23501, 500)).toBe(24500);
  });

  it('ending inválido throws', () => {
    expect(() => roundUpToEnding(100, 1000)).toThrow();
    expect(() => roundUpToEnding(100, -1)).toThrow();
    expect(() => roundUpToEnding(100, 1.5)).toThrow();
  });
});

describe('priceForMarketplace', () => {
  it('aplica markup 1.3 y redondea a 990 (default config Valiz)', () => {
    expect(priceForMarketplace(18000)).toBe(23990);
    expect(priceForMarketplace(18200)).toBe(23990);
    expect(priceForMarketplace(18500)).toBe(24990);
  });

  it('precio Shopify igual al exact ending después de markup', () => {
    // 19223 * 1.3 = 24989.9 → redondeo a 24990
    expect(priceForMarketplace(19223)).toBe(24990);
  });

  it('precio Shopify que cruza el próximo múltiplo', () => {
    // 19224 * 1.3 = 24991.2 → redondeo a 25990
    expect(priceForMarketplace(19224)).toBe(25990);
  });

  it('precios mínimos terminan en 990', () => {
    expect(priceForMarketplace(500)).toBe(990);
    expect(priceForMarketplace(100)).toBe(990);
    expect(priceForMarketplace(1)).toBe(990);
  });

  it('null/undefined/cero/negativo retornan null', () => {
    expect(priceForMarketplace(null)).toBe(null);
    expect(priceForMarketplace(undefined)).toBe(null);
    expect(priceForMarketplace(0)).toBe(null);
    expect(priceForMarketplace(-100)).toBe(null);
  });

  it('string numérico se acepta (parsing)', () => {
    expect(priceForMarketplace('18000')).toBe(23990);
  });

  it('NaN retorna null', () => {
    expect(priceForMarketplace('not a number')).toBe(null);
    expect(priceForMarketplace(NaN)).toBe(null);
  });

  it('markup y ending custom funcionan', () => {
    expect(priceForMarketplace(10000, { markup: 1.4, ending: 990 })).toBe(14990);
    expect(priceForMarketplace(10000, { markup: 1.2, ending: 500 })).toBe(12500);
  });
});

describe('pricesEqual', () => {
  it('precios idénticos son iguales', () => {
    expect(pricesEqual(23990, 23990)).toBe(true);
  });

  it('diferencia menor a 0.5 es igual (tolerancia floats)', () => {
    expect(pricesEqual(23990, 23990.4)).toBe(true);
    expect(pricesEqual(23990, 23989.6)).toBe(true);
  });

  it('diferencia mayor a 0.5 es distinto', () => {
    expect(pricesEqual(23990, 23990.6)).toBe(false);
    expect(pricesEqual(23990, 24990)).toBe(false);
  });

  it('null vs null es igual', () => {
    expect(pricesEqual(null, null)).toBe(true);
  });

  it('null vs número es distinto', () => {
    expect(pricesEqual(null, 23990)).toBe(false);
    expect(pricesEqual(23990, null)).toBe(false);
  });

  it('tolerancia custom funciona', () => {
    expect(pricesEqual(100, 105, 10)).toBe(true);
    expect(pricesEqual(100, 105, 1)).toBe(false);
  });
});
