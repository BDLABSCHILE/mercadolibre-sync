import { config } from '../config.js';
import { logger } from '../logger.js';

/**
 * Auth simple para endpoints admin. Reusa SYNC_ALL_SECRET.
 * Acepta el secret por header `X-Admin-Key`, `X-Sync-All-Key`, o query `?key=`.
 */
export function adminAuth(req, res, next) {
  const secret = config.SYNC_ALL_SECRET;
  if (!secret) {
    logger.warn({ path: req.path }, 'SYNC_ALL_SECRET no configurado; endpoint admin rechazado');
    return res.status(503).json({ error: 'admin endpoints disabled: SYNC_ALL_SECRET no configurado' });
  }
  const provided =
    req.header('x-admin-key') ||
    req.header('x-sync-all-key') ||
    req.query.key ||
    '';
  if (!provided || provided !== secret) {
    return res.status(403).json({ error: 'forbidden' });
  }
  return next();
}

export default adminAuth;
