import crypto from 'crypto';
import { config } from '../config.js';
import { logger } from '../logger.js';

const HEADER = 'x-shopify-hmac-sha256';

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export function verifyShopifyHmac(req, res, next) {
  const secret = config.SHOPIFY_API_SECRET;

  if (!secret) {
    logger.warn(
      { path: req.path },
      'SHOPIFY_API_SECRET no configurado; webhook aceptado SIN verificación (modo dev). Configura el secret para producción.',
    );
    return next();
  }

  const provided = req.header(HEADER);
  if (!provided) {
    logger.warn({ path: req.path }, 'webhook Shopify sin header HMAC');
    return res.status(401).json({ error: 'missing hmac header' });
  }

  if (!Buffer.isBuffer(req.body)) {
    logger.error({ path: req.path }, 'verifyShopifyHmac requiere body raw (Buffer)');
    return res.status(500).json({ error: 'misconfigured raw parser' });
  }

  const computed = crypto.createHmac('sha256', secret).update(req.body).digest('base64');

  if (!timingSafeEqual(computed, provided)) {
    logger.warn({ path: req.path }, 'HMAC inválido en webhook Shopify');
    return res.status(401).json({ error: 'invalid hmac' });
  }

  req.shopifyHmacVerified = true;
  return next();
}

export default verifyShopifyHmac;
