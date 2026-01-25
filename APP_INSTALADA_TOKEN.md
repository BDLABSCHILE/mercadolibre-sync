# App Instalada - Cómo Obtener el Token

## Situación Actual:
✅ La app "Stock Mercadolibre" está instalada
⚠️ Estás viendo contenido de ejemplo ("Example Domain")
✅ Necesitas ir a la configuración para ver el token

## Pasos para Obtener el Admin API Access Token:

### Método 1: Desde Settings (Configuración) de la Tienda

1. **En el menú lateral izquierdo**, busca y haz clic en **"Configuración"** (Settings)
   - Está al final de la lista del menú

2. **Dentro de Configuración**, busca **"Apps y canales de venta"** (Apps and sales channels)

3. **Haz clic en "Apps y canales de venta"**

4. **Busca tu app "Stock Mercadolibre"** en la lista de apps instaladas

5. **Haz clic en los tres puntos (⋯)** o en el nombre de la app

6. **Busca una opción que diga:**
   - "API credentials" (Credenciales de API)
   - "View API credentials" (Ver credenciales de API)
   - O simplemente haz clic en la app para abrir sus detalles

7. **Deberías ver el Admin API access token** (formato estándar de Shopify)

### Método 2: URL Directa

1. **Abre una nueva pestaña** y ve directamente a:
   ```
   https://tu-tienda.myshopify.com/admin/settings/apps
   ```
   (Reemplaza `tu-tienda` con el nombre real de tu tienda)

2. **Busca "Stock Mercadolibre"** en la lista

3. **Haz clic en ella**

4. **Busca la sección "API credentials"** o **"Credenciales de API"**

5. **Ahí deberías ver el Admin API access token**

### Método 3: Si el Token No Aparece

Si ya instalaste la app pero no ves el token:

1. Ve a: `https://tu-tienda.myshopify.com/admin/settings/apps/develop`
2. Busca "Stock Mercadolibre"
3. Haz clic en ella
4. Ve a la pestaña **"API credentials"**
5. Si no hay token, haz clic en **"Reinstall app"** o **"Reinstalar app"**
6. Esto generará un nuevo token

## Cómo se Ve el Token:

```
SHOPIFY_ACCESS_TOKEN_AQUI
```

- ✅ Formato estándar de token de Shopify
- ✅ Aproximadamente 40-50 caracteres
- ✅ Es alfanumérico

## Una Vez que Tengas el Token:

Guárdalo en tu archivo `.env`:

```env
SHOPIFY_STORE_URL=tu-tienda.myshopify.com
SHOPIFY_ACCESS_TOKEN=SHOPIFY_ACCESS_TOKEN_AQUI
```

## Nota sobre "Example Domain":

El texto "Example Domain" que ves es normal - es porque la app no tiene una interfaz personalizada configurada. Lo importante es que la app esté instalada y puedas acceder a sus credenciales de API desde la configuración.
