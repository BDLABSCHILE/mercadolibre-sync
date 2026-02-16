# Pasos para que Render use el código actualizado (a prueba de tontos)

## Qué vamos a hacer

1. Asegurarnos de que los cambios están guardados en tu carpeta.
2. Subir esos cambios a GitHub (o GitLab) con Git.
3. Hacer que Render vuelva a desplegar con ese código (o configurar la variable de entorno).

---

## Parte A: Subir el código a GitHub

### Paso 1: Abrir la terminal

- En Mac: abre **Terminal** (o la terminal integrada de Cursor/VS Code).
- Navega a la carpeta del proyecto. Por ejemplo:
  ```bash
  cd /Users/benja/shopify-theme/valiz-theme
  ```
  (Si tu proyecto está en otra ruta, usa esa.)

### Paso 2: Ver si hay cambios sin subir

Ejecuta:

```bash
cd mercadolibre-sync
git status
```

- Si ves archivos en rojo o "modified" (por ejemplo `check-pending-orders.js`), hay cambios que aún no están en Git.

### Paso 3: Añadir y guardar los cambios en Git

```bash
git add .
git commit -m "Fix: usar order.id en check-pending-orders y filtrar órdenes antiguas"
```

- Si te pide configurar nombre/email la primera vez:
  ```bash
  git config user.email "tu@email.com"
  git config user.name "Tu Nombre"
  ```
  Luego repite el `git add` y `git commit`.

### Paso 4: Subir a GitHub

```bash
git push origin main
```

- Si tu rama se llama `master` en vez de `main`:
  ```bash
  git push origin master
  ```
- Si te pide usuario/contraseña: usa tu usuario de GitHub y un **Personal Access Token** (no la contraseña normal). Crear token: GitHub → Settings → Developer settings → Personal access tokens → Generate new token.

Si no tienes repositorio en GitHub todavía:

1. Entra a [github.com](https://github.com), Iniciar sesión.
2. Clic en **+** (arriba derecha) → **New repository**.
3. Nombre ej: `mercadolibre-sync`, público, **Create repository**.
4. En la terminal (dentro de `mercadolibre-sync`):
   ```bash
   git remote add origin https://github.com/TU-USUARIO/mercadolibre-sync.git
   git branch -M main
   git push -u origin main
   ```
   (Reemplaza `TU-USUARIO` por tu usuario de GitHub.)

---

## Parte B: Conectar Render con GitHub y desplegar

### Paso 5: Entrar a Render

1. Abre [render.com](https://render.com) e inicia sesión.
2. En el **Dashboard**, haz clic en tu **servicio** (el que corre el webhook, seguramente "webhook-server" o similar).

### Paso 6: Decirle a Render de dónde sacar el código

1. En el menú del servicio, entra a **Settings** (o **Configuración**).
2. Busca la sección **Build & Deploy** o **Repository**.
3. Ahí debe aparecer conectado un repo de GitHub (ej: `tu-usuario/mercadolibre-sync`).
   - Si **no** está conectado: **Connect account** / **Connect repository** y elige el repo y la rama (ej: `main`).
   - Si **sí** está conectado: con el `git push` del Paso 4, Render suele hacer **deploy automático**. Si no, sigue al Paso 7.

### Paso 7: Forzar un deploy (por si no se actualizó solo)

1. En la página del servicio en Render, busca el botón **Manual Deploy** o **Deploy**.
2. Clic en **Deploy latest commit** (o **Clear build cache & deploy** si quieres estar seguros).
3. Espera a que el deploy termine (estado "Live" o "Succeeded" en verde).

Cuando termine, Render ya está usando el código nuevo (con el fix de `order.id`).

---

## Parte C: Opcional – Que no procese órdenes antiguas

Para que el job de “órdenes pendientes” no toque ninguna orden (ni siquiera de la última hora):

1. En Render, en tu servicio → **Environment** (o **Environment Variables**).
2. Clic en **Add Environment Variable**.
3. **Key:** `PENDING_ORDERS_LAST_HOURS`  
   **Value:** `0`
4. Guardar. Render puede reiniciar solo; si no, en **Manual Deploy** vuelve a desplegar una vez.

Con eso, aunque el job corra al arrancar, no procesará ninguna orden.

---

## Parte D: Opcional – Idempotencia en archivo (evitar reprocesar la misma orden en cada deploy)

Si ves que la misma orden de MercadoLibre (ej. B-G-MOKA) se procesa otra vez en cada deploy, es porque la idempotencia por defecto es en memoria y se pierde al reiniciar. Para que persista:

1. En Render → **Environment**.
2. **Key:** `IDEMPOTENCY_STORE`  
   **Value:** `file`
3. (Opcional) **Key:** `IDEMPOTENCY_FILE_DIR`  
   **Value:** deja vacío para usar el directorio de trabajo del servicio.

Así el webhook y el job de órdenes pendientes comparten el mismo archivo (`idempotency-mercadolibre.json`) y las órdenes ya procesadas no se vuelven a tocar tras un reinicio.

---

## Resumen rápido

| Paso | Dónde        | Qué hacer |
|------|--------------|-----------|
| 1–4  | Tu compu (terminal) | `cd mercadolibre-sync` → `git add .` → `git commit -m "Fix order id"` → `git push origin main` |
| 5–7  | Render       | Entrar al servicio → comprobar repo conectado → **Manual Deploy** si hace falta |
| C    | Render → Environment | Añadir `PENDING_ORDERS_LAST_HOURS` = `0` (opcional) |

Cuando el deploy esté en verde, la próxima vez que arranque el servidor ya no deberías ver `Procesando orden [object Object]` con 400; y cuando caiga una venta en MercadoLibre, el webhook (mensaje "Venta recibida en MercadoLibre: Order ID = ...") será el que actualice Shopify.
