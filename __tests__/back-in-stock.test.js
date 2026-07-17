import { describe, it, expect, vi } from 'vitest';
import {
  normalizeSubscription, normalizePhone, handleSubscribe,
  notifyPendingForSku, notifyPendingFromStockMap, sweepPendingOnBoot,
} from '../src/services/back-in-stock.js';
import { buildTrackBody } from '../src/services/pulpo.js';
import { makeProductCache } from '../src/services/shopify-product-cache.js';

/* ============ Validación del formulario ============ */

describe('normalizeSubscription', () => {
  it('acepta input válido y normaliza email/sku', () => {
    const r = normalizeSubscription({ sku: ' bi-g-cam ', email: ' Persona@Mail.COM ' });
    expect(r.ok).toBe(true);
    expect(r.value.sku).toBe('BI-G-CAM');
    expect(r.value.email).toBe('persona@mail.com');
  });

  it('rechaza email inválido', () => {
    expect(normalizeSubscription({ sku: 'X', email: 'no-es-mail' }).ok).toBe(false);
    expect(normalizeSubscription({ sku: 'X', email: '' }).ok).toBe(false);
  });

  it('rechaza SKU inválido (caracteres raros / vacío)', () => {
    expect(normalizeSubscription({ sku: 'a b<script>', email: 'a@b.cl' }).ok).toBe(false);
    expect(normalizeSubscription({ sku: '', email: 'a@b.cl' }).ok).toBe(false);
  });

  it('honeypot lleno → ok:true sin value (fingir éxito al bot)', () => {
    const r = normalizeSubscription({ sku: 'X', email: 'a@b.cl', website: 'spam.com' });
    expect(r.ok).toBe(true);
    expect(r.honeypot).toBe(true);
    expect(r.value).toBeUndefined();
  });

  it('teléfono inválido se descarta sin bloquear la suscripción', () => {
    const r = normalizeSubscription({ sku: 'X-1', email: 'a@b.cl', phone: 'abc' });
    expect(r.ok).toBe(true);
    expect(r.value.phone).toBeNull();
  });
});

describe('normalizePhone', () => {
  it('normaliza formatos chilenos comunes a E.164', () => {
    expect(normalizePhone('987654321')).toBe('+56987654321');
    expect(normalizePhone('56987654321')).toBe('+56987654321');
    expect(normalizePhone('+56 9 8765 4321')).toBe('+56987654321');
    expect(normalizePhone('(56) 9-8765-4321')).toBe('+56987654321');
  });
  it('rechaza basura', () => {
    expect(normalizePhone('abc')).toBeNull();
    expect(normalizePhone('123')).toBeNull();
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });
});

/* ============ handleSubscribe (lógica del endpoint) ============ */

function makeSubscribeDeps({ product, pendingCount = 0, pulpoEnabled = true } = {}) {
  return {
    getProduct: vi.fn(async () => product ?? null),
    repo: {
      countPendingByEmail: vi.fn(async () => pendingCount),
      subscribe: vi.fn(async (v) => ({ entry: { ...v, id: 1 }, isNew: true })),
    },
    pulpo: {
      isEnabled: () => pulpoEnabled,
      upsertProfile: vi.fn(async () => ({ ok: true })),
    },
    logger: { info: vi.fn(), warn: vi.fn() },
  };
}

describe('handleSubscribe', () => {
  it('SKU desconocido en la tienda → 400 (no se guarda basura)', async () => {
    const deps = makeSubscribeDeps({ product: null });
    const r = await handleSubscribe({ sku: 'NO-EXISTE', email: 'a@b.cl' }, deps);
    expect(r.status).toBe(400);
    expect(deps.repo.subscribe).not.toHaveBeenCalled();
  });

  it('producto CON stock → ok pero NO guarda (cierra bombing de avisos)', async () => {
    const deps = makeSubscribeDeps({ product: { title: 'P', url: 'u', stock: 5 } });
    const r = await handleSubscribe({ sku: 'X-1', email: 'a@b.cl' }, deps);
    expect(r.status).toBe(200);
    expect(r.body.available).toBe(true);
    expect(deps.repo.subscribe).not.toHaveBeenCalled();
  });

  it('producto agotado → guarda con título/URL del SERVIDOR (ignora los del cliente)', async () => {
    const deps = makeSubscribeDeps({ product: { title: 'Título Real', url: 'https://www.valiz.cl/products/real', stock: 0 } });
    const r = await handleSubscribe(
      { sku: 'x-1', email: 'A@b.cl', productTitle: 'Llama al +569 phishing', productUrl: 'https://evil.com' },
      deps,
    );
    expect(r.status).toBe(200);
    const saved = deps.repo.subscribe.mock.calls[0][0];
    expect(saved.productTitle).toBe('Título Real');
    expect(saved.productUrl).toBe('https://www.valiz.cl/products/real');
    expect(saved.sku).toBe('X-1');
  });

  it('tope de esperas por correo → 429', async () => {
    const deps = makeSubscribeDeps({ product: { title: 'P', url: 'u', stock: 0 }, pendingCount: 10 });
    const r = await handleSubscribe({ sku: 'X-1', email: 'a@b.cl' }, deps);
    expect(r.status).toBe(429);
    expect(deps.repo.subscribe).not.toHaveBeenCalled();
  });

  it('upsert a Pulpo va SOLO con email (sin phone, sin consent)', async () => {
    const deps = makeSubscribeDeps({ product: { title: 'P', url: 'u', stock: 0 } });
    await handleSubscribe({ sku: 'X-1', email: 'a@b.cl', phone: '987654321' }, deps);
    expect(deps.pulpo.upsertProfile).toHaveBeenCalledWith({ email: 'a@b.cl' });
  });

  it('honeypot → 200 sin tocar nada', async () => {
    const deps = makeSubscribeDeps({ product: { title: 'P', url: 'u', stock: 0 } });
    const r = await handleSubscribe({ sku: 'X-1', email: 'a@b.cl', website: 'bot' }, deps);
    expect(r.status).toBe(200);
    expect(deps.getProduct).not.toHaveBeenCalled();
    expect(deps.repo.subscribe).not.toHaveBeenCalled();
  });
});

/* ============ Payload a Pulpo ============ */

describe('buildTrackBody', () => {
  it('arma el evento back_in_stock con properties sanitizadas', () => {
    const b = buildTrackBody({
      email: 'a@b.cl', sku: 'BI-G-CAM',
      productName: 'Billetera <b>Grande</b>', productUrl: 'https://www.valiz.cl/products/x',
    });
    expect(b.event).toBe('back_in_stock');
    expect(b.email).toBe('a@b.cl');
    expect(b.properties.productName).toBe('Billetera bGrande/b'); // sin < >
    expect(b.properties.sku).toBe('BI-G-CAM');
  });

  it('manda email Y phone juntos (Pulpo adjunta el teléfono al contacto → aviso WhatsApp)', () => {
    const b = buildTrackBody({ email: 'a@b.cl', phone: '+56911111111', sku: 'X' });
    expect(b.email).toBe('a@b.cl');
    expect(b.phone).toBe('+56911111111');
  });

  it('recorta strings largos a 500', () => {
    const b = buildTrackBody({ email: 'a@b.cl', sku: 'X', productName: 'z'.repeat(900) });
    expect(b.properties.productName.length).toBe(500);
  });
});

/* ============ Notificador ============ */

function makeNotifyDeps({ pending = [], enabled = true, trackImpl, claimImpl } = {}) {
  const deps = {
    repo: {
      listPendingBySku: vi.fn(async () => pending),
      claimEntry: vi.fn(claimImpl || (async (id) => pending.find((p) => p.id === id) || null)),
      markSent: vi.fn(async () => {}),
      releaseClaim: vi.fn(async () => {}),
      pendingSkus: vi.fn(async () => [...new Set(pending.map((c) => c.sku.toUpperCase()))]),
      recoverStaleClaims: vi.fn(async () => 0),
    },
    pulpo: {
      isEnabled: () => enabled,
      trackBackInStock: vi.fn(trackImpl || (async () => ({ ok: true }))),
    },
    logger: { info: vi.fn(), warn: vi.fn() },
    delayMs: 0,
  };
  return deps;
}

describe('notifyPendingForSku', () => {
  it('sin stock → no toca nada', async () => {
    const deps = makeNotifyDeps();
    const r = await notifyPendingForSku('X', 0, deps);
    expect(r.skipped).toBe('no_stock');
    expect(deps.repo.listPendingBySku).not.toHaveBeenCalled();
  });

  it('Pulpo apagado → no reclama (las esperas quedan pendientes)', async () => {
    const deps = makeNotifyDeps({ enabled: false });
    const r = await notifyPendingForSku('X', 5, deps);
    expect(r.skipped).toBe('pulpo_disabled');
    expect(deps.repo.claimEntry).not.toHaveBeenCalled();
  });

  it('claim POR FILA antes de cada envío; marca enviado', async () => {
    const pending = [
      { id: 1, sku: 'X', email: 'a@b.cl', phone: null, productTitle: 'P', productUrl: null },
      { id: 2, sku: 'X', email: 'c@d.cl', phone: '+56911111111', productTitle: 'P', productUrl: null },
    ];
    const deps = makeNotifyDeps({ pending });
    const r = await notifyPendingForSku('X', 3, deps);
    expect(r.notified).toBe(2);
    expect(deps.repo.claimEntry).toHaveBeenCalledTimes(2);
    expect(deps.repo.markSent).toHaveBeenCalledWith(1);
    expect(deps.repo.markSent).toHaveBeenCalledWith(2);
  });

  it('claim perdido (otro proceso la tomó) → salta sin avisar dos veces', async () => {
    const pending = [{ id: 1, sku: 'X', email: 'a@b.cl' }];
    const deps = makeNotifyDeps({ pending, claimImpl: async () => null });
    const r = await notifyPendingForSku('X', 3, deps);
    expect(r.notified).toBe(0);
    expect(deps.pulpo.trackBackInStock).not.toHaveBeenCalled();
  });

  it('fallo de Pulpo → releaseClaim (vuelve a pendiente) y sigue con el resto', async () => {
    const pending = [
      { id: 1, sku: 'X', email: 'a@b.cl' },
      { id: 2, sku: 'X', email: 'c@d.cl' },
    ];
    let n = 0;
    const deps = makeNotifyDeps({
      pending,
      trackImpl: async () => { n++; if (n === 1) throw new Error('boom'); return { ok: true }; },
    });
    const r = await notifyPendingForSku('X', 3, deps);
    expect(r.notified).toBe(1);
    expect(r.failed).toBe(1);
    expect(deps.repo.releaseClaim).toHaveBeenCalledWith(1, 'boom');
    expect(deps.repo.markSent).toHaveBeenCalledWith(2);
  });

  it('un aviso por persona por barrido: correo repetido queda deferred (sin claim)', async () => {
    const pending = [{ id: 1, sku: 'X', email: 'a@b.cl' }];
    const deps = makeNotifyDeps({ pending });
    const skipEmails = new Set(['a@b.cl']);
    const r = await notifyPendingForSku('X', 3, deps, { skipEmails });
    expect(r.deferred).toBe(1);
    expect(r.notified).toBe(0);
    expect(deps.repo.claimEntry).not.toHaveBeenCalled(); // sigue pendiente para el próximo ciclo
  });
});

describe('notifyPendingFromStockMap', () => {
  it('matchea SKUs case-insensitive (waitlist MAYÚSCULA vs Shopify tal cual)', async () => {
    const pending = [{ id: 1, sku: 'BI-G-CAM', email: 'a@b.cl' }];
    const deps = makeNotifyDeps({ pending });
    // Shopify entrega el SKU en minúscula → igual debe matchear
    const map = new Map([['bi-g-cam', 4]]);
    const r = await notifyPendingFromStockMap(map, deps);
    expect(r.notified).toBe(1);
  });

  it('recupera claims huérfanos antes de avisar', async () => {
    const deps = makeNotifyDeps();
    deps.repo.recoverStaleClaims = vi.fn(async () => 2);
    const r = await notifyPendingFromStockMap(new Map(), deps);
    expect(r.recovered).toBe(2);
    expect(deps.repo.recoverStaleClaims).toHaveBeenCalled();
  });

  it('mismo correo esperando 2 SKUs que reponen juntos → solo 1 aviso este barrido', async () => {
    const rows = {
      A: [{ id: 1, sku: 'A', email: 'a@b.cl' }],
      B: [{ id: 2, sku: 'B', email: 'a@b.cl' }],
    };
    const deps = makeNotifyDeps();
    deps.repo.pendingSkus = vi.fn(async () => ['A', 'B']);
    deps.repo.listPendingBySku = vi.fn(async (sku) => rows[sku] || []);
    deps.repo.claimEntry = vi.fn(async (id) => (id === 1 ? rows.A[0] : rows.B[0]));
    const map = new Map([['A', 2], ['B', 3]]);
    const r = await notifyPendingFromStockMap(map, deps);
    expect(r.notified).toBe(1);
    expect(r.deferred).toBe(1);
    expect(deps.pulpo.trackBackInStock).toHaveBeenCalledTimes(1);
  });

  it('un error interno no lanza (la reconciliación no se cae por esto)', async () => {
    const deps = makeNotifyDeps();
    deps.repo.recoverStaleClaims = vi.fn(async () => { throw new Error('db caída'); });
    const r = await notifyPendingFromStockMap(new Map(), deps);
    expect(r.notified).toBe(0);
    expect(deps.logger.warn).toHaveBeenCalled();
  });
});

describe('sweepPendingOnBoot', () => {
  it('consulta stock solo de los SKUs pendientes y avisa los repuestos', async () => {
    const pending = [{ id: 1, sku: 'X', email: 'a@b.cl' }];
    const deps = makeNotifyDeps({ pending });
    const getStock = vi.fn(async () => 4);
    const r = await sweepPendingOnBoot(deps, getStock);
    expect(getStock).toHaveBeenCalledWith('X');
    expect(r.notified).toBe(1);
  });

  it('sin pendientes → no consulta Shopify', async () => {
    const deps = makeNotifyDeps({ pending: [] });
    const getStock = vi.fn();
    await sweepPendingOnBoot(deps, getStock);
    expect(getStock).not.toHaveBeenCalled();
  });
});

/* ============ Cache de productos Shopify ============ */

describe('makeProductCache', () => {
  const products = [
    { title: 'Billetera Grande Camel', handle: 'billetera-grande-camel', variants: [{ sku: 'bi-g-cam', inventory_quantity: 0 }] },
    { title: 'Mochila', handle: 'mochila', variants: [{ sku: 'MA-G-CAR', inventory_quantity: 6 }, { sku: '', inventory_quantity: 1 }] },
  ];

  it('indexa por SKU en mayúscula con título/URL/stock del server', async () => {
    const cache = makeProductCache({ getAllProducts: vi.fn(async () => products) });
    const p = await cache.getBySku('bi-g-cam');
    expect(p.title).toBe('Billetera Grande Camel');
    expect(p.url).toBe('https://www.valiz.cl/products/billetera-grande-camel');
    expect(p.stock).toBe(0);
    expect(await cache.getBySku('ma-g-car')).toMatchObject({ stock: 6 });
    expect(await cache.getBySku('NO-EXISTE')).toBeNull();
  });

  it('respeta el TTL (no recarga dentro de la ventana)', async () => {
    const getAllProducts = vi.fn(async () => products);
    const cache = makeProductCache({ getAllProducts }, { ttlMs: 60_000 });
    await cache.getBySku('BI-G-CAM');
    await cache.getBySku('MA-G-CAR');
    expect(getAllProducts).toHaveBeenCalledTimes(1);
  });
});
