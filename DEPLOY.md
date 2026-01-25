# 🚀 Guía Rápida de Deploy

## Opción Más Fácil: Render (Recomendado)

### 1. Preparar Repositorio

```bash
# Asegúrate de estar en el directorio correcto
cd mercadolibre-sync

# Verificar que tienes estos archivos:
# - webhook-server.js
# - package.json
# - Procfile (ya creado)
# - .gitignore (ya creado)
```

### 2. Subir a GitHub

```bash
# Si no tienes git inicializado
git init
git add .
git commit -m "Initial commit for webhook server"

# Si ya tienes repo
git add .
git commit -m "Add webhook server files"

# Subir a GitHub
git remote add origin https://github.com/TU-USUARIO/TU-REPO.git
git push -u origin main
```

### 3. Deploy en Render

1. Ve a [render.com](https://render.com) y crea cuenta
2. Click en **"New +"** → **"Web Service"**
3. Conecta tu repositorio de GitHub
4. Configura:
   - **Name:** `mercadolibre-sync`
   - **Root Directory:** `mercadolibre-sync` (si tu repo está en la raíz del proyecto)
   - **Environment:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `node webhook-server.js`
   - **Plan:** `Free`

5. En **"Environment Variables"**, agrega todas las variables de tu `.env`:
   ```
   SHOPIFY_STORE_URL=tu-tienda.myshopify.com
   SHOPIFY_ACCESS_TOKEN=SHOPIFY_ACCESS_TOKEN_AQUI
   SHOPIFY_LOCATION_ID=SHOPIFY_LOCATION_ID_AQUI
   MELI_APP_ID=MELI_APP_ID_AQUI
   MELI_CLIENT_SECRET=MELI_CLIENT_SECRET_AQUI
   MELI_REFRESH_TOKEN=MELI_REFRESH_TOKEN_AQUI
   MELI_USER_ID=MELI_USER_ID_AQUI
   STOCK_OFFSET=1
   PORT=10000
   ```

6. Click en **"Create Web Service"**

7. Espera a que termine el deploy (2-3 minutos)

8. Obtén tu URL: `https://mercadolibre-sync.onrender.com`

### 4. Configurar Webhooks

**Shopify:**
- Settings → Notifications → Webhooks
- URL: `https://mercadolibre-sync.onrender.com/webhook/inventory`
- Event: `Inventory levels update`
- Format: `JSON`

**MercadoLibre:**
- [developers.mercadolibre.com.ar](https://developers.mercadolibre.com.ar)
- URL: `https://mercadolibre-sync.onrender.com/webhooks/mercadolibre/order`
- Topic: `orders_v2`

### 5. Mantener Despierto (Opcional pero Recomendado)

Para evitar que Render "duerma" el servicio:

1. Ve a [uptimerobot.com](https://uptimerobot.com)
2. Crea cuenta gratuita
3. Click en **"Add New Monitor"**
4. Configura:
   - **Monitor Type:** HTTP(s)
   - **Friendly Name:** MercadoLibre Sync
   - **URL:** `https://mercadolibre-sync.onrender.com/health`
   - **Monitoring Interval:** 5 minutes
5. Click en **"Create Monitor"**

Esto hará ping cada 5 minutos y mantendrá tu servicio despierto.

### 6. Verificar que Funciona

```bash
# Probar health check
curl https://mercadolibre-sync.onrender.com/health

# Deberías ver:
# {"status":"ok","timestamp":"...","processed_orders_count":0,"is_syncing_from_meli":false}
```

---

## Alternativa: Railway (Sin Sleep)

### 1. Crear Cuenta

1. Ve a [railway.app](https://railway.app)
2. Crea cuenta con GitHub
3. Agrega tarjeta de crédito (no se cobra si no excedes $5/mes)

### 2. Deploy

1. Click en **"New Project"**
2. Selecciona **"Deploy from GitHub repo"**
3. Selecciona tu repositorio
4. Railway detectará automáticamente que es Node.js
5. En **"Variables"**, agrega todas las variables de entorno
6. Railway desplegará automáticamente

### 3. Obtener URL

Railway te dará una URL automáticamente. Puedes configurar un dominio personalizado si quieres.

---

## Verificación Post-Deploy

### 1. Health Check

```bash
curl https://tu-url.onrender.com/health
```

Debería responder con:
```json
{
  "status": "ok",
  "timestamp": "2026-01-25T...",
  "processed_orders_count": 0,
  "is_syncing_from_meli": false
}
```

### 2. Test Manual de Sincronización

```bash
curl "https://tu-url.onrender.com/test-sync?sku=B-M-CRU"
```

### 3. Ver Logs

- **Render:** Dashboard → Logs
- **Railway:** Dashboard → Deployments → View Logs

### 4. Probar Webhook Real

1. Cambia stock de un producto en Shopify
2. Verifica logs en Render/Railway
3. Verifica que el stock se actualizó en MercadoLibre

---

## Troubleshooting

### Error: "Cannot find module"

**Solución:** Verifica que `package.json` tenga todas las dependencias:
```json
{
  "dependencies": {
    "axios": "^1.6.0",
    "dotenv": "^16.3.1",
    "express": "^4.18.2"
  }
}
```

### Webhooks no llegan

**Verificar:**
1. URL es accesible (prueba en navegador)
2. Webhooks configurados con URL correcta
3. Variables de entorno están configuradas
4. Revisar logs para ver errores

### Servicio se duerme (Render)

**Solución:** Configurar UptimeRobot (ver paso 5 arriba)

### Variables de entorno no funcionan

**Solución:** 
1. Verifica que estén en el dashboard del hosting (no en `.env`)
2. Verifica que no tengan espacios extra
3. Reinicia el servicio después de agregar variables

---

## Próximos Pasos

Una vez deployado:

1. ✅ Servicio online 24/7
2. ✅ Webhooks configurados
3. ✅ Health check configurado
4. ⚠️ **Importante:** Implementar validación de webhooks (ver `ANALISIS_TECNICO_COMPLETO.md`)

---

**¡Listo! Tu servidor estará online 24/7.** 🎉
