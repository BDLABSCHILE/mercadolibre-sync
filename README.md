# Sincronización de Stock Shopify ↔ MercadoLibre

Esta aplicación sincroniza el stock de productos entre Shopify y MercadoLibre, aplicando una regla de offset (por defecto: restar 1 unidad del stock de Shopify para MercadoLibre).

## Características

- ✅ Sincronización automática de stock por SKU
- ✅ Regla configurable: `Stock MercadoLibre = Stock Shopify - OFFSET` (mínimo 0)
- ✅ Sincronización masiva de todos los productos
- ✅ Sincronización individual por SKU
- ✅ Manejo automático de tokens de MercadoLibre
- ✅ Logs detallados del proceso

## Requisitos Previos

1. **Node.js** (versión 16 o superior)
2. **Credenciales de Shopify**:
   - URL de tu tienda (ej: `mi-tienda.myshopify.com`)
   - Access Token (creado desde Admin → Apps → Develop apps)
3. **Credenciales de MercadoLibre**:
   - App ID
   - Client Secret
   - Access Token
   - Refresh Token

## Instalación

1. **Instalar dependencias:**
   ```bash
   cd mercadolibre-sync
   npm install
   ```

2. **Configurar variables de entorno:**
   ```bash
   cp .env.example .env
   ```

3. **Editar el archivo `.env` con tus credenciales:**
   ```env
   # Shopify
   SHOPIFY_STORE_URL=tu-tienda.myshopify.com
   SHOPIFY_ACCESS_TOKEN=SHOPIFY_ACCESS_TOKEN_AQUI

   # MercadoLibre
   MELI_APP_ID=MELI_APP_ID_AQUI
   MELI_CLIENT_SECRET=MELI_CLIENT_SECRET_AQUI
   MELI_ACCESS_TOKEN=MELI_ACCESS_TOKEN_AQUI
   MELI_REFRESH_TOKEN=MELI_REFRESH_TOKEN_AQUI

   # Configuración de sincronización
   STOCK_OFFSET=1
   ```

## Cómo Obtener las Credenciales

📖 **Para una guía paso a paso detallada en español, consulta [GUIA_CREDENCIALES.md](./GUIA_CREDENCIALES.md)**

### Resumen Rápido

**Shopify:**
1. Ve a **Settings** → **Apps and sales channels** → **Develop apps**
2. Crea una nueva app personalizada
3. Configura permisos: `read_products` y `read_inventory`
4. Instala la app y copia el **Admin API access token**

**MercadoLibre:**
1. Ve a [developers.mercadolibre.com.ar](https://developers.mercadolibre.com.ar/)
2. Crea una aplicación
3. Obtén **App ID**, **Client Secret**, **Access Token** y **Refresh Token**

**⚠️ Nota Importante:** Si ves el comando `npm init @shopify/app@latest`, **NO lo necesitas**. Ese comando es para crear apps completas de Shopify con interfaz y webhooks. Para nuestra sincronización simple, solo necesitas el Access Token siguiendo los pasos de arriba o la guía detallada.

## Uso

### Sincronizar Todos los Productos

Ejecuta la sincronización completa de todos los productos que tengan SKU en común:

```bash
npm start
```

o

```bash
node index.js
```

### Sincronizar un SKU Específico

```bash
node index.js SKU-12345
```

### Sincronización en Tiempo Real con Webhooks

Para sincronizar automáticamente cuando cambie el stock en Shopify, puedes usar el servidor de webhooks:

1. **Iniciar el servidor de webhooks:**
   ```bash
   npm run webhook
   ```

2. **Configurar el webhook en Shopify:**
   - Ve a **Settings** → **Notifications**
   - Scroll hasta **Webhooks**
   - Haz clic en **Create webhook**
   - Evento: **Inventory levels update**
   - URL: `https://tu-servidor.com/webhook/inventory`
   - Formato: **JSON**

3. **Exponer tu servidor local (opcional):**
   Si estás ejecutando localmente, puedes usar herramientas como:
   - [ngrok](https://ngrok.com/): `ngrok http 3000`
   - [localtunnel](https://localtunnel.github.io/www/): `lt --port 3000`

**Nota:** El servidor de webhooks requiere que tu aplicación esté accesible desde internet. Para producción, considera usar servicios como Heroku, Railway, o Vercel.

## Configuración de la Regla de Stock

Por defecto, la aplicación aplica la regla:
```
Stock MercadoLibre = Stock Shopify - 1 (mínimo 0)
```

Puedes cambiar el offset editando la variable `STOCK_OFFSET` en el archivo `.env`:

- `STOCK_OFFSET=1` → Resta 1 unidad
- `STOCK_OFFSET=2` → Resta 2 unidades
- `STOCK_OFFSET=0` → Mismo stock en ambas plataformas

## Automatización

### Usando Cron (Linux/Mac)

Para ejecutar la sincronización automáticamente cada hora:

```bash
crontab -e
```

Agrega:
```cron
0 * * * * cd /ruta/a/mercadolibre-sync && node index.js >> sync.log 2>&1
```

### Usando Task Scheduler (Windows)

1. Abre Task Scheduler
2. Crea una tarea básica
3. Configura para ejecutar: `node index.js`
4. Establece la frecuencia deseada

### Usando GitHub Actions

Puedes crear un workflow que se ejecute periódicamente:

```yaml
name: Sync Stock
on:
  schedule:
    - cron: '0 * * * *'  # Cada hora
  workflow_dispatch:

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: '18'
      - run: |
          cd mercadolibre-sync
          npm install
          echo "${{ secrets.SHOPIFY_STORE_URL }}" > .env
          # ... agregar todas las variables de entorno
          npm start
```

## Estructura del Proyecto

```
mercadolibre-sync/
├── index.js                 # Script principal de sincronización
├── webhook-server.js        # Servidor para sincronización en tiempo real
├── shopify-api.js          # Cliente de API de Shopify
├── mercadolibre-api.js     # Cliente de API de MercadoLibre
├── package.json            # Dependencias y scripts
├── env.example             # Plantilla de configuración
├── .env                    # Configuración real (no commitear)
└── README.md               # Esta documentación
```

## Solución de Problemas

### Error: "SHOPIFY_STORE_URL y SHOPIFY_ACCESS_TOKEN deben estar configurados"
- Verifica que el archivo `.env` existe y tiene las variables correctas
- Asegúrate de que no haya espacios extra en los valores

### Error: "MELI_ACCESS_TOKEN debe estar configurado"
- Verifica tus credenciales de MercadoLibre
- Si el token expiró, obtén uno nuevo o deja que la app lo refresque automáticamente

### Error 401 (No autorizado)
- Verifica que los tokens sean válidos
- Para Shopify, asegúrate de que el token tenga los permisos necesarios
- Para MercadoLibre, la app intentará refrescar el token automáticamente

### No encuentra productos por SKU
- Verifica que los SKUs sean exactamente iguales en ambas plataformas
- Los SKUs son case-sensitive
- Asegúrate de que los productos estén activos en MercadoLibre

## Notas Importantes

- ⚠️ La sincronización es unidireccional: Shopify → MercadoLibre
- ⚠️ El stock en MercadoLibre nunca será mayor que (Stock Shopify - OFFSET)
- ⚠️ Si el stock calculado es negativo, se establecerá en 0
- ⚠️ Solo se sincronizan productos que tienen SKU en ambas plataformas
- ⚠️ Los productos deben estar activos en MercadoLibre para ser actualizados

## Licencia

MIT
