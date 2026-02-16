# Paso a paso: verificar que los cambios funcionaron

## Paso 1: Subir el código a GitHub

Abre la terminal y ejecuta (una línea por vez):

```bash
cd /Users/benja/shopify-theme/valiz-theme/mercadolibre-sync
git add .
git status
```

Deberías ver archivos nuevos o modificados (por ejemplo `meli-sku-mapping.js`, `check-pending-orders.js`, `webhook-server.js`).

Luego:

```bash
git commit -m "Resolver compartido Meli: webhook y job usan mismo mapping"
git push origin main
```

(Si tu rama se llama `master`, escribe `git push origin master`.)

Si pide usuario/contraseña de GitHub, usa tu usuario y un **Personal Access Token** (no la contraseña normal).

---

## Paso 2: Revisar el deploy en Render

1. Entra a [render.com](https://render.com) e inicia sesión.
2. Abre tu **servicio** (el que corre el webhook).
3. En la pestaña **Events** o **Deploys** debería aparecer un deploy nuevo (automático tras el `git push`). Espera a que termine y pase a **Succeeded** / **Live**.
4. Si no se disparó solo: en **Manual Deploy** → **Deploy latest commit**.

---

## Paso 3: Variable de entorno (opcional pero recomendado)

Para que el job **no** vuelva a tocar órdenes viejas ni la que tiene 13 variantes:

1. En tu servicio de Render → **Environment**.
2. Añade (o edita):
   - **Key:** `PENDING_ORDERS_LAST_HOURS`
   - **Value:** `0`
3. Guarda. Render puede reiniciar solo.

Con `0`, al arrancar el servidor el job no procesará ninguna orden; solo el **webhook** actualizará Shopify cuando caiga una venta nueva.

---

## Paso 4: Cómo comprobar que funcionó

### A) Si dejaste PENDING_ORDERS_LAST_HOURS=0

1. En Render → **Logs**.
2. Reinicia el servicio (o espera al próximo deploy).
3. Deberías ver algo como:
   - `📦 Total órdenes encontradas: 7`
   - `⏭️  Ignorando 7 órdenes anteriores a las últimas 0h...` (o que procesa 0 recientes).
   - Ya **no** debe aparecer `Procesando orden [object Object]` ni error 400.

### B) Cuando caiga una venta nueva en MercadoLibre

1. En Render → **Logs**, en el momento de la venta busca:
   - `🛒 Venta recibida en MercadoLibre: Order ID = ...`
2. Después debería salir algo como:
   - `✅ SKU resuelto: B-G-XXX` (o el SKU que sea)
   - `✅ Stock actualizado en Shopify: B-G-XXX (cantidad descontada: 1, ...)`
3. En Shopify, revisa que el stock del producto correcto bajó.

### C) Probar el endpoint de test (sin hacer venta real)

En tu compu, con el servidor corriendo en Render (o en local):

```bash
curl -X POST "https://TU-APP.onrender.com/__test__/mercadolibre/order?dry_run=1" \
  -H "Content-Type: application/json" \
  -d '{"id":"test-1","status":"paid","order_items":[{"item":{"id":"MLC3539440134"},"quantity":1,"variation_id":189749808606}]}'
```

(Sustituye `TU-APP` por la URL real de tu servicio en Render.)

Deberías recibir un JSON con `success: true`, `sku` resuelto (ej. B-G-CAFGA) y `dry_run: true`. Eso confirma que el resolver del mapping funciona.

---

## Resumen

| Paso | Qué haces | Para qué |
|------|-----------|----------|
| 1 | `git add .` → `commit` → `push` | Subir código nuevo |
| 2 | Render: que el último deploy esté en verde | Que Render use ese código |
| 3 | En Render, `PENDING_ORDERS_LAST_HOURS=0` | Que el job no toque órdenes viejas |
| 4 | Mirar logs al arrancar y cuando haya una venta (o probar el curl) | Confirmar que ya no hay [object Object]/400 y que el webhook actualiza Shopify |

Si en el Paso 4 algo no coincide (por ejemplo sigue saliendo [object Object] o no baja stock), copia el trozo de log y lo revisamos.
