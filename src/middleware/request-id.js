import crypto from 'crypto';

export function requestId(req, res, next) {
  const incoming = req.header('x-request-id') || req.header('x-correlation-id');
  const id = incoming && incoming.length <= 64 ? incoming : crypto.randomBytes(8).toString('hex');
  req.id = id;
  res.setHeader('x-request-id', id);
  next();
}

export default requestId;
