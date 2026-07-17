import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase())));

// Render (y muchos hosts) serializan envs "vacías" como string vacío en lugar de undefined.
// Para evitar que un "" rompa z.coerce.number() (que coerciona "" a 0), normalizamos
// strings vacíos / solo espacios a undefined antes de aplicar el schema.
const emptyToUndef = (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const envStr = (s) => z.preprocess(emptyToUndef, s);
const envNum = (s) => z.preprocess(emptyToUndef, s);

const schema = z.object({
  NODE_ENV: envStr(z.enum(['development', 'production', 'test']).default('production')),
  PORT: envNum(z.coerce.number().int().positive().default(3000)),
  LOG_LEVEL: envStr(z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info')),

  DATABASE_URL: envStr(z.string().url().optional()),

  SHOPIFY_STORE_URL: envStr(z.string().min(1)),
  SHOPIFY_ACCESS_TOKEN: envStr(z.string().min(1)),
  SHOPIFY_LOCATION_ID: envStr(z.string().min(1)),
  SHOPIFY_API_SECRET: envStr(z.string().min(1).optional()),

  MELI_APP_ID: envStr(z.string().min(1)),
  MELI_CLIENT_SECRET: envStr(z.string().min(1)),
  MELI_REFRESH_TOKEN: envStr(z.string().min(1)),
  MELI_USER_ID: envStr(z.string().min(1)),
  MELI_ACCESS_TOKEN: envStr(z.string().optional()),

  ENABLE_FALABELLA: z.preprocess(emptyToUndef, booleanish.default(false)),
  FALABELLA_SC_API_HOST: envStr(z.string().url().default('https://sellercenter-api.falabella.com')),
  FALABELLA_USER_ID: envStr(z.string().optional()),
  FALABELLA_API_KEY: envStr(z.string().optional()),
  FALABELLA_API_VERSION: envStr(z.string().default('1.0')),
  FALABELLA_API_FORMAT: envStr(z.enum(['XML', 'JSON']).default('XML')),
  FALABELLA_OPERATOR_CODE: envStr(z.string().default('facl')),
  FALABELLA_HTTP_TIMEOUT_MS: envNum(z.coerce.number().int().positive().default(30000)),

  STOCK_OFFSET: envNum(z.coerce.number().int().nonnegative().default(1)),
  STOCK_OFFSET_FALABELLA: envNum(z.coerce.number().int().nonnegative().optional()),

  // IDEMPOTENCY_STORE / IDEMPOTENCY_FILE_DIR: deprecated. La idempotencia
  // migró a tablas webhook_events + marketplace_orders en Neon. Si están en
  // env del host se ignoran silenciosamente (sin schema, sin warning).
  MELI_CACHE_DIR: envStr(z.string().optional()),

  SYNC_ALL_SECRET: envStr(z.string().optional()),

  // Contraseña para el dashboard UI (basic auth). Si no se setea, se usa
  // SYNC_ALL_SECRET como fallback. Permite tener una clave corta+memorable
  // para el login humano (UI_PASSWORD) sin debilitar la clave de los endpoints
  // API (SYNC_ALL_SECRET, que debería ser larga y aleatoria).
  UI_PASSWORD: envStr(z.string().min(1).optional()),
  UI_USERNAME: envStr(z.string().min(1).default('admin')),
  SYNC_ALL_DELAY_MS: envNum(z.coerce.number().int().nonnegative().default(1200)),
  SYNC_ALL_SKU_LIST: envStr(z.string().optional()),
  SYNC_ALL_SKU_PREFIX: envStr(z.string().optional()),

  // nonnegative para permitir 0 = skip catch-up de órdenes pendientes.
  PENDING_ORDERS_LAST_HOURS: envNum(z.coerce.number().int().nonnegative().default(24)),

  PRICE_MARKUP: envNum(z.coerce.number().positive().default(1.3)),
  PRICE_ROUND_ENDING: envNum(z.coerce.number().int().nonnegative().default(990)),

  // Cron del reconciliador. 0 = OFF (solo manual via endpoint). N>0 = cada N min.
  // Sugerido: 1440 (1 vez al día) para volumen bajo, 240 (cada 4h) para volumen medio.
  RECONCILE_INTERVAL_MIN: envNum(z.coerce.number().int().nonnegative().default(0)),

  // Integración Pulpo (pulpo.valiz.cl) para avisos "back in stock". Sin la llave,
  // la waitlist igual acumula suscriptores pero NO se envían avisos (fail-safe).
  // La llave se crea en Pulpo → Configuración → Llaves API (scope acceso total).
  PULPO_URL: envStr(z.string().url().default('https://pulpo.valiz.cl')),
  PULPO_TRACK_API_KEY: envStr(z.string().min(1).optional()),
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
