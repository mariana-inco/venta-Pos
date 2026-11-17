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
