import axios from 'axios';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

function rfc3986Encode(str) {
  return encodeURIComponent(str)
    .replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function isoTimestamp() {
  // Seller Center usa ISO8601 (ej: 2015-07-01T11:11:11+00:00)
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  const mm = pad(d.getUTCMonth() + 1);
  const dd = pad(d.getUTCDate());
  const hh = pad(d.getUTCHours());
  const mi = pad(d.getUTCMinutes());
  const ss = pad(d.getUTCSeconds());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}+00:00`;
}

function buildSignedQuery({ apiKey, params }) {
  const entries = Object.entries(params)
    .filter(([k]) => k !== 'Signature')
    .map(([k, v]) => [String(k), String(v)]);

  entries.sort(([a], [b]) => a.localeCompare(b));

  const concatenated = entries
    .map(([k, v]) => `${rfc3986Encode(k)}=${rfc3986Encode(v)}`)
    .join('&');

  const signature = crypto
    .createHmac('sha256', String(apiKey))
    .update(concatenated, 'utf8')
    .digest('hex');

  const full = `${concatenated}&Signature=${rfc3986Encode(signature)}`;
  return full;
}

/**
 * Extrae mensaje y código de ErrorResponse de Falabella y lanza Error con mensaje claro.
 * E009 = Access Denied → suele ser SKU no existente en catálogo Falabella o problema de permisos.
 */
function assertNoErrorResponse(xml) {
  const s = String(xml || '');
  if (!/<ErrorResponse\b/i.test(s) && !/<Errors\b/i.test(s)) return;

  const msgMatch = s.match(/<ErrorMessage[^>]*>([\s\S]*?)<\/ErrorMessage>/i) ||
                   s.match(/<Message[^>]*>([\s\S]*?)<\/Message>/i) ||
                   s.match(/<Error[^>]*>([\s\S]*?)<\/Error>/i);
  const rawMsg = msgMatch ? msgMatch[1].trim() : 'Falabella Seller Center API error';
  const codeMatch = rawMsg.match(/E(\d+)/i);
  const code = codeMatch ? codeMatch[0].toUpperCase() : null;

  let message = rawMsg;
  if (code === 'E009' || /Access Denied/i.test(rawMsg)) {
    message = `E009: Access Denied. El SKU puede no existir en tu catálogo de Falabella o hay un problema de credenciales/permisos. (API: ${rawMsg})`;
  }
  throw new Error(message);
}

export default class FalabellaAPI {
  constructor() {
    const enableFalabella = String(process.env.ENABLE_FALABELLA || 'false').toLowerCase() === 'true';
    
    if (!enableFalabella) {
      // Stub mode: no inicializar cliente real
      this.enabled = false;
      return;
    }

    this.host = process.env.FALABELLA_SC_API_HOST || 'https://sellercenter-api.falabella.com';
    this.userId = process.env.FALABELLA_USER_ID;
    this.apiKey = process.env.FALABELLA_API_KEY;
    this.version = process.env.FALABELLA_API_VERSION || '1.0';
    this.format = process.env.FALABELLA_API_FORMAT || 'XML';
    // Código de país para BusinessUnits: facl=Chile, fape=Perú, faco=Colombia (requerido por ProductUpdate)
    this.operatorCode = process.env.FALABELLA_OPERATOR_CODE || 'facl';

    if (!this.userId || !this.apiKey) {
      throw new Error('FALABELLA_USER_ID y FALABELLA_API_KEY deben estar configurados en .env');
    }

    this.enabled = true;
    this.client = axios.create({
      baseURL: this.host,
      timeout: parseInt(process.env.FALABELLA_HTTP_TIMEOUT_MS || '30000', 10),
      headers: {
        'User-Agent': 'valiz-stock-sync/1.0',
      },
      transformResponse: r => r,
    });
    this.setup429Retry();
  }

  /** Reintento con backoff ante 429 (rate limit). */
  setup429Retry() {
    this.client.interceptors.response.use(
      (res) => res,
      async (err) => {
        const config = err.config;
        if (err.response?.status !== 429 || !config || (config._retry429Count || 0) >= 2) return Promise.reject(err);
        config._retry429Count = (config._retry429Count || 0) + 1;
        const waitMs = config._retry429Count === 1 ? 8000 : 20000;
        console.warn(`⚠️  Falabella 429 (rate limit). Esperando ${waitMs / 1000}s antes de reintento ${config._retry429Count}/2...`);
        await new Promise(r => setTimeout(r, waitMs));
        return this.client(config);
      }
    );
  }

  _notEnabled() {
    throw new Error('Falabella API not enabled. Set ENABLE_FALABELLA=true');
  }

  async call(action, extraParams = {}, { method = 'GET', bodyXml = null } = {}) {
    if (!this.enabled) {
      this._notEnabled();
    }

    const params = {
      Action: action,
      Format: this.format,
      Timestamp: isoTimestamp(),
      UserID: this.userId,
      Version: this.version,
      ...extraParams,
    };

    const qs = buildSignedQuery({ apiKey: this.apiKey, params });
    const url = `/?${qs}`;

    const reqMethod = String(method).toUpperCase();
    if (reqMethod === 'POST') {
      const res = await this.client.post(url, bodyXml || '', {
        headers: {
          'Content-Type': 'application/xml; charset=UTF-8',
        },
      });
      assertNoErrorResponse(res.data);
      return res.data;
    }

    const res = await this.client.get(url);
    assertNoErrorResponse(res.data);
    return res.data;
  }

  /** POST firmado; devuelve la respuesta completa para logging. */
  async _postWithResponse(action, bodyXml) {
    const params = {
      Action: action,
      Format: this.format,
      Timestamp: isoTimestamp(),
      UserID: this.userId,
      Version: this.version,
    };
    const qs = buildSignedQuery({ apiKey: this.apiKey, params });
    const url = `/?${qs}`;
    const res = await this.client.post(url, bodyXml || '', {
      headers: { 'Content-Type': 'application/xml; charset=UTF-8' },
    });
    return res;
  }

  /** Resumen del body para logs (máx ~200 chars). */
  _summarizeBody(body) {
    const s = String(body || '').trim();
    if (!s) return '(vacío)';
    if (s.length <= 200) return s;
    return s.slice(0, 200) + '...';
  }

  /**
   * Obtiene listado completo de productos del seller con su stock y precio actual.
   * Usado por el reconciliador para detectar drift sin hacer 1 call por SKU.
   *
   * @returns {Promise<Map<string, {stock: number, price: number, salePrice: number|null, parentSku: string|null}>>}
   *   Map keyed por SellerSku.
   */
  async getAllProducts() {
    if (!this.enabled) return new Map();
    const out = new Map();
    let offset = 0;
    const limit = 100;
    const maxIterations = 30; // safety: 30*100 = 3000 productos máximo

    for (let i = 0; i < maxIterations; i++) {
      const extraParams = { Format: 'JSON', Limit: limit, Offset: offset };
      let raw;
      try {
        raw = await this.call('GetProducts', extraParams, { method: 'GET' });
      } catch (err) {
        console.error(`[Falabella getAllProducts] error en offset ${offset}:`, err.message);
        throw err;
      }
      const data = typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : raw;
      if (!data) throw new Error('Falabella GetProducts: respuesta no parseable');

      if (data.ErrorResponse) {
        const head = data.ErrorResponse.Head ?? data.ErrorResponse;
        const code = head?.ErrorCode ?? 'unknown';
        const msg = head?.ErrorMessage ?? JSON.stringify(data.ErrorResponse);
        throw new Error(`Falabella GetProducts: ${code} - ${msg}`);
      }

      const body = data.SuccessResponse?.Body ?? data.Body;
      let productsData = body?.Products?.Product ?? body?.Products ?? [];
      if (productsData === '' || productsData == null) productsData = [];
      const arr = Array.isArray(productsData) ? productsData : [productsData];

      for (const p of arr) {
        if (!p) continue;
        const sku = String(p.SellerSku ?? '').trim();
        if (!sku) continue;
        // Extraer Stock y Price de BusinessUnits (puede haber varios; tomamos el primero del operatorCode configurado)
        let stock = null;
        let price = null;
        let salePrice = null;
        const bus = p.BusinessUnits?.BusinessUnit ?? p.BusinessUnits ?? [];
        const buArr = Array.isArray(bus) ? bus : [bus];
        for (const bu of buArr) {
          if (!bu) continue;
          if (this.operatorCode && bu.OperatorCode && String(bu.OperatorCode) !== this.operatorCode) continue;
          if (bu.Stock != null) stock = parseInt(bu.Stock, 10);
          if (bu.Price != null) price = parseFloat(bu.Price);
          if (bu.SalePrice != null) salePrice = parseFloat(bu.SalePrice);
          break;
        }
        // Fallback: si no hay BU del operatorCode, intentar nivel raíz
        if (stock == null && p.Quantity != null) stock = parseInt(p.Quantity, 10);
        if (price == null && p.Price != null) price = parseFloat(p.Price);

        out.set(sku, {
          stock: Number.isFinite(stock) ? stock : null,
          price: Number.isFinite(price) ? price : null,
          salePrice: Number.isFinite(salePrice) ? salePrice : null,
          parentSku: p.ParentSku ?? null,
        });
      }

      if (arr.length < limit) break;
      offset += arr.length;
    }

    return out;
  }

  /**
   * Obtiene listado de órdenes (GetOrders)
   * Rango fijo: últimos 30 días. Sin filtro Status.
   * @param {Object} options - Opciones de filtrado
   * @param {number} options.limit - Límite (default 100)
   * @param {number} options.offset - Offset para paginación
   * @returns {Promise<Array<{id: string, total: number, created_at: string, status: string}>>}
   */
  async getOrders(options = {}) {
    if (!this.enabled) return [];

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const from = thirtyDaysAgo.toISOString().slice(0, 19) + '+00:00';
    const to = now.toISOString().slice(0, 19) + '+00:00';

    console.log(`   [Falabella] CreatedAfter=${from}`);
    console.log(`   [Falabella] CreatedBefore=${to}`);

    const extraParams = {
      Format: 'JSON',
      Version: '1.0',
      Limit: options.limit || 100,
      Offset: options.offset || 0,
      CreatedAfter: from,
      CreatedBefore: to,
    };
    // NO Status parameter

    const raw = await this.call('GetOrders', extraParams, { method: 'GET' });
    if (process.env.DEBUG_FALABELLA === '1') {
      console.log('   [DEBUG] Falabella GetOrders respuesta:', String(raw).slice(0, 1200));
    }
    let data = typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : raw;
    if (!data && typeof raw === 'string' && (raw.trim().startsWith('<?xml') || raw.trim().startsWith('<'))) {
      try {
        const { XMLParser } = await import('fast-xml-parser');
        const parser = new XMLParser({ ignoreAttributes: false });
        data = parser.parse(raw);
      } catch (e) {
        console.warn('   Falabella: no se pudo parsear respuesta como JSON ni XML');
      }
    }
    if (!data) {
      throw new Error('Falabella API: no se pudo parsear respuesta como JSON ni XML');
    }

    if (data.ErrorResponse) {
      const head = data.ErrorResponse.Head ?? data.ErrorResponse;
      const body = data.ErrorResponse.Body ?? data.ErrorResponse;
      const err = body?.Error ?? head;
      const code = err?.Code ?? err?.ErrorCode ?? head?.ErrorCode ?? 'unknown';
      const msg = err?.Message ?? err?.ErrorMessage ?? head?.ErrorMessage ?? JSON.stringify(data.ErrorResponse);
      console.error(`   [Falabella] ErrorResponse: ErrorCode=${code}, ErrorMessage=${msg}`);
      throw new Error(`Falabella API Error: ${code} - ${msg}`);
    }

    const totalCount = data.Head?.TotalCount ?? data.SuccessResponse?.Head?.TotalCount ?? data.TotalCount;
    if (totalCount !== undefined && totalCount !== null) {
      console.log(`   [Falabella] TotalCount=${totalCount}`);
    }

    const body = data.SuccessResponse?.Body ?? data.Body;
    let ordersData = body?.Orders?.Order ?? body?.Orders;
    if (ordersData === '' || ordersData == null) ordersData = [];
    const arr = Array.isArray(ordersData) ? ordersData : [ordersData];
    if (process.env.DEBUG_FALABELLA === '1') {
      console.log('   [DEBUG] ordersData type:', typeof ordersData, 'arr.length:', arr.length, 'data keys:', Object.keys(data));
    }
    if (arr.length === 0 && (data.Head?.TotalCount ?? data.TotalCount ?? 0) > 0) {
      console.warn('   Falabella: TotalCount=', data.Head?.TotalCount ?? data.TotalCount, 'pero estructura diferente. Keys:', JSON.stringify(Object.keys(data)));
    }
    const result = [];

    for (const o of arr) {
      if (!o) continue;
      const price = parseFloat(o.Price ?? o.price ?? 0);
      const createdAt = o.CreatedAt ?? o.created_at ?? o.UpdatedAt ?? o.updated_at ?? new Date().toISOString();
      const statuses = o.Statuses?.Status ?? o.Statuses ?? o.status ?? [];
      const status = Array.isArray(statuses) ? statuses[0] : statuses;
      result.push({
        id: String(o.OrderId ?? o.OrderNumber ?? o.order_id ?? ''),
        total: price,
        currency: 'CLP',
        created_at: createdAt,
        status: status || 'unknown',
      });
    }

    return result;
  }

  /**
   * Obtiene los items de una orden (GetOrderItems).
   * @param {string|number} orderId - ID de la orden
   * @returns {Promise<Array<{sku: string, quantity: number}>>}
   */
  async getOrderItems(orderId) {
    if (!this.enabled) return [];
    if (!orderId && orderId !== 0) return [];

    const raw = await this.call('GetOrderItems', { OrderId: String(orderId), Format: 'JSON' }, { method: 'GET' });
    const data = typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : raw;
    if (!data) return [];

    // Falabella envuelve la respuesta en SuccessResponse.Body. Si no se desenvuelve,
    // data.OrderItems queda undefined y la orden parece "sin items" → nunca descuenta stock.
    if (data.ErrorResponse) {
      const err = data.ErrorResponse.Head ?? data.ErrorResponse;
      const code = err?.ErrorCode ?? err?.Code ?? 'unknown';
      const msg = err?.ErrorMessage ?? err?.Message ?? JSON.stringify(data.ErrorResponse);
      throw new Error(`Falabella GetOrderItems Error: ${code} - ${msg}`);
    }
    const body = data.SuccessResponse?.Body ?? data.Body ?? data;
    const items = body.OrderItems?.OrderItem ?? body.OrderItems ?? body.order_items ?? [];
    const arr = Array.isArray(items) ? items : [items];
    const result = [];
    for (let i = 0; i < arr.length; i++) {
      const it = arr[i];
      // Preferir el SKU del vendedor (Sku = "MA-C-CAR"), NO ShopSku (id numérico de Falabella).
      const sku = it.Sku ?? it.sku ?? it.seller_sku ?? it.SellerSku ?? it.ShopSku ?? '';
      const qty = parseInt(it.Quantity ?? it.quantity ?? it.qty ?? '1', 10) || 1;
      const itemId = it.OrderItemId ?? it.order_item_id ?? `item-${i}`;
      if (sku && String(sku).trim()) result.push({ sku: String(sku).trim(), quantity: qty, orderItemId: itemId });
    }
    return result;
  }

  /**
   * Actualiza stock por SKU usando ProductUpdate (Seller Center API).
   */
  async updateStockBySKU(sku, quantity) {
    return this._productUpdate(sku, { stock: quantity });
  }

  /**
   * Actualiza precio por SKU usando ProductUpdate.
   */
  async updatePriceBySKU(sku, price) {
    return this._productUpdate(sku, { price });
  }

  /**
   * Actualiza stock y precio en una sola llamada.
   */
  async updateStockAndPriceBySKU(sku, quantity, price) {
    return this._productUpdate(sku, { stock: quantity, price });
  }

  /**
   * Internal: construye y envía ProductUpdate XML con stock y/o price opcionales.
   * @param {string} sku
   * @param {{stock?: number, price?: number}} fields
   */
  async _productUpdate(sku, { stock, price } = {}) {
    if (!this.enabled) {
      this._notEnabled();
    }
    const safeSku = String(sku).trim();
    if (!safeSku) throw new Error('SKU vacío o inválido');

    const lines = [];
    if (stock != null) {
      const q = Math.max(0, Math.floor(Number(stock) || 0));
      lines.push(`        <Stock>${q}</Stock>`);
    }
    if (price != null) {
      const p = Number(price);
      if (!Number.isFinite(p) || p <= 0) throw new Error(`Falabella precio inválido: ${price}`);
      lines.push(`        <Price>${p}</Price>`);
    }
    if (lines.length === 0) {
      throw new Error('_productUpdate: nada que actualizar (stock y price ambos null)');
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Request>
  <Product>
    <SellerSku>${safeSku}</SellerSku>
    <BusinessUnits>
      <BusinessUnit>
        <OperatorCode>${this.operatorCode}</OperatorCode>
${lines.join('\n')}
      </BusinessUnit>
    </BusinessUnits>
  </Product>
</Request>`;

    console.log(`📤 ProductUpdate SKU=${safeSku} stock=${stock ?? '-'} price=${price ?? '-'}`);
    const res = await this._postWithResponse('ProductUpdate', xml);
    assertNoErrorResponse(res.data);
    console.log('✅ Falabella actualizado correctamente');

    return { rawXml: String(res.data || ''), requested: { sku: safeSku, stock, price } };
  }
}
