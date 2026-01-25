# Configurar la App Correctamente desde Cero

## El Problema:
La app está instalada pero no tiene permisos configurados, por eso no aparece el token.

## Solución: Configurar Permisos Primero

### Paso 1: Ir a la Configuración de Desarrollo de Apps

1. **Ve a:** `https://tu-tienda.myshopify.com/admin/settings/apps/develop`
   (Reemplaza `tu-tienda` con el nombre real de tu tienda)

2. **O desde el menú:**
   - Configuración → Apps y canales de venta
   - Scroll hasta abajo
   - Busca "Desarrollar apps" (Develop apps)
   - Haz clic ahí

### Paso 2: Encontrar tu App

1. **Busca "Stock Mercadolibre"** en la lista de apps
2. **Haz clic en ella** para abrirla

### Paso 3: Configurar los Permisos de API

1. **Busca la pestaña "Configuration"** (Configuración)
   - Si no ves pestañas, busca una sección que diga "Admin API integration"

2. **Busca "Admin API integration"** o "Integración de API Admin"

3. **Haz clic en "Configure Admin API scopes"** o "Configurar permisos de API Admin"

4. **Selecciona estos permisos:**
   - ✅ `read_products` - Leer productos
   - ✅ `read_inventory` - Leer inventario
   
   (Puedes buscarlos en el buscador o navegar por las categorías)

5. **Haz clic en "Save"** (Guardar)

### Paso 4: Instalar la App (Generar el Token)

1. **Ve a la pestaña "API credentials"** (Credenciales de API)
   - O busca un botón que diga "Install app"

2. **Haz clic en "Install app"** o "Instalar app"
   - Si ya está instalada, puede decir "Reinstall app" o "Reinstalar app"
   - Haz clic ahí para generar un nuevo token

3. **¡IMPORTANTE!** Inmediatamente aparecerá el **Admin API access token**
   - Se verá como un token alfanumérico (formato estándar de Shopify)
   - **CÓPIALO INMEDIATAMENTE** - solo se muestra una vez

### Paso 5: Guardar el Token

Guárdalo en tu archivo `.env`:
```env
SHOPIFY_STORE_URL=tu-tienda.myshopify.com
SHOPIFY_ACCESS_TOKEN=SHOPIFY_ACCESS_TOKEN_AQUI
```

## Si No Ves la Opción de Configurar Permisos

Puede que necesites acceder desde la interfaz de Partners:

1. **Ve a:** [partners.shopify.com](https://partners.shopify.com)
2. **Inicia sesión**
3. **Ve a "Apps"** en el menú
4. **Busca "Stock Mercadolibre"**
5. **Haz clic en ella**
6. **Ve a la pestaña "Configuration"**
7. **Configura los permisos** como se describe arriba
8. **Luego ve al admin de tu tienda** para instalar la app y obtener el token

## Verificación

Una vez que tengas el token, pégalo en `.env` como:
```
SHOPIFY_ACCESS_TOKEN_AQUI
```

- ✅ Tiene el formato estándar de token de Shopify
- ✅ Aproximadamente 40-50 caracteres
- ✅ Es alfanumérico

## Resumen del Proceso Correcto:

1. ✅ Crear la app (ya lo hiciste)
2. ⚠️ **Configurar permisos** (esto es lo que falta)
3. ⚠️ **Instalar la app** (para generar el token)
4. ✅ Copiar el token

¡Vamos a hacer los pasos 2 y 3 ahora!
