# Cómo Obtener el Admin API Access Token

## ⚠️ Lo que NO necesitas:
- ❌ Client ID (ejemplo: SHOPIFY_CLIENT_ID_AQUI)
- ❌ Secret ID (ejemplo: SHOPIFY_SECRET_ID_AQUI)

Estos son para OAuth y desarrollo de apps, pero NO para nuestra sincronización.

## ✅ Lo que SÍ necesitas:
- ✅ **Admin API access token** (prefijo estándar de token de Shopify)

## Pasos para Obtener el Token Correcto:

### Opción 1: Desde la Interfaz de Partners (donde estás ahora)

1. **En la página donde ves el Client ID y Secret ID:**
   - Busca una sección que diga **"Admin API access scopes"** o **"API access"**
   - O busca un botón que diga **"Install app"** o **"Instalar app"**

2. **Si ves una lista de permisos (scopes):**
   - Asegúrate de tener seleccionados:
     - ✅ `read_products`
     - ✅ `read_inventory`
   - Luego busca el botón **"Install app"** o **"Save and install"**

3. **Haz clic en "Install app"**
   - Esto generará el **Admin API access token**
   - Aparecerá un token con el prefijo estándar de Shopify
   - **CÓPIALO INMEDIATAMENTE** - solo se muestra una vez

### Opción 2: Desde el Admin de tu Tienda (Más Directo)

1. **Abre una nueva pestaña** y ve a:
   ```
   https://tu-tienda.myshopify.com/admin/settings/apps
   ```
   (Reemplaza `tu-tienda` con el nombre real de tu tienda)

2. **Busca tu app "Stock Mercadolibre"** en la lista de apps

3. **Haz clic en ella**

4. **Busca la pestaña "API credentials"** o **"Credenciales de API"**

5. **Haz clic en "Install app"** o **"Instalar app"**

6. **Copia el Admin API access token** (formato estándar de Shopify)

### Opción 3: Si ya instalaste la app antes

Si ya instalaste la app pero perdiste el token:

1. Ve a: `https://tu-tienda.myshopify.com/admin/settings/apps`
2. Busca "Stock Mercadolibre"
3. Haz clic en ella
4. Busca **"Reinstall app"** o **"Reinstalar app"**
5. Haz clic y se generará un nuevo token

## Cómo se Ve el Token Correcto:

```
SHOPIFY_ACCESS_TOKEN_AQUI
```

- ✅ Empieza con el prefijo de token de Shopify (formato estándar)
- ✅ Tiene aproximadamente 40-50 caracteres
- ✅ Es alfanumérico (letras y números)

## Diferencia entre los IDs y el Token:

- **Client ID**: Identificador de tu app (no lo necesitas)
- **Secret ID**: Secreto de tu app (no lo necesitas)
- **Admin API access token**: Token de acceso para usar la API (ESTO es lo que necesitas)

## Una Vez que Tengas el Token:

Guárdalo en tu archivo `.env`:

```env
SHOPIFY_STORE_URL=tu-tienda.myshopify.com
SHOPIFY_ACCESS_TOKEN=SHOPIFY_ACCESS_TOKEN_AQUI
```

¡Ese es el token que necesitas para la sincronización!
