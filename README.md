# Valiz Sync

Sincronización automática de **stock y precios** entre Shopify, MercadoLibre y Falabella, con dashboard web para gestión de overrides.

Shopify es la **fuente de verdad** para stock y precio base. El sistema propaga cambios a los marketplaces aplicando reglas de negocio (offset de stock, markup de precio) y permite overrides puntuales por SKU o por familia.

## Estado del proyecto

Productivo desde el 2026-05-26. Refactor completado en 7 etapas (fase 3) + 2 fases adicionales (overrides + UI). Ver `AUDIT.md` y `ARCHITECTURE.md` para historial.

---

## Stack

- **Node.js ≥18.17** + ES modules (sin TypeScript, sin transpilación).
- **Express 4** para HTTP.
- **Postgres** (Neon, us-east-1) para estado persistente.
- **pino** logger estructurado JSON.
- **zod** validación de envs y bodies.
- **HTMX + Pico CSS** para el dashboard server-rendered (sin SPA, sin build).
- **vitest** para tests.
- Hosting: **Render** (single instance).

---

## Reglas de negocio

### Stock
```
stock_marketplace = max(0, stock_shopify - 1)
```
Mismo offset para ML y Falabella. Configurable via `STOCK_OFFSET`. Override por SKU pendiente (no implementado en V1).

### Precio
```
precio_marketplace = round_up_to_990(precio_shopify * 1.3)
```
Markup `1.3` igual para ambos. Redondeo hacia arriba al próximo número terminado en `990`. Override puntuales vía dashboard.

### Reconciliación
Job (manual o cron diario) que compara stock en marketplaces vs target esperado y **auto-corrige** drift. Shopify es fuente de verdad incondicional.

---

## Cómo funciona

```
                        ┌─────────────────────┐
                        │  Dashboard /admin/ui │ ← Benja
                        └──────────┬──────────┘
                                   │
                                   ▼
┌────────────┐  webhook ┌─────────────────────┐  webhook ┌──────────────┐
│  Shopify   │ ───────► │  Render service     │ ◄─────── │ MercadoLibre │
└────────────┘          │  (webhook-server.js)│          └──────────────┘
                        │                     │  webhook ┌──────────────┐
                        │  ┌───────────────┐  │ ◄─────── │  Falabella   │
                        │  │ Neon Postgres │  │          └──────────────┘
                        │  └───────────────┘  │
                        └─────────────────────┘
```

### Flujos principales

| Evento | Disparador | Lógica |
|---|---|---|
| Cambio de stock en Shopify | webhook `inventory_levels/update` | lee stock actual, calcula `max(0, stock-1)`, propaga a ML+Falabella |
| Venta en Shopify | webhook `orders/create` | re-lee stock Shopify, propaga a marketplaces |
| Cambio de precio en Shopify | webhook `products/update` | aplica regla `× 1.3 + 990` + overrides, propaga |
| Venta en ML | webhook `orders_v2` | descuenta Shopify (con lock por SKU), redistribuye a Falabella |
| Venta en Falabella | webhook `onOrderCreated` | descuenta Shopify, redistribuye a ML |
| Reconciliación periódica | manual o cron | detecta drift, auto-corrige |

### Anti-loop

- **Idempotencia por delivery_id** (tabla `webhook_events`): el mismo webhook reentregado se ignora.
- **Idempotencia por orden e item** (`marketplace_orders` + `_items`): orden ya procesada no se re-descuenta.
- **Lock por SKU** (`sku_locks`): solo una operación a la vez por SKU.
- **Debounce por valor** (`platform_state.last_synced_*`): no llamamos API si el target ya está sincronizado.

---

## Setup local

```bash
git clone https://github.com/benjacuerosvaliz-ai/mercadolibre-sync
cd mercadolibre-sync
npm install

# Copiar y completar .env
cp env.example .env
# (editar .env con tus credenciales — ver más abajo)

# Aplicar migraciones a la DB Neon
npm run migrate

# (Solo primera vez) Cargar mapping inicial de SKUs
npm run seed

# Arrancar server
npm start          # producción
npm run dev        # con auto-reload
```

### Variables de entorno mínimas

| Variable | Descripción |
|---|---|
| `DATABASE_URL` | Connection string Postgres (Neon). |
| `SHOPIFY_STORE_URL` | `tu-tienda.myshopify.com`. |
| `SHOPIFY_ACCESS_TOKEN` | Admin API token. |
| `SHOPIFY_LOCATION_ID` | ID de location para inventory. |
| `SHOPIFY_API_SECRET` | Para verificación HMAC de webhooks. |
| `MELI_APP_ID`, `MELI_CLIENT_SECRET`, `MELI_REFRESH_TOKEN`, `MELI_USER_ID` | OAuth ML. |
| `ENABLE_FALABELLA=true`, `FALABELLA_USER_ID`, `FALABELLA_API_KEY` | Si usás Falabella. |
| `SYNC_ALL_SECRET` | Auth de endpoints API admin. Generar: `openssl rand -hex 32`. |
| `UI_PASSWORD` | Auth del dashboard. Puede ser corto+memorable. |

Ver `env.example` para la lista completa con defaults.

### Tests

```bash
npm test           # corre una vez
npm run test:watch # watch mode
```

---

## Endpoints HTTP

### Webhooks (entrantes, no auth manual)
- `POST /webhooks/shopify/orders/create` — venta en Shopify.
- `POST /webhook/inventory` — inventory_levels/update Shopify.
- `POST /webhooks/shopify/products/update` — cambio de producto Shopify (incluye precio).
- `POST /webhooks/mercadolibre/order` — `orders_v2` ML.
- `POST /webhooks/falabella/order` — `onOrderCreated` Falabella.

### Dashboard UI
- `GET /admin/ui` — tabla de SKUs con filtros, stats, modal de overrides.
- `GET /admin/ui/overrides` — lista de overrides activos.
- `GET /admin/ui/operations` — botones para barrido masivo y reconciliación.

Auth: basic-auth, user `admin` / pass `UI_PASSWORD`.

### Endpoints API admin (auth con `SYNC_ALL_SECRET` por header `X-Admin-Key` o query `?key=`)

| Endpoint | Función |
|---|---|
| `GET /admin/skus` | Lista mappings (?stats=1 para resumen). |
| `GET/POST/DELETE /admin/skus/:sku/*` | CRUD mappings. |
| `GET /admin/price-overrides` | Lista overrides (?filterKey=X, ?platform=X, ?active=0). |
| `GET /admin/price-overrides/preview?sku=X&shopifyPrice=N` | Calcula precio efectivo. |
| `POST /admin/price-overrides` | Crear override. |
| `PATCH /admin/price-overrides/:id` | Editar. |
| `DELETE /admin/price-overrides/:id` | Soft-delete. |
| `POST /admin/sync-price` | Force sync de un SKU. |
| `POST /admin/sync-all-prices` | Barrido masivo (?dry_run=1, ?skus=[...], ?prefixes=[...]). |
| `POST /admin/reconcile-stock` | Reconcilia stock (?dry_run=1). |
| `GET /sync-all` | Sync masivo de stock (legacy, usar `?key=`). |
| `GET /test-sync?sku=X` | Debug: sync individual de un SKU. |
| `GET /health` | Status del servicio. |

---

## Operaciones comunes

### Aplicar la regla de precios a todo el catálogo
```bash
curl -X POST "$URL/admin/sync-all-prices" \
  -H "X-Admin-Key: $SECRET" -H "Content-Type: application/json" \
  -d '{"dry_run":true}'
# revisar samples, si OK:
curl -X POST "$URL/admin/sync-all-prices" \
  -H "X-Admin-Key: $SECRET" -H "Content-Type: application/json" \
  -d '{"delay_ms":2500}'
```

### Reconciliar stock
```bash
curl -X POST "$URL/admin/reconcile-stock" \
  -H "X-Admin-Key: $SECRET" -d '{"dry_run":true}'
```

### Crear un override de precio
```bash
curl -X POST "$URL/admin/price-overrides" \
  -H "X-Admin-Key: $SECRET" -H "Content-Type: application/json" \
  -d '{"scope":"sku","key":"B-M-NE","platform":"mercadolibre",
       "overrideType":"discount_fixed","value":3000,"note":"descuento promo"}'
```

O desde el dashboard: `/admin/ui` → click ✏️ en el SKU → llenar form.

### Activar el cron de reconciliación
En Render Environment: `RECONCILE_INTERVAL_MIN=1440` (1 vez al día).

### Agregar un SKU nuevo
1. Crear el producto en Shopify con el SKU correcto.
2. Crear el listing en ML y anotar `item_id` + `variation_id` (si tiene).
3. Crear el listing en Falabella con `SellerSku` igual al SKU de Shopify.
4. POST a `/admin/skus`:
   ```json
   { "sku":"NUEVO-SKU", "mlItemId":"MLCxxxxx", "mlVariationId":"...",
     "falabellaSellerSku":"NUEVO-SKU" }
   ```
5. Próximo cambio de stock/precio en Shopify se propaga automáticamente.

---

## Troubleshooting

### Webhook ML llega pero no procesa la venta
- Mirar logs: ¿aparece `procesando orden ML` con `orderId`?
- Si dice `topic ML duplicado`: ML reentregó un webhook ya procesado, OK.
- Si dice `topic X no procesado`: ML mandó un evento que no es `orders_v2`, OK ignorarlo.
- Si dice `SKU no encontrado en mapping`: el `ml_variation_id` no está en `sku_mapping`. Agregarlo via `/admin/skus`.
- Si dice `ambiguous_item_no_variation`: el item ML tiene varias variantes pero ML mandó sin `variation_id`. Falla de ML; revisar la orden manualmente.

### Falabella da 429 (rate limit)
- El código reintenta 2 veces (8s + 20s). Si fallan ambos, el SKU queda en `failed`.
- Para barridos masivos, aumentar `delay_ms` a 2500 o 5000.
- En operación normal (webhooks aislados), no debería pasar.

### ML rechaza con `item.variations.price.different`
- Causa: intentaste actualizar UNA variante con un precio distinto al resto. ML no lo permite.
- Solución: el código actual usa `updateItemVariationsPrices` (batch). Si igual aparece, el override de SKU para un item multi-variation va a quedar al max común. Usar override de familia.

### El reconciliador "corrigió" un precio que yo cambié manualmente
- Si editaste precio directo en ML/Falabella Seller, el sync lo sobreescribe (Shopify es fuente de verdad).
- Para que un precio quede permanente: crear override desde el dashboard.

### Render dice "Deploy failed"
- Mirar logs del deploy. Causas comunes:
  - Falta env var requerida (zod falla validación al arranque).
  - Error de imports tras un cambio.
- Soluciones:
  - Verificar `.env.example` vs Render Environment.
  - Rollback al commit previo si el bug es grave (Render Manual Deploy → seleccionar commit).

---

## Arquitectura de DB

| Tabla | Función |
|---|---|
| `sku_mapping` | SKU ↔ shopify_variant_id / ml_item_id / ml_variation_id / falabella_seller_sku |
| `platform_state` | Último valor sincronizado por (sku, platform) — para debounce |
| `webhook_events` | Audit log de webhooks entrantes — idempotencia por delivery_id |
| `marketplace_orders` + `_items` | Estado de procesamiento por orden externa |
| `stock_events` | Log append-only de cambios de stock (auditoría) |
| `sku_locks` | Locks distribuidos por SKU (anti-race) |
| `price_overrides` | Excepciones a la regla general por SKU o familia |
| `_migrations` | Control de migraciones aplicadas |

---

## Repositorio

- `webhook-server.js` — entrypoint, monta routers, atiende webhooks.
- `shopify-api.js`, `mercadolibre-api.js`, `falabella-api.js` — clientes HTTP de cada plataforma.
- `src/config.js` — schema zod de envs.
- `src/logger.js` — pino estructurado.
- `src/db/` — conexión Postgres, migraciones SQL, repositorios.
- `src/services/` — lógica de negocio (price, price-override, price-sync, sku-cache, reconciler).
- `src/middleware/` — HMAC, basic-auth, request-id.
- `src/routes/` — routers admin (skus, price-overrides, dashboard UI).
- `src/ui/` — layout + vistas HTML.

Tests en `src/services/__tests__/`.

---

## Deploy

Render auto-deploya en cada push a `main`. Para forzar deploy: Render dashboard → tu servicio → **Manual Deploy → Deploy latest commit**.

Migraciones de DB se aplican manualmente con `npm run migrate` desde local (apuntando a la `DATABASE_URL` de prod).

---

## Sobre los archivos legacy presentes

- `meli-sku-mapping.js` — tabla hardcoded inicial, usada solo por el script de seed y por `mercadolibre-api.getOrders` (reporting).
- `index.js` — CLI de sync masivo, mantenido por compat.
- `check-pending-orders.js` — catch-up de órdenes ML al arrancar. Controlado por `PENDING_ORDERS_LAST_HOURS`.

No se usan en el hot path del runtime (handlers de webhook).

---

## Licencia

MIT
