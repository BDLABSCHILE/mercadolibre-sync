# Instrucciones Rápidas - Desde la Interfaz Actual

## Lo que estás viendo ahora:
- Estás en la sección **"Logs"** de tu app "Stock Mercadolibre"
- En el menú lateral izquierdo hay varias opciones

## Pasos a seguir:

### Paso 1: Ir a Settings
1. **En el menú lateral izquierdo**, busca y haz clic en **"Settings"**
   - Está en la lista debajo de "Stock Mercadolibre"
   - Debería estar al final de la lista: Home, Versions, Monitoring, Logs, **Settings**

### Paso 2: Buscar la Configuración de API
Una vez en Settings, busca:

1. **Sección "API credentials"** o **"Credenciales de API"**
   - O busca algo como **"Admin API"** o **"API access"**

2. **Si ves "Configure Admin API scopes"** o **"Configurar permisos"**:
   - Haz clic ahí
   - Selecciona: `read_products` y `read_inventory`
   - Guarda

3. **Busca el botón "Install app"** o **"Instalar app"**
   - Este botón genera el Access Token

### Paso 3: Obtener el Token
1. Haz clic en **"Install app"** o **"Instalar app"**
2. **Inmediatamente aparecerá el token** (formato estándar de Shopify)
3. **CÓPIALO INMEDIATAMENTE** - solo se muestra una vez

### Paso 4: Guardar en .env
Pega el token en tu archivo `.env`:
```env
SHOPIFY_ACCESS_TOKEN=SHOPIFY_ACCESS_TOKEN_AQUI
SHOPIFY_STORE_URL=tu-tienda.myshopify.com
```

## Si en Settings no ves las opciones de API:

Puede que necesites acceder desde el Admin de tu tienda directamente:

1. Ve a: `https://tu-tienda.myshopify.com/admin/settings/apps/develop`
2. Busca tu app "Stock Mercadolibre"
3. Haz clic en ella
4. Busca las pestañas: "Configuration" y "API credentials"

## Alternativa: Usar la URL Directa del Admin

Si la interfaz de Partners no te muestra las credenciales, accede directamente al admin de tu tienda:

```
https://tu-tienda.myshopify.com/admin/settings/apps
```

Luego busca tu app y haz clic en ella para ver las credenciales.
