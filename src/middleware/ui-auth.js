/**
 * Basic Auth para el dashboard UI. Usuario fijo 'admin', password =
 * SYNC_ALL_SECRET. El navegador maneja el prompt y persiste credentials por
 * sesión, así no hace falta cookies ni login form.
 */

import { config } from '../config.js';
import { logger } from '../logger.js';

const REALM = 'Valiz Sync Admin';

export function uiAuth(req, res, next) {
  const secret = config.SYNC_ALL_SECRET;
  if (!secret) {
    return res.status(503).send('SYNC_ALL_SECRET no configurado. UI deshabilitado.');
  }

  const header = req.header('authorization') || '';
  const m = header.match(/^Basic\s+(.+)$/);
  if (!m) {
    res.setHeader('WWW-Authenticate', `Basic realm="${REALM}"`);
    return res.status(401).send('Auth requerida');
  }

  let decoded;
  try {
    decoded = Buffer.from(m[1], 'base64').toString('utf8');
  } catch {
    return res.status(401).send('Auth inválida');
  }

  const idx = decoded.indexOf(':');
  if (idx < 0) {
    return res.status(401).send('Auth inválida');
  }
  const user = decoded.slice(0, idx);
  const pass = decoded.slice(idx + 1);

  if (user !== 'admin' || pass !== secret) {
    logger.warn({ user, ip: req.ip }, 'UI auth: credenciales inválidas');
    res.setHeader('WWW-Authenticate', `Basic realm="${REALM}"`);
    return res.status(401).send('Credenciales inválidas');
  }

  req.uiUser = user;
  return next();
}

export default uiAuth;
