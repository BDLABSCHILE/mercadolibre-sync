# Desde la Vista de App Instalada - Cómo Llegar a las Credenciales

## Situación Actual:
✅ Estás viendo la página de detalles de "Stock Mercadolibre" instalada
⚠️ Esta es la vista de usuario, no la vista de desarrollador
✅ Necesitas ir a la sección de desarrollo para configurar permisos y obtener el token

## Solución: Ir a la Sección de Desarrollo de Apps

### Opción 1: Desde el Menú Lateral (Más Fácil)

1. **En el menú lateral izquierdo**, busca **"Configuración"** (Settings)
   - Está al final de la lista del menú

2. **Haz clic en "Configuración"**

3. **Dentro de Configuración**, busca **"Apps y canales de venta"** (Apps and sales channels)

4. **Haz clic en "Apps y canales de venta"**

5. **Scroll hasta la parte inferior** de esa página

6. **Busca la sección "Desarrollar apps"** (Develop apps)
   - Puede estar al final de la página
   - O en una sección separada

7. **Haz clic en "Desarrollar apps"** o "Develop apps"

8. **Busca "Stock Mercadolibre"** en la lista de apps de desarrollo

9. **Haz clic en ella**

10. **Ahora deberías ver pestañas como:**
    - "Overview"
    - "Configuration" ← **AQUÍ**
    - "API credentials" ← **Y AQUÍ**

### Opción 2: URL Directa

1. **Abre una nueva pestaña** y ve directamente a:
   ```
   https://tu-tienda.myshopify.com/admin/settings/apps/develop
   ```
   (Reemplaza `tu-tienda` con el nombre real de tu tienda - en tu caso parece ser "valiz")

2. **Busca "Stock Mercadolibre"** en la lista

3. **Haz clic en ella**

4. **Deberías ver las pestañas de configuración**

### Opción 3: Desde Partners (Si las Opciones Anteriores No Funcionan)

1. **Ve a:** [partners.shopify.com](https://partners.shopify.com)

2. **Inicia sesión** con tu cuenta

3. **Ve a "Apps"** en el menú

4. **Busca "Stock Mercadolibre"**

5. **Haz clic en ella**

6. **Ve a la pestaña "Configuration"**

7. **Configura los permisos:**
   - `read_products`
   - `read_inventory`

8. **Guarda**

9. **Luego vuelve al admin de tu tienda** para instalar y obtener el token

## Una Vez que Estés en la Configuración de Desarrollo:

### Paso 1: Configurar Permisos
1. Ve a la pestaña **"Configuration"**
2. Busca **"Admin API integration"**
3. Haz clic en **"Configure Admin API scopes"**
4. Selecciona:
   - ✅ `read_products`
   - ✅ `read_inventory`
5. Guarda

### Paso 2: Obtener el Token
1. Ve a la pestaña **"API credentials"**
2. Haz clic en **"Install app"** o **"Reinstall app"**
3. **Copia el token** (formato estándar de Shopify)

## Diferencia Importante:

- **Vista de App Instalada** (donde estás ahora): Muestra información de la app como usuario
- **Vista de Desarrollo** (donde necesitas ir): Permite configurar permisos y ver credenciales

## Para tu Tienda Específicamente:

Basándome en lo que veo, tu tienda es "valiz", así que la URL sería:
```
https://valiz.myshopify.com/admin/settings/apps/develop
```

¡Prueba ir ahí directamente!
