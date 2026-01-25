# Guía Paso a Paso: Obtener Credenciales

## Shopify Access Token (Método Simple)

### Paso 1: Acceder al Admin de Shopify
1. Ve a `https://tu-tienda.myshopify.com/admin`
2. Inicia sesión con tu cuenta

### Paso 2: Habilitar Desarrollo de Apps (Solo la primera vez)
1. Ve a **Configuración** (Settings) → **Apps y canales de venta** (Apps and sales channels)
2. Scroll hasta la parte inferior
3. Busca **Desarrollar apps** (Develop apps)
4. Si ves "Allow custom app development", haz clic en **Enable** (Habilitar)
   - Esto requiere permisos de propietario de la tienda
   - Solo necesitas hacerlo una vez

### Paso 3: Crear una App Personalizada
1. En la misma página, haz clic en **Crear una app** (Create an app)
2. Ingresa un nombre, por ejemplo: **"Sincronización Stock ML"**
3. Haz clic en **Crear app**

### Paso 4: Configurar Permisos
1. En la página de tu app, ve a la pestaña **Configuración** (Configuration)
2. Busca la sección **Admin API integration**
3. Haz clic en **Configure Admin API scopes**
4. Selecciona estos permisos:
   - ✅ `read_products` - Leer productos
   - ✅ `read_inventory` - Leer inventario
5. Haz clic en **Guardar** (Save)

### Paso 5: Instalar la App y Obtener el Token
1. Ve a la pestaña **Credenciales de API** (API credentials)
2. Haz clic en **Instalar app** (Install app)
3. **¡IMPORTANTE!** Copia el **Admin API access token** que aparece
   - Se ve como un token alfanumérico largo (formato estándar de Shopify)
   - Este token solo se muestra UNA VEZ, así que cópialo inmediatamente
   - Si lo pierdes, tendrás que generar uno nuevo

### Paso 6: Usar el Token
Pega este token en tu archivo `.env`:
```env
SHOPIFY_ACCESS_TOKEN=SHOPIFY_ACCESS_TOKEN_AQUI
SHOPIFY_STORE_URL=tu-tienda.myshopify.com
```

---

## MercadoLibre Credenciales

### Paso 1: Crear una Aplicación
1. Ve a [https://developers.mercadolibre.com.ar/](https://developers.mercadolibre.com.ar/)
2. Inicia sesión con tu cuenta de MercadoLibre
3. Ve a **Mis aplicaciones** (My Applications)
4. Haz clic en **Crear nueva aplicación**
5. Completa el formulario:
   - **Nombre**: Sincronización Stock
   - **Tipo**: Integración
   - **Plataforma**: Web
6. Guarda y copia:
   - **App ID** (Application ID)
   - **Secret Key** (Client Secret)

### Paso 2: Obtener Access Token y Refresh Token

**Opción A: Usando la herramienta de MercadoLibre (Recomendado)**
1. En la página de tu aplicación, busca la sección **OAuth**
2. Haz clic en el botón **Obtener token**
3. Te redirigirá a autorizar la aplicación
4. Después de autorizar, copia:
   - **Access Token**
   - **Refresh Token**

**Opción B: Usando Postman o cURL**
1. Visita esta URL (reemplaza `TU_APP_ID` con tu App ID):
   ```
   https://auth.mercadolibre.com.ar/authorization?response_type=code&client_id=TU_APP_ID&redirect_uri=https://localhost
   ```
2. Autoriza la aplicación
3. Copia el `code` de la URL de redirección
4. Intercambia el code por tokens usando la API de OAuth

### Paso 3: Usar los Tokens
Pega estos valores en tu archivo `.env`:
```env
MELI_APP_ID=MELI_APP_ID_AQUI
MELI_CLIENT_SECRET=MELI_CLIENT_SECRET_AQUI
MELI_ACCESS_TOKEN=MELI_ACCESS_TOKEN_AQUI
MELI_REFRESH_TOKEN=MELI_REFRESH_TOKEN_AQUI
```

---

## ⚠️ Nota Importante sobre `npm init @shopify/app@latest`

Si ves ese comando en la documentación de Shopify, es para crear **aplicaciones completas** con:
- Interfaz de usuario
- Webhooks configurados
- OAuth flow
- Base de datos
- Etc.

**Para nuestra sincronización simple, NO necesitas eso.** Solo necesitas el Access Token que obtienes siguiendo los pasos de arriba.

El método que te mostré es más simple y suficiente para sincronizar stock.

---

## Verificar que Todo Funciona

Después de configurar tus credenciales, prueba la conexión:

```bash
cd mercadolibre-sync
npm install
node index.js SKU-DE-PRUEBA
```

Si todo está bien configurado, verás los logs de sincronización. Si hay errores, revisa:
- Que los tokens sean correctos
- Que los permisos estén configurados correctamente
- Que el SKU exista en ambas plataformas
