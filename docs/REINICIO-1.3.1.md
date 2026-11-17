# Reinicio operativo autorizado — 1.3.1

Se conservan usuarios y contraseñas, vendedores, clientes y su tipo/ruta, productos y precios/códigos, rutas, grupos compartidos y configuración. Se borran cajas, ventas, pagos, abonos, cierres, documentos, entregas, movimientos de inventario, reservas de consecutivos y sincronizaciones. Inventarios quedan en cero; siguiente comprobante P-01. La bitácora de auditoría permanece e incluye el reinicio y la ubicación del respaldo.

## Ejecución

1. Publicar este backend y distribuir APK 1.3.1 (código 12). Detener todas las escrituras del servicio durante el reinicio; usar un contenedor de mantenimiento con la misma imagen y volumen.
2. Definir DATABASE_PATH al archivo existente y BACKUP_DIR al volumen persistente. `node src/reset-operations.js` solo muestra conteos y generación.
3. `node src/reset-operations.js --execute <generación revisada>` crea y verifica un respaldo consistente, revoca sesiones/equipos y ejecuta el borrado/restablecimiento en una transacción. Restaura los disparadores de inmutabilidad antes de confirmar y verifica claves foráneas. Ante error revierte todo. No repetir: una ejecución cambia la generación.
4. Verificar conteos, integridad y catálogos; iniciar servicio. Registrar nuevas entregas antes de vender.
5. Actualizar todas las terminales e iniciar sesión con internet. La nueva app verifica la generación antes de enviar pendientes, elimina registros/borradores/cola anteriores y registra el equipo nuevamente. Las versiones anteriores no pueden registrar un equipo después del reinicio. No es posible actualizar el contenido de una terminal desconectada hasta que se conecte y abra la versión nueva.

La operación no se ejecuta automáticamente al desplegar ni existe un endpoint público para borrar datos.

## Administrador

Los dispositivos muestran nombre, usuario y última conexión; los cierres usan nombre del responsable; los agrupados de ventas usan nombres y no UUID como sustitutos. La bitácora muestra acciones en español, incluyendo el reinicio. Los identificadores internos se conservan en relaciones y solicitudes.

## Validación

27 pruebas backend aprobadas, incluyendo respaldo, conservación de catálogos, cola Android, bloqueo de accesos antiguos y rollback completo ante error. TypeScript y flujo web de negocio aprobados; compilación Android y cinco pruebas nativas de impresión aprobadas. Instalación/lector/impresión física de esta versión pendientes de comprobar en Neotek real.

## Ejecución en producción

Ejecutado el 16 de noviembre de 2026, 21:37 Colombia (17 de noviembre 02:37 UTC), después del despliegue saludable `bre0qmxu7nhetzqghpipnu6u`, backend `b46de52`. Rama `deploy/backend-pos`. El cambio posterior `c49ee1c` afecta exclusivamente la presentación Android del identificador local.

- Respaldo previo al despliegue: `/data/backups/pos-2026-11-17T02-32-42.398Z.sqlite`, integridad ok.
- Respaldo inmediato con servicio detenido: `/data/backups/before-reset-2026-11-17T02-37-30.655Z.sqlite`, verificado por el script antes de borrar. Copia adicional fuera del volumen Docker: `/root/pos-reset-backups/before-reset-2026-11-17.sqlite` (mismo servidor; no reemplaza copia externa).
- Eliminados 9 cajas, 11 ventas, 9 pagos, 1 abono, 8 cierres, 19 documentos, 3 entregas y registros operativos relacionados.
- Verificación posterior: cajas/ventas/pagos/abonos/cierres/entregas en cero; inventario disponible cero; siguiente consecutivo 1. Permanecen 4 usuarios, 3 clientes, 10 productos y 2 rutas.
- `PRAGMA integrity_check = ok`, `PRAGMA foreign_key_check` vacío. Servicio reiniciado, `/health` 200 y generación nueva confirmada.
- APK `output/dok-pollo-mc-1.3.1-neotek.apk`, versión 1.3.1/código 12, mismo paquete y certificado. SHA256 `24383f403d55e89620a915d0039e81bb3927187b26526f7014ad6541bfce8d0f`.
- Sin dispositivos ADB conectados: actualización física de cada terminal e impresión/lector pendientes. Instalar APK mediante LocalSend, cerrar/abrir e iniciar sesión con internet; registrar nuevas entregas para habilitar ventas.

## Limpieza adicional solicitada

16 de noviembre, 21:43 Colombia: se eliminaron los 10 productos y las cuentas `Misael` y `Misael2026`. Se conservaron únicamente `admin` (administrador) y `Robin` (Robinson Rojas, vendedor), ambos activos, con sus contraseñas originales. Clientes y rutas se conservan. Ventas/cajas/abonos continúan en cero.

Respaldo verificado: `/data/backups/before-catalog-clean-2026-11-17T02-43-05.071Z.sqlite`. Limpieza mediante `cleanStartCatalog`, en transacción y con servicio detenido. Rechaza movimientos nuevos o inventario no vacío; conserva auditoría desligando la referencia a usuarios eliminados. Rotó la generación y revocó sesiones para renovar los catálogos en equipos con 1.3.1. Se verificaron integridad, relaciones y contraseñas sin exponerlas. 28 pruebas backend aprobadas.

No se generó otra APK: es un cambio de datos. Coolify actualiza la API; las pantallas nativas incluidas en una APK no se descargan al refrescar. Este proyecto aún no tiene distribución OTA de JavaScript configurada.

21:46 Colombia: por instrucción adicional se eliminó también `Robin` (Robinson Rojas), sus vendedores asociados y accesos. Queda únicamente `admin`, activo, sin cambiar contraseña. Sin movimientos nuevos. Respaldo verificado `/data/backups/before-remove-robin-2026-11-17T02-46-04.502Z.sqlite`; eliminación transaccional con claves foráneas comprobadas y auditoría conservada. No requirió otra APK.

21:59 Colombia: se eliminaron las rutas `La vega - Nocaima` y `Pacho`, sus asignaciones a usuarios/clientes y las filas de stock vacías. Sin movimientos nuevos. Quedan 0 rutas, 0 asignaciones, 0 productos, 0 ventas, 1 usuario y 3 clientes (sin ruta, deben asignarse antes de vender). Respaldo verificado `/data/backups/before-remove-routes-2026-11-17T02-59-36.785Z.sqlite`; transacción completada, claves foráneas sin errores e integridad ok. Sin cambio de APK.
