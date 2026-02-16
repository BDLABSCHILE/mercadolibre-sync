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

  async getOrderItems(_orderId) {
    if (!this.enabled) {
      return [];
    }
    // TODO: Implementar cuando se active lógica real de órdenes
    return [];
  }

  /**
   * Actualiza stock por SKU usando ProductUpdate (Seller Center API)
   * @param {string} sku - SellerSku del producto
   * @param {number} quantity - Cantidad en stock
   * @returns {Promise<{rawXml: string, requested: {sku: string, quantity: number}}>}
   */
  async updateStockBySKU(sku, quantity) {
    if (!this.enabled) {
      this._notEnabled();
    }

    const q = Math.max(0, Math.floor(Number(quantity) || 0));
    const safeSku = String(sku).trim();
    if (!safeSku) {
      throw new Error('SKU vacío o inválido');
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Request>
  <Product>
    <SellerSku>${safeSku}</SellerSku>
    <BusinessUnits>
      <BusinessUnit>
        <OperatorCode>${this.operatorCode}</OperatorCode>
        <Stock>${q}</Stock>
      </BusinessUnit>
    </BusinessUnits>
  </Product>
</Request>`;

    console.log(`📤 ProductUpdate SKU=${safeSku} qty=${q}`);
    console.log('📤 XML enviado:', xml.trim());

    const res = await this._postWithResponse('ProductUpdate', xml);
    const status = res.status;
    const body = res.data;

    console.log('📥 Status HTTP:', status);
    console.log('📥 Body de respuesta (resumido):', this._summarizeBody(body));

    assertNoErrorResponse(body);
    console.log('✅ Falabella actualizado correctamente');

    return { rawXml: String(body || ''), requested: { sku: safeSku, quantity: q } };
  }
}
