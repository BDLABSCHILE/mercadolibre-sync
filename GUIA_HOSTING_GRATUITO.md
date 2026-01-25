# 🚀 Guía: Hosting Gratuito 24/7 para Webhooks

Esta guía te ayudará a desplegar tu servidor de webhooks de forma gratuita y mantenerlo online 24/7 sin necesidad de tener tu PC encendida.

---

## 📊 Comparación de Opciones Gratuitas

| Plataforma | Tier Gratuito | Timeout | Cold Start | Mejor Para |
|------------|---------------|---------|------------|------------|
| **Render** | ✅ 750 horas/mes | 15 min inactivo | No | ⭐ **RECOMENDADO** |
| **Railway** | ✅ $5 crédito/mes | Sin timeout | No | ⭐ **RECOMENDADO** |
| **Fly.io** | ✅ 3 VMs pequeñas | Sin timeout | No | Producción |
| **Vercel** | ✅ Ilimitado | 10s (serverless) | Sí | Serverless |
| **Oracle Cloud** | ✅ Siempre free | Sin timeout | No | VPS completo |

---

## 🥇 OPCIÓN 1: Render (RECOMENDADO - Más Fácil)

**Ventajas:**
- ✅ 750 horas gratis/mes (suficiente para 24/7)
- ✅ Deploy automático desde GitHub
- ✅ HTTPS automático
- ✅ Muy fácil de configurar
- ✅ Sin tarjeta de crédito requerida

**Desventajas:**
- ⚠️ Se "duerme" después de 15 minutos sin actividad (pero se despierta automáticamente)
- ⚠️ Primera respuesta puede tardar 30-60 segundos si está dormido

### Pasos para Deploy en Render

#### 1. Preparar el Repositorio

Asegúrate de tener estos archivos en tu repo:

```bash
mercadolibre-sync/
├── webhook-server.js
├── package.json
├── .env.example
└── Procfile  # ← Crear este archivo
```

#### 2. Crear `Procfile`

Crea un archivo `Procfile` en la raíz de `mercadolibre-sync/`:

```procfile
web: node webhook-server.js
```

#### 3. Subir a GitHub

```bash
cd mercadolibre-sync
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/tu-usuario/tu-repo.git
git push -u origin main
```

#### 4. Crear Cuenta en Render

1. Ve a [render.com](https://render.com)
2. Crea cuenta con GitHub
3. Click en "New +" → "Web Service"

#### 5. Configurar el Servicio

- **Name:** `mercadolibre-sync` (o el nombre que quieras)
- **Repository:** Selecciona tu repo de GitHub
- **Root Directory:** `mercadolibre-sync` (si el repo está en la raíz del proyecto)
- **Environment:** `Node`
- **Build Command:** `npm install`
- **Start Command:** `node webhook-server.js`
- **Plan:** `Free`

#### 6. Configurar Variables de Entorno

En Render, ve a "Environment" y agrega todas las variables de `.env`:

```
SHOPIFY_STORE_URL=tu-tienda.myshopify.com
SHOPIFY_ACCESS_TOKEN=SHOPIFY_ACCESS_TOKEN_AQUI
SHOPIFY_LOCATION_ID=SHOPIFY_LOCATION_ID_AQUI
MELI_APP_ID=MELI_APP_ID_AQUI
MELI_CLIENT_SECRET=MELI_CLIENT_SECRET_AQUI
MELI_REFRESH_TOKEN=MELI_REFRESH_TOKEN_AQUI
MELI_USER_ID=MELI_USER_ID_AQUI
STOCK_OFFSET=1
PORT=10000
```

**⚠️ IMPORTANTE:** Render usa el puerto desde `PORT`, no necesitas cambiarlo en el código.

#### 7. Obtener URL Pública

Una vez deployado, Render te dará una URL como:
```
https://mercadolibre-sync.onrender.com
```

#### 8. Configurar Webhooks

**Shopify:**
- Settings → Notifications → Webhooks
- URL: `https://mercadolibre-sync.onrender.com/webhook/inventory`
- Event: `Inventory levels update`

**MercadoLibre:**
- [developers.mercadolibre.com.ar](https://developers.mercadolibre.com.ar)
- URL: `https://mercadolibre-sync.onrender.com/webhooks/mercadolibre/order`
- Topic: `orders_v2`

#### 9. Mantener Despierto (Opcional)

Para evitar que se duerma, puedes usar un servicio de ping gratuito:

1. **UptimeRobot** (gratis): [uptimerobot.com](https://uptimerobot.com)
   - Crea un monitor HTTP
   - URL: `https://mercadolibre-sync.onrender.com/health`
   - Intervalo: 5 minutos

2. **Cron-Job.org** (gratis): [cron-job.org](https://cron-job.org)
   - Crea un cron job
   - URL: `https://mercadolibre-sync.onrender.com/health`
   - Frecuencia: Cada 5 minutos

---

## 🥈 OPCIÓN 2: Railway (RECOMENDADO - Sin Sleep)

**Ventajas:**
- ✅ $5 crédito gratis/mes (suficiente para un servicio pequeño)
- ✅ NO se duerme (siempre activo)
- ✅ Deploy automático desde GitHub
- ✅ HTTPS automático
- ✅ Muy fácil de usar

**Desventajas:**
- ⚠️ Requiere tarjeta de crédito (pero no se cobra si no excedes el crédito)
- ⚠️ Si excedes $5/mes, se cobra automáticamente

### Pasos para Deploy en Railway

#### 1. Crear Cuenta

1. Ve a [railway.app](https://railway.app)
2. Crea cuenta con GitHub
3. Agrega tarjeta de crédito (no se cobra si no excedes el crédito)

#### 2. Crear Proyecto

1. Click en "New Project"
2. Selecciona "Deploy from GitHub repo"
3. Selecciona tu repositorio

#### 3. Configurar Variables de Entorno

1. Click en tu servicio
2. Ve a "Variables"
3. Agrega todas las variables de `.env`

#### 4. Configurar Start Command

1. Ve a "Settings"
2. En "Start Command" pon: `node webhook-server.js`
3. En "Root Directory" pon: `mercadolibre-sync` (si aplica)

#### 5. Obtener URL

Railway te dará una URL automáticamente. Puedes configurar un dominio personalizado si quieres.

---

## 🥉 OPCIÓN 3: Fly.io (Para Producción)

**Ventajas:**
- ✅ 3 VMs pequeñas gratis
- ✅ NO se duerme
- ✅ Muy rápido
- ✅ Escalable

**Desventajas:**
- ⚠️ Requiere más configuración
- ⚠️ CLI necesario

### Pasos para Deploy en Fly.io

#### 1. Instalar CLI

```bash
# macOS
brew install flyctl

# Linux/Windows
curl -L https://fly.io/install.sh | sh
```

#### 2. Login

```bash
flyctl auth login
```

#### 3. Crear App

```bash
cd mercadolibre-sync
flyctl launch
```

#### 4. Crear `fly.toml`

Crea un archivo `fly.toml`:

```toml
app = "mercadolibre-sync"
primary_region = "scl"  # Santiago, Chile (o el más cercano)

[build]

[env]
  PORT = "8080"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = false
  auto_start_machines = true
  min_machines_running = 1

[[vm]]
  cpu_kind = "shared"
  cpus = 1
  memory_mb = 256
```

#### 5. Configurar Secrets

```bash
flyctl secrets set SHOPIFY_STORE_URL=tu-tienda.myshopify.com
flyctl secrets set SHOPIFY_ACCESS_TOKEN=SHOPIFY_ACCESS_TOKEN_AQUI
# ... etc para todas las variables
```

#### 6. Deploy

```bash
flyctl deploy
```

---

## 🔧 Adaptaciones Necesarias para Hosting

### 1. Ajustar Puerto Dinámico

Tu código ya está bien, pero asegúrate de que use `process.env.PORT`:

```javascript
// webhook-server.js (ya está así)
const PORT = process.env.PORT || 3000;
```

### 2. Crear Archivo `.gitignore`

Asegúrate de que `.gitignore` incluya:

```gitignore
node_modules/
.env
*.log
.DS_Store
.meli-refreshed-items.json
.meli-processed-orders.json
```

### 3. Archivo `Procfile` (para Render)

```procfile
web: node webhook-server.js
```

### 4. Verificar Rutas de Archivos

Los archivos de persistencia (`.meli-processed-orders.json`) funcionarán en hosting, pero considera usar base de datos para producción.

---

## 🆓 OPCIÓN 4: Oracle Cloud (VPS Completo - Avanzado)

**Ventajas:**
- ✅ Siempre gratis (nunca expira)
- ✅ VPS completo (puedes instalar lo que quieras)
- ✅ 2 VMs pequeñas gratis
- ✅ NO se duerme

**Desventajas:**
- ⚠️ Requiere más conocimiento técnico
- ⚠️ Debes configurar todo manualmente

### Pasos para Oracle Cloud

#### 1. Crear Cuenta

1. Ve a [cloud.oracle.com](https://cloud.oracle.com)
2. Crea cuenta (requiere tarjeta pero no se cobra en tier free)

#### 2. Crear Instancia

1. Compute → Instances → Create Instance
2. Selecciona "Always Free Eligible"
3. Imagen: Ubuntu 22.04
4. Shape: VM.Standard.A1.Flex (4 OCPU, 24GB RAM - gratis)

#### 3. Configurar Instancia

```bash
# SSH a tu instancia
ssh ubuntu@tu-ip-publica

# Instalar Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Instalar PM2 (para mantener el proceso corriendo)
sudo npm install -g pm2

# Clonar tu repo
git clone https://github.com/tu-usuario/tu-repo.git
cd tu-repo/mercadolibre-sync

# Instalar dependencias
npm install

# Configurar .env
nano .env  # Agregar todas las variables

# Iniciar con PM2
pm2 start webhook-server.js --name mercadolibre-sync
pm2 save
pm2 startup  # Para iniciar automáticamente al reiniciar
```

#### 4. Configurar Firewall

En Oracle Cloud Console:
1. Networking → Virtual Cloud Networks
2. Security Lists → Ingress Rules
3. Agregar regla: TCP, Port 3000 (o el que uses), Source: 0.0.0.0/0

#### 5. Configurar Nginx (Opcional - para HTTPS)

```bash
sudo apt install nginx certbot python3-certbot-nginx

# Configurar Nginx
sudo nano /etc/nginx/sites-available/mercadolibre-sync

# Contenido:
server {
    listen 80;
    server_name tu-dominio.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}

# Habilitar
sudo ln -s /etc/nginx/sites-available/mercadolibre-sync /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx

# HTTPS con Let's Encrypt
sudo certbot --nginx -d tu-dominio.com
```

---

## 🔍 Monitoreo Básico Gratuito

### 1. UptimeRobot (Gratis)

- [uptimerobot.com](https://uptimerobot.com)
- 50 monitores gratis
- Alertas por email/SMS
- Ping cada 5 minutos

**Configuración:**
- Monitor Type: HTTP(s)
- URL: `https://tu-servicio.onrender.com/health`
- Interval: 5 minutes

### 2. Health Checks Endpoint

Tu código ya tiene un endpoint `/health`. Asegúrate de que funcione:

```javascript
// Ya está en webhook-server.js:406
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    processed_orders_count: processedOrders.size,
    is_syncing_from_meli: isSyncingFromMeli
  });
});
```

---

## ⚠️ Consideraciones Importantes

### 1. Cold Start (Render)

Si usas Render y el servicio se duerme:
- Primera petición puede tardar 30-60 segundos
- Shopify/MercadoLibre pueden timeout si esperan respuesta
- **Solución:** Usar UptimeRobot para mantener despierto

### 2. Persistencia de Archivos

Los archivos `.meli-processed-orders.json` se guardan en el filesystem:
- ✅ Funciona en Render/Railway/Fly.io
- ⚠️ Se pierden si el servicio se reinicia (pero se recarga al iniciar)
- 💡 **Recomendación:** Para producción, usar base de datos

### 3. Logs

- Render: Logs disponibles en dashboard
- Railway: Logs en tiempo real
- Fly.io: `flyctl logs`

### 4. Variables de Entorno Sensibles

- ✅ NUNCA subas `.env` a GitHub
- ✅ Usa variables de entorno del hosting
- ✅ Considera usar secretos encriptados

---

## 📋 Checklist de Deploy

- [ ] Código subido a GitHub
- [ ] `.env` agregado a `.gitignore`
- [ ] `Procfile` creado (si usas Render)
- [ ] Variables de entorno configuradas en hosting
- [ ] Servicio deployado y funcionando
- [ ] URL pública obtenida
- [ ] Webhooks configurados en Shopify y MercadoLibre
- [ ] Health check configurado (UptimeRobot)
- [ ] Probar webhook manualmente
- [ ] Verificar logs

---

## 🎯 Recomendación Final

**Para empezar rápido:** **Render**
- Más fácil de configurar
- 750 horas/mes gratis
- Deploy automático desde GitHub

**Para producción:** **Railway** o **Fly.io**
- No se duerme
- Más confiable
- Mejor performance

**Para máximo control:** **Oracle Cloud**
- VPS completo gratis
- Control total
- Requiere más conocimiento

---

## 🆘 Troubleshooting

### El servicio se duerme (Render)

**Solución:** Configurar UptimeRobot para ping cada 5 minutos al endpoint `/health`

### Webhooks no llegan

**Verificar:**
1. URL pública es accesible
2. Webhooks configurados correctamente
3. Logs del servicio para ver errores
4. Firewall no bloquea peticiones

### Error: "Cannot find module"

**Solución:** Asegúrate de que `package.json` tenga todas las dependencias y que el build command sea `npm install`

### Variables de entorno no funcionan

**Solución:** Verifica que las variables estén configuradas en el dashboard del hosting, no en `.env` (que no se sube a GitHub)

---

## 📚 Recursos Adicionales

- [Render Docs](https://render.com/docs)
- [Railway Docs](https://docs.railway.app)
- [Fly.io Docs](https://fly.io/docs)
- [Oracle Cloud Free Tier](https://www.oracle.com/cloud/free/)

---

**¡Listo! Tu servidor estará online 24/7 de forma gratuita.** 🚀
