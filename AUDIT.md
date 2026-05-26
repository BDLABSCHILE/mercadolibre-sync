# AUDIT.md — Auditoría API Sync Shopify ↔ MercadoLibre ↔ Falabella

> Fecha: 2026-05-26
> Alcance: rama `main`, working directory `mercadolibre-sync/`.
> Modo: **lectura únicamente**. No se modificó código.

---

## 1.1 Stack y arquitectura actual

### Lenguaje / runtime
- **Node.js** con **ES Modules** (`"type": "module"` en `package.json`).
- Sin TypeScript. Sin transpilación. Sin linter. Sin formatter.
- Versión mínima recomendada: Node 18+ (uso de `--watch`, AbortController implícito en axios). El `package.json` **no fija `engines.node`** → riesgo de drift de runtime en el host.

### Framework HTTP
- **Express 4.18** como única capa HTTP.
- Body parsing mixto: `express.raw()` para webhooks Shopify (correcto para HMAC) y `express.json()` para el resto. Está bien resuelto pero a mano.

### Dependencias (package.json:22-27)
| Paquete | Versión | Crítica | Comentario |
|---|---|---|---|
| `axios` | ^1.6.0 | Sí | Cliente HTTP para Shopify / ML / Falabella. |
| `dotenv` | ^16.3.1 | Sí | Carga `.env`. |
| `express` | ^4.18.2 | Sí | Express 5 ya es estable; no es urgente migrar. |
| `fast-xml-parser` | ^4.3.2 | Sí (Falabella) | Solo usado en `falabella-api.js`. |
| `crypto` | built-in | Sí | HMAC-SHA256 para Falabella. |

**No hay**: librería de validación (zod / joi), logger estructurado (pino / winston), cola (bullmq / sqs), test runner (vitest / jest), TypeScript, ORM, cliente de DB.

### Estructura del proyecto
```
mercadolibre-sync/
├── webhook-server.js        # 1096 líneas — TODO el servidor HTTP, lógica de orquestación, rutas, anti-loop, sync-all
├── shopify-api.js           # 550 líneas — cliente Shopify (REST + GraphQL). Mezcla stock + reporting de órdenes.
├── mercadolibre-api.js      # 1263 líneas — cliente ML + lógica de reporting (publicidad, billing, comisiones) heredada de otro proyecto
├── falabella-api.js         # 343 líneas — cliente Seller Center API (XML + HMAC firmado)
├── meli-sku-mapping.js      # 154 líneas — TABLA HARDCODED de mapeo item_id/variation_id → SKU
├── idempotency-store.js     # 69 líneas — store memory|file
├── index.js                 # CLI: sincronización masiva (Shopify → ML solamente)
├── check-pending-orders.js  # Job de catch-up: corre 1 sola vez al arrancar webhook-server
├── debug-*.js, get-variations.js, update-*.js  # Scripts sueltos (no se ejecutan en runtime)
└── *.md (~14 archivos)      # Guías históricas; varios desactualizados
```

**Hallazgo:** `webhook-server.js` es un **god-file** (1096 LOC, ~10 responsabilidades). No hay separación entre transporte HTTP, validación, lógica de negocio, persistencia y clientes externos.

### Hosting
Tres configs de deploy presentes simultáneamente — **no es claro cuál es producción**:
- `Procfile`: `web: node webhook-server.js` (Heroku/Render).
- `railway.json`: `node webhook-server.js`, restart `ON_FAILURE` máx 10. Builder NIXPACKS.
- `fly.toml`: app `mercadolibre-sync`, región `scl`, 1 VM 256 MB, `min_machines_running = 1`.
- `DEPLOY.md` y `PASOS-DEPLOY-RENDER.md` apuntan a **Render** como producción.
- `GUIA_HOSTING_GRATUITO.md` menciona varias opciones.

**Inferencia razonable:** producción corre en **Render** (free / starter), single-instance. Otras configs son artefactos de pruebas anteriores.

> **Pregunta para Benja:** ¿Qué hosting es el actual (Render? Fly? Railway?), y en qué plan? Lo necesito confirmar antes de la Fase 2 porque afecta dos cosas críticas: persistencia de archivo y si hay multi-instancia.

---

## 1.2 Flujos de sincronización actuales

### Webhooks recibidos

| Origen | Endpoint | Topic / Evento | Lo que hace hoy |
|---|---|---|---|
| Shopify | `POST /webhooks/shopify/orders/create` | `orders/create` | Lee `line_items[].sku`, consulta stock actual en Shopify, propaga a ML + Falabella con offset. |
| Shopify | `POST /webhook/inventory` | `inventory_levels/update` (también acepta `connect`/`disconnect`) | Resuelve SKU desde `inventory_item_id`, consulta stock, propaga a ML + Falabella. |
| MercadoLibre | `POST /webhooks/mercadolibre/order` | `orders_v2` | Resuelve SKU desde `meli-sku-mapping.js`, descuenta en Shopify vía `inventory_levels/adjust`, redistribuye a Falabella. |
| Falabella | `POST /webhooks/falabella/order` | `onOrderCreated` (custom payload Seller Center) | Extrae `OrderId`, llama `GetOrderItems`, descuenta en Shopify, redistribuye **solo a ML** (no a Falabella → evita loop). |

### Endpoints adicionales

| Método | Path | Auth | Función |
|---|---|---|---|
| GET | `/health` | — | Devuelve estado del worker + flag de sync. |
| GET | `/test-sync?sku=…` | **Ninguna** | Sincroniza manualmente un SKU. |
| POST | `/__test__/mercadolibre/order` | **Ninguna** | Procesa una orden mock (dry-run por defecto). |
| GET/POST | `/sync-all?key=…` | `SYNC_ALL_SECRET` por query/header | Sync masivo Shopify → ML + Falabella. Background, 1200ms entre SKUs. |

### Llamadas externas (resumen)

**Shopify** (`shopify-api.js`)
- `GET /admin/api/2024-01/products.json` (paginado) → usado en **casi todas** las búsquedas de SKU (N+1: cada webhook escanea TODO el catálogo).
- `GET /admin/api/2024-01/inventory_items/{id}.json`
- `GET /admin/api/2024-01/inventory_items/{id}/locations.json`
- `GET /admin/api/2024-01/inventory_levels.json`
- `POST /admin/api/2024-01/inventory_levels/adjust.json` (descuento de stock por orden externa)
- `POST /admin/api/2024-01/graphql.json` (reporting de órdenes — heredado de sales-dashboard, **no se usa en sync**)

**MercadoLibre** (`mercadolibre-api.js`)
- `POST /oauth/token` (refresh)
- `GET /users/{user_id}/items/search?status=active&limit=50` (⚠ límite 50 hardcoded)
- `GET /items/{itemId}`, `PUT /items/{itemId}`, `PUT /items/{itemId}/variations/{variationId}`
- `GET /orders/{orderId}`, `GET /orders/search`
- `GET /advertising/...`, `GET /billing/...` (**reporting, no sync** — código legacy de sales-dashboard, ~400 LOC en este archivo)
- `GET https://api.mercadopago.com/v1/payments/{id}` (también legacy reporting)

**Falabella** (`falabella-api.js`)
- HMAC-SHA256 query string firmado para cada request.
- `GetOrders`, `GetOrderItems`, `ProductUpdate` (XML body).

### Autenticación

| Plataforma | Mecanismo | Refresh | Riesgo |
|---|---|---|---|
| Shopify | Custom App + `X-Shopify-Access-Token` (long-lived) | No expira (revocable manualmente) | Bajo. |
| MercadoLibre | OAuth `refresh_token` → `access_token` (6h). Interceptor de axios renueva automáticamente en 401. | Sí, automático. Refresh token rota (línea 308 actualiza el campo en memoria) pero **no se persiste** → si el servicio reinicia antes de leer el viejo refresh, podría dejar de funcionar si ML invalidó el anterior. | **Medio**. ML invalida el refresh viejo al usar el nuevo. Si el nuevo refresh no llega al `.env` del host, en el próximo reinicio el viejo no sirve → caída. |
| Falabella | `UserID` + `ApiKey` (HMAC firmado por request) | API key estática | Bajo. |

### Jobs / cron / polling

- **Solo uno**: `check-pending-orders.js` se ejecuta una vez al arrancar el servidor (línea 1088 de `webhook-server.js`, import dinámico). Busca órdenes ML de las últimas 24h (configurable con `PENDING_ORDERS_LAST_HOURS`).
- **No hay**: cron externo, GitHub Action, ni job recurrente. Si el servicio queda arriba 5 días seguidos, **no hay catch-up entre arranques**.
- README sugiere cron crontab/Task Scheduler/GitHub Actions, pero **nada de eso está configurado**.

---

## 1.3 Prevención de loops (la sección crítica)

### Lo que existe hoy

1. **Flag en memoria por marketplace** (`webhook-server.js:54-58`):
   ```js
   const isSyncingFromMarketplace = { mercadolibre: false, falabella: false };
   ```
   Se setea `true` antes de descontar stock en Shopify (lines 674, 753) y vuelve a `false` en `finally`/`catch`. Cuando algún flag está en `true`, los webhooks Shopify (`orders/create` e `inventory`) **se ignoran** (lines 197, 266).

2. **Skip explícito a Falabella tras venta Falabella** (`webhook-server.js:546`):
   Al redistribuir stock después de procesar una orden Falabella, se pasa `skipFalabella: true` a `syncSkuToMarketplacesFromShopify`. Falabella solo se actualiza desde Shopify o desde ventas ML.

3. **Idempotencia por `order_id` y por `order_id:item_id:variation_id`** (`idempotency-store.js`).
   - Driver `memory` (default) o `file` (`IDEMPOTENCY_STORE=file`).
   - File driver escribe a `idempotency-mercadolibre.json` / `idempotency-falabella.json` en `process.cwd()`.

4. **E009 cache** (`webhook-server.js:50`): SKUs que Falabella rechazó con E009 se cachean en memoria para no reintentar hasta reinicio.

### Lo que NO existe

- ❌ **Distinción venta-real vs eco-de-mi-update**. No hay `source` flag ni timestamp dampening. El sistema confía 100% en el flag in-memory y en idempotencia por order_id.
- ❌ **Firma HMAC validada en ningún webhook**. El comentario "el body raw es necesario para HMAC" está pero **nunca se llega a verificar la firma**. Cualquiera puede enviar payloads falsos.
- ❌ **Lock distribuido**. El flag `isSyncingFromMarketplace` vive en el proceso → ya está roto si hay dos instancias o si se reinicia mid-sync.
- ❌ **Idempotency key proveniente del webhook**. El order_id se usa como key pero no se valida una `X-Shopify-Webhook-Id` u otro nonce único por entrega.

### Escenarios de loop / riesgo concreto

**Escenario A — Loop benigno por inventory webhook tras venta Shopify**

1. Cliente compra en Shopify → Shopify dispara `orders/create` Y `inventory_levels/update` (casi simultáneos).
2. `orders/create` se procesa: lee stock Shopify, lo propaga a ML/Falabella con offset.
3. `inventory_levels/update` llega: como **no hay flag** seteado (la venta vino de Shopify, no de marketplace), procesa también: lee stock Shopify, propaga.
4. Cada `meli.updateStock`/`falabella.updateStockBySKU` resulta en doble llamada a la API de ML/Falabella por el mismo evento.
- **Impacto:** no es un loop infinito (los marketplaces no responden con webhook a un cambio de stock), pero **duplica llamadas** y consume rate limit. Si Shopify reintenta el webhook (ej. 5xx temporal), se triplican.

**Escenario B — Loop potencial si Shopify devuelve eco de stock**

1. Venta ML → procesa, descuenta Shopify (flag `mercadolibre = true`).
2. Shopify, al descontar, dispara `inventory_levels/update`. Llega al endpoint mientras el flag sigue `true`. **Se ignora correctamente.** ✅
3. PERO: si la red de Shopify retrasa el webhook → el flag ya está en `false` cuando llega → se procesa → re-lee stock (que ya bajó) → re-empuja a ML (idempotente desde el lado de ML, porque el `available_quantity` ya es el correcto). **Mitigado**, pero genera una llamada redundante a la API de ML por venta.

**Escenario C — Loop real si hay 2 instancias o reinicio**

1. Render hace cold start o redeploy mientras se procesa una orden ML.
2. Flag in-memory se pierde.
3. Inventory webhook llega → se procesa **sin la protección del flag**.
4. Si `IDEMPOTENCY_STORE=memory` (default), también se pierde el set de órdenes procesadas.
5. **Doble descuento de stock en Shopify si la orden ML llega de nuevo (ML reintenta hasta 5 veces ante 5xx).**
- **Impacto:** **inventario incorrecto en Shopify** + amplificación a ML y Falabella.

**Escenario D — Loop multi-marketplace concurrente**

1. Llega webhook ML para SKU `X` y webhook Falabella para SKU `X` casi simultáneos.
2. Ambos setean su flag respectivo. Ambos descuentan Shopify.
3. Es **race condition** sobre el stock de Shopify: el segundo lee el stock ya descontado por el primero y aplica `inventory_levels/adjust` con `-quantity`. Como `adjust` es relativo, **suma bien** (las dos restas se acumulan).
4. PERO: al redistribuir, ambos llaman `getStockBySKU` → uno puede leer un valor intermedio. La propagación a marketplaces no será perfectamente consistente.

### Conclusión sección 1.3

El sistema **funciona en condiciones ideales** (1 instancia, sin reinicios, webhooks ordenados). Pero la combinación de:
- flag in-memory,
- idempotencia opcional en disco (efímero en Render free),
- falta de HMAC,
- y catch-up que solo corre al arrancar,

deja al menos **tres vectores reales de pérdida o duplicación de stock**.

---

## 1.4 Manejo de stock y precios

### Stock

- **Regla `stock_ml = stock_shopify - 1`**: ✅ implementada.
  - `STOCK_OFFSET=1` (default) — `webhook-server.js:46, 74-79`.
  - `STOCK_OFFSET_FALABELLA` permite offset distinto por marketplace (default = STOCK_OFFSET).
  - `Math.max(0, ...)` evita negativos.
- **Shopify como fuente de verdad**: ✅ implementado en espíritu. Ventas en ML/Falabella → descuento en Shopify → redistribución desde Shopify.
- **Edge case**: `updateStockBySKU` en Shopify usa `inventory_levels/adjust` (relativo). Si Shopify ya descontó el ítem por otra vía (ej. un fulfillment), descontamos dos veces. **No hay reconciliación**.

### Precios

- ❌ **NO IMPLEMENTADO.** Cero código de sync de precios.
- `price: variation.price` en `mercadolibre-api.js:238` es un **PUT no-op** (re-envía el mismo precio) usado solo para forzar a ML a devolver `seller_custom_field`. **No es lógica de negocio de precios.**
- No hay regla `precio_ml = precio_shopify * 1.3` en ningún lado.
- No hay webhook `products/update` de Shopify configurado en el código.

### Mapeo de productos entre plataformas

- **Shopify ↔ ML**: tabla **hardcoded** en `meli-sku-mapping.js`:
  - `MELI_SKU_MAPPING`: 96 entries `sku → { item_id, variation_id }`.
  - `MELI_VARIATION_SKU_MAP`: 13 entries adicionales para `MLC3539517694`.
  - Construye dos mapas en memoria: `meliVariationIdToSku` y `meliItemIdToSkus`.
- **Shopify ↔ Falabella**: vía `SellerSku` (asume que SKU en Shopify == SellerSku en Falabella). **Sin tabla**, solo comparación directa.
- **Riesgo:** agregar un producto nuevo → **requiere editar `meli-sku-mapping.js` y redeploy**. No es operable por personal no-técnico.
- `findItemBySKU` en `mercadolibre-api.js:888` también escanea ML on-the-fly (con `limit=50`, no paginado) buscando por `seller_custom_field` / `attribute_combinations`. Más resiliente pero **lento** y limitado a los primeros 50 items activos.

---

## 1.5 Persistencia

### Estado actual: **sin base de datos**.

| Archivo | Qué guarda | Tamaño | Riesgo |
|---|---|---|---|
| `.meli-refreshed-items.json` | itemIds de ML que ya hicieron PUT de "refresh" (one-time) | crece lento | Bajo. Si se pierde, se vuelve a hacer el PUT (idempotente). |
| `idempotency-mercadolibre.json` | order_keys e item_keys procesados | **crece sin tope** | **Alto.** Sin TTL → infla disco para siempre. Si se pierde en Render → re-procesa órdenes → **doble descuento**. |
| `idempotency-falabella.json` | igual que arriba | igual | igual |

### Otros estados en memoria (perdidos en reinicio)
- `isSyncingFromMarketplace` (anti-loop).
- `falabellaAccessDeniedSkus` (SKUs Falabella con E009).
- `_logOrderNextMeliWebhook` (flag de debug).
- `paymentCache`, `shipmentCache` (reporting, no afecta sync).

### Disco
- En Render free el filesystem es **efímero**: se pierde en cada deploy y en cada cold start.
- En Fly.io con `min_machines_running=1` se mantiene **mientras la VM viva**, pero no entre deploys ni si se mueve de host.
- **Riesgo crítico**: si `IDEMPOTENCY_STORE=file` está activo en un host efímero, da **falsa sensación** de protección. Si está en `memory` (default), explícitamente no protege entre reinicios.

---

## 1.6 Manejo de errores

### Reintentos
- **Shopify 429**: 2 reintentos con backoff 8s / 20s (`shopify-api.js:30-43`).
- **ML 429**: idem (`mercadolibre-api.js:111-119`).
- **ML 401**: refresh automático del access_token + retry una vez (`mercadolibre-api.js:88-110`).
- **Falabella 429**: idem (`falabella-api.js:102-115`).
- **Sin reintentos** para 5xx, timeouts, ECONNRESET, ETIMEDOUT.
- **Sin cola** de reintentos asincrónicos. Si un webhook falla y el origen no reintenta, se pierde.

### Comportamiento ante caída de plataforma externa
| Falla | Comportamiento actual |
|---|---|
| Shopify cae | `getStockBySKU` o `updateStockBySKU` retornan `null`/`false`. Webhook responde 500/200. ML reintenta orders_v2 (hasta 5 veces). Shopify reintenta inventory webhook. **Eventualmente recupera**, pero sin garantía de orden. |
| ML cae | Sync Shopify → ML falla; orden Shopify se responde 200 igual (no reintenta). Stock queda desfasado en ML hasta el próximo cambio. **No hay catch-up de stock**. |
| Falabella cae | Igual que ML pero peor: las E009 quedan cacheadas en memoria y un SKU "falla una vez" se ignora hasta reinicio. |

### Dead letter queue
- ❌ No existe.

### Logs
- `console.log` con emojis en todo el código. Sin niveles (info/warn/error/debug). Algunos `DEBUG_*` env flags activan extra-verbosidad.
- Visibles **solo en el dashboard de Render** (o stdout del host).
- Sin agregación, sin búsqueda estructurada, sin alertas.

---

## 1.7 Seguridad

| Item | Estado | Severidad |
|---|---|---|
| Validación HMAC webhooks Shopify | ❌ **No existe** (el body raw está preservado pero la firma NUNCA se verifica) | **CRÍTICO** |
| Validación firma webhooks ML | ❌ No existe (ML no tiene firma estándar pero se puede validar `user_id`) | Alto |
| Validación origen webhook Falabella | ❌ No existe | Alto |
| Endpoint `/test-sync` sin auth | ⚠ Cualquiera puede gatillar sync por SKU | Medio |
| Endpoint `/__test__/mercadolibre/order` sin auth | ⚠ Cualquiera puede inyectar orden mock | Medio (dry-run por default, pero `?dry_run=0` ejecuta real) |
| `/sync-all` protegido | ✅ Con `SYNC_ALL_SECRET` por query/header | OK |
| Secrets en `.env` | ✅ Local. En host se cargan como env vars del dashboard. | OK |
| `.env` en `.gitignore` | ✅ | OK |
| Secrets en git history | ✅ El initial commit dice "no secrets". No verifiqué historia completa pero no hay tokens en código actual. | OK |
| Logs no filtrarían tokens | ⚠ El interceptor de axios podría loggear headers; en logs actuales no se imprimen tokens, pero no hay sanitización explícita. | Bajo |
| HTTPS | ✅ Forzado por host (Render/Fly) | OK |
| Rate limit propio (anti-abuse) | ❌ Sin throttling en endpoints expuestos | Medio |

### Detalle HMAC Shopify
Shopify firma cada webhook con `X-Shopify-Hmac-Sha256` usando el `SHOPIFY_API_SECRET` (no el access_token). El código:
1. Guarda body raw → ✅ requisito previo.
2. **No lee el header `X-Shopify-Hmac-Sha256`**.
3. **No computa HMAC-SHA256 + base64**.
4. **No compara timing-safe**.
→ **Cualquier atacante con la URL puede enviar payloads forjados** que descuenten/aumenten stock en ML y Falabella sin restricción.

---

## 1.8 Tests

- ❌ **No hay tests automatizados.** Ni unit, ni integración, ni e2e.
- ❌ No hay runner configurado en `package.json`.
- Hay un endpoint `/__test__/mercadolibre/order` para hacer pruebas manuales con `curl`. Útil pero no reemplaza una suite.
- Hay scripts sueltos (`debug-order.js`, `get-variations.js`) que se ejecutan a mano para inspeccionar APIs.

---

## 1.9 Problemas y riesgos detectados (priorizados)

### 🔴 CRÍTICOS

| # | Problema | Impacto si no se arregla |
|---|---|---|
| C1 | **Sin verificación HMAC en webhooks Shopify**. | Cualquiera puede forjar webhooks → descontar stock en ML/Falabella a voluntad → caos comercial y posible DoS de inventario. |
| C2 | **Anti-loop basado en flag in-memory + idempotencia en disco efímero**. | En cualquier reinicio / cold start / multi-instancia → **doble descuento de stock**, inventario inconsistente. |
| C3 | **No hay sync de precios**. | El requisito de negocio `precio_ml = precio_shopify * 1.3` simplemente no existe. |
| C4 | **`meli-sku-mapping.js` es hardcoded**. | Cada producto nuevo requiere edición de código + redeploy. No escalable. |
| C5 | **`SKU` en Shopify no está garantizado único ni presente**. `updateStockBySKU` rompe si dos variantes tienen el mismo SKU o si el SKU está vacío. | Descuentos erróneos / fallas silenciosas. |

### 🟠 ALTOS

| # | Problema | Impacto |
|---|---|---|
| A1 | `getStockBySKU` y `updateStockBySKU` **descargan TODO el catálogo Shopify por cada llamada** (N+1 catastrófico). | Latencia alta, rate limit Shopify, costo creciente. Cada webhook puede tardar 10-30s en catálogos medianos. |
| A2 | `findItemBySKU` en ML usa `limit=50` **sin paginación**. | Cuando haya >50 items activos, ciertos SKUs dejarán de encontrarse. |
| A3 | `inventory_levels/adjust` es **relativo**, no absoluto. Race condition entre ventas simultáneas + actualizaciones manuales. | Stock derivado vs real divergente sin alerta. |
| A4 | `check-pending-orders` corre **solo al arrancar el servidor**. Si el servicio queda arriba días seguidos, no hay catch-up. | Órdenes perdidas si un webhook falla y ML no reintentó. |
| A5 | **Múltiples configs de deploy** (Procfile + railway.json + fly.toml) sin claridad de cuál es prod. | Riesgo de deploy a host equivocado / config drift. |
| A6 | **Sin timeouts globales en clientes axios**. (Falabella sí tiene; Shopify y ML no). | Una llamada colgada bloquea el event loop. |
| A7 | Webhooks Shopify devuelven siempre **200** aun si falló la sync a marketplaces → Shopify no reintenta → sync se pierde. | Pérdida silenciosa de actualizaciones. |
| A8 | El **refresh_token de ML rota** (línea 309 de `mercadolibre-api.js`) pero solo se actualiza **en memoria**. El `.env`/dashboard no lo recibe. | Cuando ML invalida el viejo refresh, próximo reinicio = falla auth ML. |
| A9 | Idempotencia escribe **JSON completo a disco** en cada `mark()` (sync write). | A medida que crece el set, cada webhook se vuelve más lento. Disco crece sin TTL. |
| A10 | Endpoints `/test-sync` y `/__test__/*` **sin auth**, accesibles públicamente. | Abuso / disparo de cargas pesadas / inyección de órdenes mock con `dry_run=0`. |

### 🟡 MEDIOS

| # | Problema | Impacto |
|---|---|---|
| M1 | `webhook-server.js` es god-file (1096 LOC). | Cambios son frágiles; difícil de testear. |
| M2 | `mercadolibre-api.js` tiene ~400 LOC de **reporting / publicidad / billing** (legacy de sales-dashboard), no usados en sync. | Bloat, confusión, mantenimiento extra. |
| M3 | `shopify-api.js` también arrastra `getOrdersGraphQL` con lógica de refunds compleja. | Bloat. |
| M4 | Logging por `console.log` sin niveles ni formato estructurado. | No agregable, no buscable, no alertable. |
| M5 | Cero validación de payloads entrantes (no schema, no tipos). | Cambios en API externas → fallas silenciosas. |
| M6 | Dos archivos `.env.example` y `env.example` con contenidos distintos. | Confusión, configs faltantes al setup. |
| M7 | `STOCK_OFFSET` global; no permite offset por SKU o por marketplace-y-SKU. | Algunos productos (alta rotación) necesitan más buffer. |
| M8 | `falabellaAccessDeniedSkus` en memoria sin TTL. Un blip de permisos marca el SKU como "no tocar" hasta reinicio. | SKUs legítimos quedan sin sync por error transitorio. |
| M9 | Sin métricas (latencia, errores, throughput). Solo logs. | Imposible monitorear salud. |
| M10 | Sin `engines.node` en `package.json`. | Drift de runtime entre dev y prod. |

### 🟢 BAJOS

| # | Problema |
|---|---|
| B1 | ~14 archivos `.md` con guías históricas; varios desactualizados. |
| B2 | Scripts sueltos sin organizar (`debug-*.js`, `update-*.js`, `get-variations.js`). |
| B3 | `variations-output.json` (~37 KB) commiteado al repo. Es un dump puntual. |
| B4 | `.meli-refreshed-items.json` commiteado al repo (es estado de runtime, debería ir en `.gitignore` — sí está). |
| B5 | No hay README de troubleshooting con los errores observados en producción. |
| B6 | `debug-item.js` está vacío. |

---

## Resumen ejecutivo

El sistema **resuelve el caso feliz** (1 instancia, 1 venta a la vez, sin reinicios, productos en la tabla hardcoded). Hace lo básico:
- Recibe webhooks de 3 plataformas.
- Descuenta stock cuando hay venta externa.
- Redistribuye stock cuando cambia Shopify.
- Tiene flag anti-loop y refresh automático de tokens ML.

Pero **no está listo para producción confiable** por:
1. **Sin verificación HMAC** → riesgo de seguridad explotable.
2. **Anti-loop frágil** (memoria + disco efímero) → en cualquier reinicio se pierde protección.
3. **Sin sync de precios** → 50% del requisito de negocio.
4. **N+1 brutal** en cada webhook (descarga todo el catálogo Shopify).
5. **Mapeo SKU hardcoded** → no escala.
6. **Sin tests, sin métricas, sin DLQ, sin cron de reconciliación**.

La buena noticia: la lógica de negocio (offsets, idempotencia por orden, flag anti-loop, redistribución con `skipFalabella`) **está pensada correctamente** y se puede preservar tal cual al refactorizar. Lo que falta es la **infraestructura debajo** (persistencia, cola, validación, observabilidad).

> **Próximo paso:** revisar este informe + `ARCHITECTURE.md`. Una vez aprobado, propongo arrancar la Fase 3 con el "Setup base" (DB + cola + HMAC + logger) antes de tocar cualquier flujo.
