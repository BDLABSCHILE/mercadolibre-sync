import { beforeEach, describe, expect, it, vi } from 'vitest';

const BASE_ENV = {
  MELI_USER_ID: '123',
  MELI_APP_ID: 'app-id',
  MELI_CLIENT_SECRET: 'client-secret',
  MELI_REFRESH_TOKEN: 'env-refresh-token',
};

function resetEnv(overrides = {}) {
  delete process.env.DATABASE_URL;
  delete process.env.MELI_ACCESS_TOKEN;
  Object.assign(process.env, BASE_ENV, overrides);
}

function makeAxiosMock() {
  const client = vi.fn();
  client.defaults = { headers: {} };
  client.interceptors = {
    request: { use: vi.fn() },
    response: { use: vi.fn() },
  };
  client.get = vi.fn();
  client.put = vi.fn();

  return {
    default: {
      create: vi.fn(() => client),
      post: vi.fn(),
    },
    client,
  };
}

async function importApi({ queryMock = vi.fn(), axiosMock = makeAxiosMock() } = {}) {
  vi.resetModules();
  vi.doMock('axios', () => axiosMock);
  vi.doMock('../src/db/index.js', () => ({
    query: queryMock,
  }));
  const mod = await import('../mercadolibre-api.js');
  return { MercadoLibreAPI: mod.default, queryMock, axiosMock };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  resetEnv();
});

describe('MercadoLibreAPI OAuth refresh token persistente', () => {
  it('al refrescar con éxito y recibir refresh_token nuevo, lo persiste con upsert', async () => {
    resetEnv({ DATABASE_URL: 'postgres://user:pass@host/db' });
    const queryMock = vi.fn().mockResolvedValue({
      rows: [{ provider: 'mercadolibre', refresh_token: 'rotated-refresh-token', updated_at: new Date() }],
    });
    const axiosMock = makeAxiosMock();
    axiosMock.default.post.mockResolvedValue({
      data: { access_token: 'new-access-token', refresh_token: 'rotated-refresh-token' },
    });
    const { MercadoLibreAPI } = await importApi({ queryMock, axiosMock });

    const api = new MercadoLibreAPI();
    await api.refreshAccessToken();

    expect(api.refreshToken).toBe('rotated-refresh-token');
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO oauth_credentials'),
      ['mercadolibre', 'rotated-refresh-token'],
    );
  });

  it('si el upsert falla, mantiene el refresh token en memoria y no propaga el error', async () => {
    resetEnv({ DATABASE_URL: 'postgres://user:pass@host/db' });
    const queryMock = vi.fn().mockRejectedValue(new Error('db down'));
    const axiosMock = makeAxiosMock();
    axiosMock.default.post.mockResolvedValue({
      data: { access_token: 'new-access-token', refresh_token: 'memory-only-refresh-token' },
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { MercadoLibreAPI } = await importApi({ queryMock, axiosMock });

    const api = new MercadoLibreAPI();
    await expect(api.refreshAccessToken()).resolves.toBe('new-access-token');

    expect(api.refreshToken).toBe('memory-only-refresh-token');
    expect(warnSpy).toHaveBeenCalledWith(
      '⚠️  No se pudo persistir refresh token de MercadoLibre en DB:',
      'db down',
    );
  });

  it('sin DATABASE_URL refresca igual que antes y no intenta usar DB', async () => {
    resetEnv();
    const queryMock = vi.fn();
    const axiosMock = makeAxiosMock();
    axiosMock.default.post.mockResolvedValue({
      data: { access_token: 'new-access-token', refresh_token: 'rotated-refresh-token' },
    });
    const { MercadoLibreAPI } = await importApi({ queryMock, axiosMock });

    const api = new MercadoLibreAPI();
    await expect(api.refreshAccessToken()).resolves.toBe('new-access-token');

    expect(api.refreshToken).toBe('rotated-refresh-token');
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('al inicializar con una fila existente más nueva en DB, usa esa y no la del env', async () => {
    resetEnv({ DATABASE_URL: 'postgres://user:pass@host/db' });
    const queryMock = vi.fn().mockResolvedValue({
      rows: [{
        provider: 'mercadolibre',
        refresh_token: 'db-refresh-token',
        updated_at: new Date(Date.now() + 60_000),
      }],
    });
    const { MercadoLibreAPI } = await importApi({ queryMock });

    const api = new MercadoLibreAPI();
    await api.initFromDb();

    expect(api.refreshToken).toBe('db-refresh-token');
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining('SELECT provider, refresh_token, updated_at'),
      ['mercadolibre'],
    );
  });
});
