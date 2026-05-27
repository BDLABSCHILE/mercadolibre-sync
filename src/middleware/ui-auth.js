/**
 * Basic Auth para el dashboard UI.
 *
 * Credenciales:
 *   - Usuario: config.UI_USERNAME (default 'admin')
 *   - Password: config.UI_PASSWORD si está seteada; si no, fallback a
 *     config.SYNC_ALL_SECRET (compat con setup anterior).
 *
 * Tener UI_PASSWORD separada permite usar clave humana corta para el dashboard
 * sin debilitar la clave de los endpoints API (que sigue siendo SYNC_ALL_SECRET
 * larga y aleatoria).
 *
 * El navegador maneja el prompt y persiste credentials por sesión.
 */

import { config } from '../config.js';
import { logger } from '../logger.js';

const REALM = 'Valiz Sync Admin';

export function uiAuth(req, res, next) {
  const expectedUser = config.UI_USERNAME;
  const expectedPass = config.UI_PASSWORD || config.SYNC_ALL_SECRET;

  if (!expectedPass) {
    return res.status(503).send('UI_PASSWORD ni SYNC_ALL_SECRET configurados. UI deshabilitado.');
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

  if (user !== expectedUser || pass !== expectedPass) {
    logger.warn({ user, ip: req.ip }, 'UI auth: credenciales inválidas');
    res.setHeader('WWW-Authenticate', `Basic realm="${REALM}"`);
    return res.status(401).send('Credenciales inválidas');
  }

  req.uiUser = user;
  return next();
}

export default uiAuth;
