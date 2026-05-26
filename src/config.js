import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase())));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().url().optional(),

  SHOPIFY_STORE_URL: z.string().min(1),
  SHOPIFY_ACCESS_TOKEN: z.string().min(1),
  SHOPIFY_LOCATION_ID: z.string().min(1),
  SHOPIFY_API_SECRET: z.string().min(1).optional(),

  MELI_APP_ID: z.string().min(1),
  MELI_CLIENT_SECRET: z.string().min(1),
  MELI_REFRESH_TOKEN: z.string().min(1),
  MELI_USER_ID: z.string().min(1),
  MELI_ACCESS_TOKEN: z.string().optional(),

  ENABLE_FALABELLA: booleanish.default(false),
  FALABELLA_SC_API_HOST: z.string().url().default('https://sellercenter-api.falabella.com'),
  FALABELLA_USER_ID: z.string().optional(),
  FALABELLA_API_KEY: z.string().optional(),
  FALABELLA_API_VERSION: z.string().default('1.0'),
  FALABELLA_API_FORMAT: z.enum(['XML', 'JSON']).default('XML'),
  FALABELLA_OPERATOR_CODE: z.string().default('facl'),
  FALABELLA_HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),

  STOCK_OFFSET: z.coerce.number().int().nonnegative().default(1),
  STOCK_OFFSET_FALABELLA: z.coerce.number().int().nonnegative().optional(),

  IDEMPOTENCY_STORE: z.enum(['memory', 'file']).default('memory'),
  IDEMPOTENCY_FILE_DIR: z.string().optional(),
  MELI_CACHE_DIR: z.string().optional(),

  SYNC_ALL_SECRET: z.string().optional(),
  SYNC_ALL_DELAY_MS: z.coerce.number().int().nonnegative().default(1200),
  SYNC_ALL_SKU_LIST: z.string().optional(),
  SYNC_ALL_SKU_PREFIX: z.string().optional(),

  PENDING_ORDERS_LAST_HOURS: z.coerce.number().int().positive().default(24),

  PRICE_MARKUP: z.coerce.number().positive().default(1.3),
  PRICE_ROUND_ENDING: z.coerce.number().int().nonnegative().default(990),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
  console.error('❌ Configuración inválida. Revisa tu .env:\n' + issues);
  process.exit(1);
}

const cfg = parsed.data;

if (cfg.ENABLE_FALABELLA && (!cfg.FALABELLA_USER_ID || !cfg.FALABELLA_API_KEY)) {
  console.error('❌ ENABLE_FALABELLA=true requiere FALABELLA_USER_ID y FALABELLA_API_KEY.');
  process.exit(1);
}

if (cfg.STOCK_OFFSET_FALABELLA == null) {
  cfg.STOCK_OFFSET_FALABELLA = cfg.STOCK_OFFSET;
}

export const config = Object.freeze(cfg);
export default config;
