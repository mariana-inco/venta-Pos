# Ventas Android sin internet — 1.3.5

Actualización sobre deploy/backend-pos. No reinicia la base ni borra ventas, clientes, productos, cajas, inventarios, históricos, cuentas, credenciales o colas existentes. Conserva applicationId com.ventapos.mobile y certificado de versiones anteriores. Instalar como Actualizar, sin desinstalar ni borrar almacenamiento.

## Uso

1. Con internet: iniciar sesión, tener caja abierta, ruta asignada, entrega disponible y vendedores/clientes configurados.
2. En Vender, antes de elegir cliente, pulsar **Preparar ventas sin internet**. Descarga catálogo, precios normales/mayoristas, clientes, vendedores, caja y consecutivos P-. Reserva exclusivamente la ruta para esa terminal/usuario; otro equipo no puede vender el mismo stock.
3. Sin internet: seleccionar vendedor/cliente, buscar o escanear, agregar cantidades, vender en efectivo o crédito (sin abono o con abono en efectivo). El cliente queda fijo. Guarda venta y evento atómicamente en SQLite; descuenta el grupo compartido local. Se conserva al cerrar y abrir Android. Compartir genera el recibo local con logo y número reservado.
4. Al volver internet, la cola se envía automáticamente en orden. Cada venta se valida y confirma transaccionalmente; el mismo evento reintentado recupera el resultado sin duplicar cobros, ventas, números ni descuentos.
5. Con conexión, sin venta en edición, pulsar **Sincronizar y finalizar modo sin internet**. Solo libera la reserva cuando la secuencia local coincide con la confirmada. Antes de cerrar caja/ruta, cambiar entregas, ajustar stock o cambiar asociaciones/clientes de ruta, finalizar este modo.

La reserva cubre la jornada de Colombia en que se preparó. Al día siguiente se pueden sincronizar ventas ya grabadas, pero para nuevas ventas se debe finalizar y preparar de nuevo. Sin vencimiento automático: nunca se libera stock silenciosamente mientras un equipo pueda tener ventas no enviadas. Si se pierde una terminal o se borra su almacenamiento, requiere conciliación; no liberar inventario a ciegas. El catálogo reserva bloques de consecutivos de 100; si se agotan, finalizar/preparar con conexión.

Los pagos electrónicos/VARIOS y su validación global de referencias continúan en el flujo conectado; finalizar el modo reservado para usarlos. Abonos de cartera, gastos, creación de clientes y cierres siguen requiriendo conexión. No se simula verificación electrónica offline. El saldo de un recibo local parte de la deuda conocida al preparar más sus nuevas ventas; cobros registrados en otro equipo durante la desconexión solo se conocen al reconectar. La web conserva el flujo conectado.

## Implementación

- `server/src/offline-route-schema.sql`, `db.js`: una tabla adicional de reservas y restricciones de seguridad. No se copian ni reescriben tablas históricas. Índices únicos impiden reservar la misma ruta o terminal simultáneamente.
- `server/src/offline-route.js`, `sync.js`: preparación/liberación autenticada por grant de dispositivo; evento `route.sale`; fecha/caja/cliente/vendedor/catálogo/consecutivo; cola secuencial e idempotencia existentes.
- `service.js`: reutiliza facturación, crédito, cartera, permisos, pagos y consumo de stock, con contexto offline interno (no parámetro aceptado por el endpoint normal). Mantiene precios y etiquetas reservadas; conserva fecha real de venta. Impide ventas/cierres conectados que ignoren la reserva.
- `route-operations.js`, `commerce.js`, `app.js`: bloqueos claros de entrega, ajuste, cierre y configuraciones afectadas mientras hay reserva. Se finaliza desde la terminal, nunca por timeout.
- `reset-operations.js`: compatibilidad del mantenimiento existente con nueva relación; no se ejecutó ningún reinicio.
- `mobile/src/offline/route-store.js`, `store.js`: SQLite durable, cliente fijo, precio por cliente, cantidades exactas, consumo por grupo, caja y cobros separados del crédito, recibo local, cola atómica.
- `runtime.native.ts`, `runtime.ts`: preparación/liberación, exclusión entre transición y nuevas operaciones, recuperación de sesión, sincronización y estado visible.
- `SaleScreen.tsx`, `api.ts`: botones de preparación/finalización, avisos de alcance y compartir comprobante local; conserva diseño y flujo habitual.
- `mobile/app.json`, `mobile/package.json`, `package-lock.json`: versión 1.3.5, versionCode 16.

## Verificación

- `npm test`: **36/36**. Nuevas pruebas en `server/test/offline-route.test.js`: SQLite real persistente y API HTTP, clientes normal/mayorista, efectivo/crédito con y sin abono, stock compartido, rechazo de exceso, reservas simultáneas, exclusión entre terminales, doble pulsación y respuesta perdida, precios históricos, intento manipulado, permisos, bloqueo de cambios, cambio de jornada, integridad y fallos inyectados con rollback de venta/pagos/stock/estado/secuencia.
- `npm run check`: TypeScript correcto.
- `npm run test:e2e`: recorridos existentes web correctos a 320/390/768/1280 px: vendedores, mayorista, escáner teclado, crédito, referencias, VARIOS, cartera/abonos, gastos, caja, PDF, resultados, cierre/reapertura. No atribuye a web operación offline nativa.
- Android assembleRelease ARM32/ARM64 correcto; verificación de firma e identificador. Misma firma SHA256 `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`.
- No hay terminal conectada por ADB: instalación, escáner físico e impresión de este APK pendientes de comprobar en Neotek real. No se crean ventas de prueba en producción.

## Actualización del servidor

Aplicar servidor antes del APK. Se realizó respaldo consistente y ensayo de la migración sobre una copia de producción: las **52 tablas previas** conservaron exactamente sus filas (SHA256); integrity_check ok y foreign_key_check sin errores. Copia: `/data/backups/before-offline-1.3.5-2026-11-23T20-50-07.064Z.sqlite`. En ese instante: 8 ventas, 28 clientes, 16 productos y 2 cajas. La operación comercial puede continuar y aumentar esos conteos; no se usan como objetivos de limpieza.
