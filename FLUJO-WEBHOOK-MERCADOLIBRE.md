# Flujo: venta en MercadoLibre → actualización de stock en Shopify

## Cómo debería funcionar

1. **Cliente compra en MercadoLibre** → MercadoLibre crea una orden (ej. ID 2000015148691602).

2. **MercadoLibre envía un webhook a tu app en Render**  
   - Método: `POST`  
   - URL: `https://TU-APP.onrender.com/webhooks/mercadolibre/order`  
   - Body (ejemplo): `{ "topic": "orders_v2", "resource": "/orders/2000015148691602", "user_id": "..." }`

3. **Tu app (webhook-server.js)** recibe ese POST:
   - Valida que `topic === 'orders_v2'`.
   - Extrae el `order_id` del `resource`.
   - Hace `GET /orders/{orderId}` a la API de MercadoLibre para obtener la orden completa.
   - Con `processMercadoLibreOrder()`: resuelve el SKU por cada ítem (con el mapping) y llama a **Shopify** (`updateStockBySKU`) para descontar stock.

4. **Si todo va bien** → el stock en Shopify baja y en los logs ves algo como:  
   `✅ Stock actualizado en Shopify: B-M-CRU (cantidad descontada: 1, stock actual: 3)`.

---

## Si NO se actualiza Shopify, puede ser por:

### A) El webhook nunca llega a Render

- En MercadoLibre no está configurada la URL del webhook, o está mal (http, otro path, otro dominio).
- Debe estar en: **Desarrolladores → Tus integraciones → Notificaciones** (o similar), topic **orders_v2**, URL exacta:  
  `https://TU-APP.onrender.com/webhooks/mercadolibre/order`

**Qué revisar:** En los logs de Render, cuando cae la venta en Meli, ¿aparece la línea  
`🛒 Venta recibida en MercadoLibre: Order ID = ...`?  
- Si **nunca** aparece → el webhook no está llegando (configuración en Meli o URL incorrecta).

### B) El webhook llega pero falla el resolver de SKU

- Si el ítem tiene `variation_id = null` y el `item_id` tiene **varios** SKUs en el mapping → se marca como **ambiguous** y **no** se descuenta stock (para no adivinar).
- Si el `item_id` no está en el mapping → "SKU no encontrado" y no se descuenta.

**Qué revisar en logs:**  
- `✅ SKU resuelto: XXX` → el resolver funcionó.  
- `❌ item_id=... con variation_id=null tiene N SKUs...` → ambigüedad, no se descuenta.  
- `⚠️ SKU no encontrado para item ...` → ítem no está en el mapping.

### C) El webhook llega, el SKU se resuelve, pero falla Shopify

- `updateStockBySKU` puede fallar si el SKU no existe en Shopify o la API de Shopify devuelve error.

**Qué revisar en logs:**  
- `❌ Error actualizando stock para SKU XXX` → falló la llamada a Shopify.

### D) Orden en estado que no procesamos

- Solo se procesan órdenes en: `confirmed`, `payment_required`, `payment_in_process`, `paid`.  
- Si la orden llega en otro estado, se contesta 200 pero no se descuenta y verás:  
  `⏭️ Orden ... en estado "XXX", no procesada aún`.

---

## Qué hacer ahora (diagnóstico rápido)

1. **Confirmar URL del webhook en MercadoLibre**  
   Que sea exactamente:  
   `https://TU-APP.onrender.com/webhooks/mercadolibre/order`  
   con topic **orders_v2**.

2. **Hacer una venta de prueba en MercadoLibre** (o esperar la próxima).

3. **En Render → Logs**, buscar en el momento de esa venta:
   - Si ves **`🛒 Venta recibida en MercadoLibre: Order ID = ...`** → el webhook **sí** está llegando. A partir de ahí mira si aparece:
     - `✅ SKU resuelto: ...` y `✅ Stock actualizado en Shopify: ...` → flujo OK.
     - O alguno de los mensajes de error anteriores (ambiguo, SKU no encontrado, error Shopify, etc.).
   - Si **no** ves esa línea → el webhook no está llegando; hay que corregir la URL/topic en MercadoLibre.

4. **Probar el endpoint a mano** (para ver que la app responde):  
   ```bash
   curl -X POST https://TU-APP.onrender.com/webhooks/mercadolibre/order \
     -H "Content-Type: application/json" \
     -d '{"topic":"orders_v2","resource":"/orders/123","user_id":"1"}'
   ```  
   Deberías recibir 200 (y en logs puede salir error de “orden no encontrada” o idempotencia, pero confirma que la ruta existe y responde).

---

## Evitar loops y reintentos infinitos

- **SKU que no está en MercadoLibre (ej. B-G-COBT):** Si una venta en Shopify dispara el webhook de inventario y ese SKU no se vende en Meli, antes devolvíamos 500 y Shopify **reintentaba sin parar**. Ahora el webhook de inventario devuelve **siempre 200** (éxito o “sync parcial”); así Shopify no reintenta. En logs verás algo como “sync parcial” o “no encontrado en MercadoLibre” y no habrá bucle.
- **Misma orden reprocesada en cada deploy (ej. B-G-MOKA):** La idempotencia por defecto es en memoria, así que en cada reinicio/deploy se pierde y el job puede volver a procesar la misma orden. Para evitarlo, en Render configura **`IDEMPOTENCY_STORE=file`** (y opcionalmente `IDEMPOTENCY_FILE_DIR` si quieres otra carpeta). Así el webhook y el job comparten el mismo archivo y las órdenes ya procesadas no se vuelven a tocar.

---

## Resumen

- **Quién actualiza Shopify cuando cae una venta en Meli:** solo el **webhook** `POST /webhooks/mercadolibre/order` (cuando Meli lo llama).
- El job **check-pending-orders** es un respaldo (órdenes recientes que no se procesaron por webhook); con `PENDING_ORDERS_LAST_HOURS=0` no procesa ninguna y no interfiere.
- Si el webhook está bien configurado en Meli y llega a Render, en los logs verás `🛒 Venta recibida en MercadoLibre`; a partir de ahí los mensajes te dicen si falló el resolver de SKU o la actualización en Shopify.
- **Idempotencia en archivo:** `IDEMPOTENCY_STORE=file` evita reprocesar la misma orden en cada deploy.
