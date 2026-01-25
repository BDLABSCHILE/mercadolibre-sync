# Solución de Problemas Comunes

## Si ves `npm init @shopify/app@latest` en la pantalla

**NO necesitas ejecutar ese comando.** Ese comando es para crear aplicaciones completas de Shopify con interfaz gráfica.

**Lo que SÍ necesitas hacer:**

1. **Ignora ese mensaje/comando**
2. Busca en la misma página un botón que diga:
   - **"Create an app"** (Crear una app)
   - **"Create custom app"** (Crear app personalizada)
   - O simplemente un botón **"Create"** o **"Crear"**

3. Si no ves ese botón, busca en la parte superior de la página un botón que diga:
   - **"Allow custom app development"** → Haz clic en **Enable** (Habilitar)
   - Luego aparecerá el botón para crear apps

## Escenarios Comunes en Shopify

### Escenario 1: Pantalla de "Develop apps" vacía

**Lo que ves:**
- Una página que dice "Develop apps" o "Desarrollar apps"
- Tal vez un mensaje sobre `npm init @shopify/app@latest`
- No hay apps listadas

**Qué hacer:**
1. Busca un botón **"Allow custom app development"** o **"Habilitar desarrollo de apps personalizadas"**
2. Haz clic en **Enable** o **Habilitar**
3. Ahora deberías ver un botón **"Create an app"** o **"Crear una app"**
4. Haz clic ahí

### Escenario 2: Ya tienes apps creadas

**Lo que ves:**
- Una lista de apps que ya creaste anteriormente

**Qué hacer:**
1. Puedes usar una app existente O crear una nueva
2. Si usas una existente, haz clic en ella
3. Si creas una nueva, haz clic en **"Create an app"**

### Escenario 3: Pantalla de creación de app

**Lo que ves:**
- Un formulario para crear una app
- Campos como "App name" o "Nombre de la app"

**Qué hacer:**
1. Ingresa un nombre (ej: "Sincronización Stock")
2. Haz clic en **"Create app"** o **"Crear app"**
3. Te llevará a la página de configuración de la app

### Escenario 4: Página de configuración de la app

**Lo que ves:**
- Pestañas como: "Overview", "Configuration", "API credentials"
- Secciones como "Admin API integration"

**Qué hacer:**
1. Ve a la pestaña **"Configuration"** o **"Configuración"**
2. Busca **"Admin API integration"**
3. Haz clic en **"Configure Admin API scopes"** o **"Configurar permisos"**
4. Selecciona:
   - ✅ `read_products`
   - ✅ `read_inventory`
5. Guarda
6. Ve a la pestaña **"API credentials"** o **"Credenciales de API"**
7. Haz clic en **"Install app"** o **"Instalar app"**
8. **¡COPIA EL TOKEN INMEDIATAMENTE!** (solo se muestra una vez)

## Ruta Alternativa: Usar la URL Directa

Si tienes problemas navegando, intenta ir directamente a:

```
https://tu-tienda.myshopify.com/admin/settings/apps/develop
```

Reemplaza `tu-tienda` con el nombre de tu tienda.

## Si No Tienes Permisos de Owner

**Problema:** No puedes habilitar "Allow custom app development"

**Solución:**
- Necesitas ser el **propietario (owner)** de la tienda
- O pedirle al propietario que habilite esta opción
- O que el propietario cree la app y te comparta el token

## Verificación Rápida

Una vez que tengas el token, pégalo en `.env` como:
```
SHOPIFY_ACCESS_TOKEN_AQUI
```

- Formato estándar de token de Shopify
- Aproximadamente 32-40 caracteres
- Es una cadena alfanumérica

## Si el Token No Funciona

1. **Verifica que copiaste el token completo** (sin espacios)
2. **Verifica que la app tiene los permisos correctos:**
   - `read_products`
   - `read_inventory`
3. **Verifica que instalaste la app** (hiciste clic en "Install app")
4. **Verifica la URL de la tienda** en el `.env`:
   - Correcto: `mi-tienda.myshopify.com`
   - Incorrecto: `https://mi-tienda.myshopify.com` (sin https://)

## Prueba Rápida del Token

Puedes probar si tu token funciona con este comando (reemplaza los valores):

```bash
curl -H "X-Shopify-Access-Token: SHOPIFY_ACCESS_TOKEN_AQUI" \
  "https://TU-TIENDA.myshopify.com/admin/api/2024-01/products.json?limit=1"
```

Si funciona, deberías ver un JSON con productos. Si no, verás un error.

## ¿Necesitas Más Ayuda?

Si estás viendo algo diferente en tu pantalla, describe:
1. ¿Qué texto/opciones ves?
2. ¿En qué paso estás?
3. ¿Qué botones están disponibles?

Con esa información puedo darte instrucciones más específicas.
