import pino from 'pino';
import { config } from './config.js';

const isDev = config.NODE_ENV !== 'production';

export const logger = pino({
  level: config.LOG_LEVEL,
  base: { service: 'mercadolibre-sync' },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers["x-shopify-access-token"]',
      'req.headers["x-shopify-hmac-sha256"]',
      '*.access_token',
      '*.refresh_token',
      '*.client_secret',
      '*.api_key',
      '*.apiKey',
    ],
    censor: '[REDACTED]',
  },
  ...(isDev
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss.l',
            ignore: 'pid,hostname,service',
          },
        },
      }
    : {}),
});

export default logger;
