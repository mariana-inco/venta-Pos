# Despliegue: Coolify, Railway y cliente web

## Instancia de Coolify Dromos

Publicada el 28 de octubre de 2026 en **Stanley → production → backend-pos**.

- API: `https://backend-pos.dromos.co`; comprobación pública: `/health`.
- Recurso Coolify: `0sxtn0nojcnijnl1dxn7rmev`, servidor `localhost`.
- Repositorio: `mariana-inco/venta-Pos`, rama `deploy/backend-pos`. Despliegue manual desde Coolify, con Dockerfile `/server/Dockerfile` y directorio base `/server`.
- Puerto interno `4317`, sin mapeo adicional de puertos al host. HTTPS y redirección HTTP gestionados por el proxy; Cloudflare tiene el registro A proxied de `backend-pos` al servidor existente.
- Volumen Docker `0sxtn0nojcnijnl1dxn7rmev-backend-pos-data` montado en `/data`. Base `/data/pos.sqlite`, respaldos `/data/backups`, una sola instancia.
- Variables: `NODE_ENV=production`, `HOST=0.0.0.0`, `PORT=4317`, `DATABASE_PATH=/data/pos.sqlite`, `BACKUP_DIR=/data/backups`, `TRUST_PROXY=1`.
- CORS permite `http://localhost:8097,http://127.0.0.1:8097`. Al publicar una web, añadir su origen exacto. Android nativo no necesita un origen CORS.
- Se trasladó únicamente el administrador local `admin`, conservando identidad y hash de contraseña; no se copiaron sesiones de acceso. La instalación local no tenía productos, clientes, cajas ni ventas. Respaldo inicial: `/data/backups/initial-admin.sqlite`.

Para una copia consistente, ejecutar `node src/backup.js` en la terminal del recurso y descargar el archivo fuera del servidor. El respaldo inicial está en el mismo volumen: no sustituye una política de copias externas. Antes de actualizar, respaldar y comprobar que el despliegue conserva exactamente este volumen.

Para conectar el cliente, configurar `EXPO_PUBLIC_API_URL=https://backend-pos.dromos.co` antes de iniciar Expo o generar el APK. `output/dannys-pos-cloud.apk` es la compilación ARM64 de prueba con esta URL y firma de desarrollo; no requiere USB ni permite HTTP sin cifrar. El cambio de URL crea una base SQLite local distinta: sincronizar cualquier pendiente del servidor anterior antes de cambiar de APK.

La web local y el servidor de desarrollo conservan su configuración anterior hasta cambiar explícitamente la URL del cliente. Este despliegue publica la API, no una web.

## Otros proveedores

La API usa SQLite en un archivo y debe correr como **un solo servidor permanente con disco persistente**. Vercel no sirve para la API (disco de solo lectura y funciones efímeras: da `500 FUNCTION_INVOCATION_FAILED` y perdería las ventas). Vercel solo publica las pantallas web.

## Servicio independiente

Desde `server/`: `npm ci --omit=dev`, configura variables y ejecuta `npm start`. No requiere archivos de `mobile/`. El lockfile propio permite desplegar solo esta carpeta. `npm start` toma las variables del entorno del proveedor; para cargar `.env` local usa `npm run dev`.

Alternativa portable: `docker build -t dannys-pos-api ./server` y ejecuta la imagen con un volumen persistente en `/data`, `HOST=0.0.0.0`, `DATABASE_PATH=/data/pos.sqlite` y el puerto expuesto. El proceso usa UID 1000 (`node`): el volumen debe ser escribible por ese usuario. El healthcheck consulta `/health`. Conserva una sola réplica por base; para múltiples réplicas del backend se necesita migrar la persistencia central. Esto no limita el número de celulares sincronizando con esa réplica.

Despliega primero esta API y luego los APK con su URL HTTPS. Las tablas e índices nuevos se migran al abrir la base y conservan las ventas anteriores. Haz un respaldo consistente antes de actualizar.

## 1. API en Railway

1. En Railway: **New Project → Deploy from GitHub repo** y elige este repositorio y la rama a publicar.
2. En el servicio → **Settings**:
   - **Root Directory:** `/server`
   - **Config file path:** `/server/railway.json` (comando de inicio, health check `/health` y reinicio automático).
   - **Networking → Generate Domain**: anota la URL, por ejemplo `https://danys-pos-api.up.railway.app`.
   - **Replicas: 1**. No escales a más réplicas: SQLite exige un único servidor.
3. **Volume**: clic derecho en el servicio → *Attach Volume*, punto de montaje `/data`.
4. **Variables**:

   | Variable | Valor |
   |---|---|
   | `HOST` | `0.0.0.0` |
   | `DATABASE_PATH` | `/data/pos.sqlite` |
   | `BACKUP_DIR` | `/data/backups` |
   | `TRUST_PROXY` | `1` |
   | `CORS_ORIGINS` | URL de Vercel, p. ej. `https://danys-pos.vercel.app` (varias separadas por coma, sin `/` final) |

   `PORT` lo asigna Railway. Node 24 se toma de `engines` en `server/package.json`.
5. Despliega y abre `https://<tu-api>/health`: debe responder `{"ok":true}`.
6. Crea el primer administrador una sola vez, dentro del servidor (instala la CLI con `npm i -g @railway/cli`):

   ```sh
   railway login
   railway link          # elige el proyecto y el servicio de la API
   railway ssh
   npm run setup-admin   # dentro del contenedor; pide usuario, nombre y contraseña
   ```

## 2. Web en Vercel

1. En el proyecto de Vercel → **Settings → General**: **Root Directory vacío** (raíz del repositorio). `vercel.json` ya define instalación, build (`npm run export:web -w mobile`) y salida (`mobile/dist`), sin funciones de servidor.
2. **Settings → Environment Variables**: `EXPO_PUBLIC_API_URL` = URL de Railway (sin `/` final), para Production.
3. **Node.js Version**: 24.x.
4. **Redeploy** (la URL de la API se incorpora al compilar; si la cambias, vuelve a desplegar).
5. Si cambia el dominio de Vercel, actualiza `CORS_ORIGINS` en Railway. Las URL de *preview* tienen otro dominio y serán rechazadas salvo que las agregues.

## 3. Copias de seguridad

Con `railway ssh`, ejecuta `npm run backup`: crea una copia consistente en `/data/backups`. Descárgala periódicamente fuera de Railway. Railway también permite respaldos del volumen desde su panel.

## 4. App Android

Para el APK, configura `EXPO_PUBLIC_API_URL` con la URL HTTPS de Railway antes de `eas build` (ver README).

Para sincronización e impresión Android, consulta [OFFLINE.md](OFFLINE.md). No uses el disco efímero del contenedor para ventas, catálogos históricos o cola de recepción.
