import { describe, it, expect } from 'vitest';
import { familyForSku, applyOverride, pickOverride, effectivePrice } from '../price-override.js';

describe('familyForSku', () => {
  it('extrae prefijo eliminando el último segmento', () => {
    expect(familyForSku('B-M-NE')).toBe('B-M');
    expect(familyForSku('MA-G-CHA')).toBe('MA-G');
    expect(familyForSku('TJ-C-NE')).toBe('TJ-C');
    expect(familyForSku('BI-G-SENE')).toBe('BI-G');
  });

  it('SKU sin guiones retorna null', () => {
    expect(familyForSku('FOO')).toBe(null);
  });

  it('SKU con un solo guión retorna primer segmento', () => {
    expect(familyForSku('A-B')).toBe('A');
  });

  it('null/undefined/no-string retorna null', () => {
    expect(familyForSku(null)).toBe(null);
    expect(familyForSku(undefined)).toBe(null);
    expect(familyForSku(123)).toBe(null);
    expect(familyForSku('')).toBe(null);
  });

  it('trim de espacios', () => {
    expect(familyForSku(' B-M-NE ')).toBe('B-M');
  });
});

describe('applyOverride', () => {
  const target = 61990;
  const shopify = 47990;

  describe('type=absolute', () => {
    it('retorna el value redondeado', () => {
      expect(applyOverride(target, { overrideType: 'absolute', value: 58990 }, shopify)).toBe(58990);
      expect(applyOverride(target, { overrideType: 'absolute', value: 58989.6 }, shopify)).toBe(58990);
    });

    it('value <= 0 retorna null', () => {
      expect(applyOverride(target, { overrideType: 'absolute', value: 0 }, shopify)).toBe(null);
      expect(applyOverride(target, { overrideType: 'absolute', value: -100 }, shopify)).toBe(null);
    });
  });

  describe('type=discount_fixed', () => {
    it('resta value pesos al target', () => {
      expect(applyOverride(target, { overrideType: 'discount_fixed', value: 3000 }, shopify)).toBe(58990);
      expect(applyOverride(target, { overrideType: 'discount_fixed', value: 10000 }, shopify)).toBe(51990);
    });

    it('descuento >= target retorna 0 (clamp)', () => {
      expect(applyOverride(target, { overrideType: 'discount_fixed', value: 100000 }, shopify)).toBe(0);
      expect(applyOverride(target, { overrideType: 'discount_fixed', value: 61990 }, shopify)).toBe(0);
    });
  });

  describe('type=discount_percent', () => {
    it('aplica descuento porcentual y redondea a 990', () => {
      // 61990 * 0.95 = 58890.5 → redondeo a 58990 hacia arriba
      expect(applyOverride(target, { overrideType: 'discount_percent', value: 5 }, shopify)).toBe(58990);
      // 61990 * 0.9 = 55791 → redondeo a 55990
      expect(applyOverride(target, { overrideType: 'discount_percent', value: 10 }, shopify)).toBe(55990);
    });

    it('porcentaje fuera de [0,100) deja target sin cambios', () => {
      expect(applyOverride(target, { overrideType: 'discount_percent', value: 0 }, shopify)).toBe(target);
      expect(applyOverride(target, { overrideType: 'discount_percent', value: 100 }, shopify)).toBe(target);
      expect(applyOverride(target, { overrideType: 'discount_percent', value: -5 }, shopify)).toBe(target);
    });
  });

  describe('type=custom_markup', () => {
    it('aplica markup custom sobre shopifyPrice', () => {
      // 47990 * 1.4 = 67186 → redondeo a 67990
      expect(applyOverride(target, { overrideType: 'custom_markup', value: 1.4 }, shopify)).toBe(67990);
      // 47990 * 1.2 = 57588 → redondeo a 57990
      expect(applyOverride(target, { overrideType: 'custom_markup', value: 1.2 }, shopify)).toBe(57990);
    });

    it('markup <= 0 retorna null', () => {
      expect(applyOverride(target, { overrideType: 'custom_markup', value: 0 }, shopify)).toBe(null);
      expect(applyOverride(target, { overrideType: 'custom_markup', value: -1 }, shopify)).toBe(null);
    });

    it('shopifyPrice inválido retorna null', () => {
      expect(applyOverride(target, { overrideType: 'custom_markup', value: 1.4 }, null)).toBe(null);
      expect(applyOverride(target, { overrideType: 'custom_markup', value: 1.4 }, 0)).toBe(null);
    });
  });

  describe('cases edge', () => {
    it('override null retorna target sin cambios', () => {
      expect(applyOverride(target, null, shopify)).toBe(target);
    });

    it('value no-finite retorna target sin cambios', () => {
      expect(applyOverride(target, { overrideType: 'absolute', value: NaN }, shopify)).toBe(target);
    });

    it('overrideType desconocido retorna target sin cambios', () => {
      expect(applyOverride(target, { overrideType: 'foo', value: 100 }, shopify)).toBe(target);
    });
  });
});

describe('pickOverride', () => {
  it('si no hay overrides retorna null', () => {
    expect(pickOverride([], 'mercadolibre')).toBe(null);
    expect(pickOverride(null, 'mercadolibre')).toBe(null);
  });

  it('scope=sku gana sobre scope=family', () => {
    const overrides = [
      { scope: 'family', key: 'B-M', platform: 'mercadolibre', value: 100, createdAt: '2026-05-01' },
      { scope: 'sku', key: 'B-M-NE', platform: 'mercadolibre', value: 200, createdAt: '2026-05-01' },
    ];
    expect(pickOverride(overrides, 'mercadolibre').value).toBe(200);
  });

  it('platform específica gana sobre platform=all', () => {
    const overrides = [
      { scope: 'sku', key: 'X', platform: 'all', value: 100, createdAt: '2026-05-01' },
      { scope: 'sku', key: 'X', platform: 'mercadolibre', value: 200, createdAt: '2026-05-01' },
    ];
    expect(pickOverride(overrides, 'mercadolibre').value).toBe(200);
    expect(pickOverride(overrides, 'falabella').value).toBe(100);
  });

  it('tie-breaker: más reciente gana', () => {
    const overrides = [
      { scope: 'sku', key: 'X', platform: 'mercadolibre', value: 100, createdAt: '2026-05-01' },
      { scope: 'sku', key: 'X', platform: 'mercadolibre', value: 200, createdAt: '2026-05-15' },
    ];
    expect(pickOverride(overrides, 'mercadolibre').value).toBe(200);
  });

  it('jerarquía completa: sku-platform > sku-all > family-platform > family-all', () => {
    const overrides = [
      { scope: 'family', key: 'B-M', platform: 'all', value: 1, createdAt: '2026-05-15' },
      { scope: 'family', key: 'B-M', platform: 'mercadolibre', value: 2, createdAt: '2026-05-15' },
      { scope: 'sku', key: 'X', platform: 'all', value: 3, createdAt: '2026-05-15' },
      { scope: 'sku', key: 'X', platform: 'mercadolibre', value: 4, createdAt: '2026-05-15' },
    ];
    expect(pickOverride(overrides, 'mercadolibre').value).toBe(4);
  });
});

describe('effectivePrice', () => {
  it('sin overrides retorna targetBase y override null', () => {
    const r = effectivePrice({
      sku: 'B-M-NE',
      shopifyPrice: 47990,
      targetBase: 61990,
      overrides: [],
      platform: 'mercadolibre',
    });
    expect(r.effective).toBe(61990);
    expect(r.override).toBe(null);
  });

  it('con override descuento aplicado correctamente', () => {
    const r = effectivePrice({
      sku: 'B-M-NE',
      shopifyPrice: 47990,
      targetBase: 61990,
      overrides: [{ scope: 'sku', key: 'B-M-NE', platform: 'mercadolibre', overrideType: 'discount_fixed', value: 3000, createdAt: '2026-05-15' }],
      platform: 'mercadolibre',
    });
    expect(r.effective).toBe(58990);
    expect(r.override).not.toBe(null);
  });
});
