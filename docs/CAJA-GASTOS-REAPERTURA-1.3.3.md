# Caja, gastos y reapertura de rutas — 1.3.3

Rama: `deploy/backend-pos`. Android: versión 1.3.3, versionCode 14, `com.ventapos.mobile` y certificado anterior conservados.

## Funcionalidad

- **Cierre de ruta**: administrador ve **Abrir ruta** cuando su ruta está cerrada. También puede abrir una ruta cerrada de hoy seleccionando su cierre en el historial. Vendedores conservan el cierre, sin permiso de reapertura. La reapertura restaura una sola vez el stock inicial y sobrante exactos del cierre; conserva el original y agrega movimiento compensatorio y auditoría. Bloquea jornadas anteriores, rutas inactivas y cambios de inventario posteriores al cierre. Permite volver a cerrar y abrir hoy, conservando cada fotografía. No cambia ventas ni cajas.
- **Más → Gastos**: descripción y valor; fecha/hora, responsable, ruta y caja automáticos. Efectivo únicamente; solo la caja propia abierta admite altas. Administrador consulta también otras cajas y el historial. Reintentos de una misma referencia no duplican gastos; cambios de importe con referencia usada se rechazan. El servidor bloquea gastos superiores al efectivo disponible y serializa registros y cierres.
- **Caja**: efectivo esperado = base + cobros en efectivo de ventas + abonos en efectivo − gastos. Electrónicos, crédito y total vendido conservan su definición. Conciliación y documento incluyen clientes que abonaron (abonos a cartera), quién recibió, medio/fecha y desglose de gastos. Los abonos iniciales de una venta a crédito siguen incluidos en cobros de ventas; no se vuelven a sumar como abonos a cartera. El cierre guarda los detalles, sin consultas posteriores que cambien nombres o cifras históricas. La revisión detecta nuevos abonos/gastos antes de confirmar.
- **Comprobantes**: se retiraron Imprimir/Reimprimir de venta, vista previa y cierre. Permanecen Compartir y PDF; ambos usan el PDF térmico almacenado. Cualquier llamada antigua a la acción print se redirige a compartir; ya no selecciona el controlador de texto de la impresora. Configuración/prueba del hardware existente se conserva.

## Datos y compatibilidad

Migración automática, sin borrado de datos comerciales:

1. `cash_expenses`: libro inmutable de gastos, FK a caja, usuario y ruta; referencia única por usuario.
2. `route_reopenings`: libro inmutable de reaperturas, FK al cierre original, usuario y referencia única.
3. `daily_closures`: se sustituye únicamente la restricción UNIQUE(ruta,día) por un índice normal, copiando filas/fotografías y restaurando protecciones de inmutabilidad en una transacción. Cada cierre mantiene su ID y snapshot. El bloqueo activo se determina por cierres sin reapertura; operaciones serializadas evitan dos cierres activos.

Cierres/documentos anteriores no se regeneran ni inventan detalles ausentes. No cambia la generación de datos ni se borran colas. Gastos y reaperturas requieren conexión para validar con el backend. Los APK anteriores conservan sus pantallas; para los botones y Gastos se instala esta actualización. Coolify por sí solo no actualiza el código instalado en Android.

## Archivos y módulos

- Datos/backend: `server/src/{db.js,business-schema.sql,cash-route-schema.sql,route-state.js,cash-expenses.js,route-operations.js,business.js,service.js,app.js,validation.js,admin-close.js,reset-operations.js,pdf.js}`.
- Aplicación: `mobile/App.tsx`, `mobile/src/{ExpensesScreen.tsx,CashMovements.tsx,CashScreen.tsx,RouteClosureScreen.tsx,HistoryScreen.tsx,MenuScreen.tsx,ResultsScreen.tsx,SaleScreen.tsx,types.ts,api.ts,printing/receipt.js}`.
- Versión: `mobile/{app.json,package.json}`, `package-lock.json`.
- Verificación: `server/test/cash-route.test.js`, `scripts/business-e2e.mjs`.

## Verificación

- `npm test`: 32 pruebas aprobadas. Incluye migración repetible con snapshots conservados, permisos, reapertura simultánea, ciclos de reapertura, stock exacto, rollback por fallo y bloqueo tras ajustes, gastos simultáneos/duplicados/ajenos/sin efectivo, cierre con gastos y abonos por cliente e inmutabilidad de PDF/detalles.
- `npm run check`: TypeScript aprobado.
- `npm run test:e2e`: aprobado en 320/390/768/1280 px; alta/consulta de gastos, conciliación con cliente y gasto, cierre y reapertura en interfaz, compartir presente e impresión directa ausente; además flujos anteriores de ventas, crédito, VARIOS, escáner teclado, usuarios y entregas.
- Android `assembleRelease` aprobado; comprobaciones del módulo nativo sin cambios (5 pruebas en estado actualizado, sin errores).
- PDF de cierre: 58 mm, una página, altura dinámica, render inspeccionado y contenido verificado.
- Preflight de migración sobre copia consistente de producción: las 50 tablas y sus registros anteriores idénticos por SHA256 del contenido; integridad y relaciones válidas. Respaldo `/data/backups/before-1.3.3-2026-11-17T23-51-15.795Z.sqlite`. 23 clientes conservados en esa copia.
- Pendiente real: no hay Neotek conectada por ADB. No se ha verificado instalación ni impresión física de esta versión. Se mantiene el flujo Compartir que el usuario reportó correcto.

## Artefactos y actualización

- `output/dok-pollo-mc-1.3.3-neotek.apk`: ARM32/ARM64, minSdk24, target36; firma v2 verificada, certificado SHA256 `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`.
- APK SHA256: `65b321c42dfec659ebf193262eb2829927787e71e42ff85d13cad7549a44abea`.
- Ejemplo ficticio: `output/pdf/cierre-gastos-abonos-58mm.pdf`.

Desplegar backend de esta rama primero. Mantener el volumen `/data`, ejecutar respaldo consistente y comprobar `/health`/migración. Transferir APK por LocalSend y elegir **Actualizar**, sin desinstalar ni borrar datos. Iniciar sesión con conexión y comprobar Gastos, reapertura y Compartir en la terminal.

## Despliegue confirmado

- Coolify: deployment `a8arkddy3bbictfpxejneyqs`, commit `75b7317443aecaac85244d7120455954f0de3f93`, rama `deploy/backend-pos`; rolling update completado 17/11/2026 18:54:29 Colombia.
- Contenedor `0sxtn0nojcnijnl1dxn7rmev-20261117T235348`, healthy; `/health` HTTP200.
- Comprobación autenticada de solo lectura: rutas/cierres/cajas y nuevo listado de gastos HTTP200; sesión diagnóstica temporal eliminada al terminar. Integridad OK, cero relaciones inválidas. Datos consultados: 23 clientes, 3 usuarios, 6 productos, 2 rutas, una caja y un cierre de ruta histórico; no se crearon operaciones de prueba en producción.
