# Pasos desde que ya tienes la App Creada

## Situación Actual
✅ Ya tienes la app "Stock Mercadolibre" creada y activa
✅ Estás viendo la página de detalles de la app

## Próximos Pasos

### Paso 1: Configurar Permisos de la API

1. **Busca pestañas en la parte superior de la página:**
   - Deberías ver pestañas como: **"Overview"**, **"Configuration"**, **"API credentials"**, etc.

2. **Haz clic en la pestaña "Configuration"** (o "Configuración")

3. **Busca la sección "Admin API integration"** o "Integración de API Admin"

4. **Haz clic en "Configure Admin API scopes"** o "Configurar permisos de API Admin"

5. **Selecciona estos permisos:**
   - ✅ `read_products` - Leer productos
   - ✅ `read_inventory` - Leer inventario
   
   (Puedes buscar estos permisos en el buscador o navegar por las categorías)

6. **Haz clic en "Save"** (Guardar)

### Paso 2: Obtener el Access Token

1. **Ve a la pestaña "API credentials"** (o "Credenciales de API")

2. **Busca el botón "Install app"** (o "Instalar app")
   - Este botón genera el token de acceso
   - Si ya lo instalaste antes, puede que diga "Reinstall app" o "Reinstalar app"

3. **Haz clic en "Install app"**

4. **¡IMPORTANTE!** Inmediatamente después de hacer clic, aparecerá el **Admin API access token**
   - Se verá como un token alfanumérico (formato estándar de Shopify)
   - **COPIA ESTE TOKEN INMEDIATAMENTE** - solo se muestra una vez
   - Si lo pierdes, tendrás que hacer clic en "Reinstall app" para generar uno nuevo

### Paso 3: Guardar el Token

1. **Copia el token completo** (formato estándar de Shopify)

2. **Abre el archivo `.env`** en la carpeta `mercadolibre-sync`

3. **Pega el token** en la línea:
   ```env
   SHOPIFY_ACCESS_TOKEN=SHOPIFY_ACCESS_TOKEN_AQUI
   ```

4. **También agrega la URL de tu tienda:**
   ```env
   SHOPIFY_STORE_URL=tu-tienda.myshopify.com
   ```
   (Solo el nombre, sin https://)

## Si No Ves las Pestañas

Si no ves las pestañas "Configuration" o "API credentials", intenta:

1. **Hacer scroll hacia arriba** - a veces las pestañas están arriba
2. **Buscar un menú lateral** - algunas veces los enlaces están en un menú a la izquierda
3. **Buscar botones como:**
   - "Configure" (Configurar)
   - "API settings" (Configuración de API)
   - "Credentials" (Credenciales)

## Verificación

Una vez que tengas el token, pégalo en `.env` como:
```
SHOPIFY_ACCESS_TOKEN_AQUI
```

- ✅ Formato estándar de token de Shopify
- ✅ Aproximadamente 40-50 caracteres
- ✅ Es alfanumérico

## Siguiente Paso

Después de tener el token, continúa con la configuración de MercadoLibre siguiendo la guía en `GUIA_CREDENCIALES.md`.
