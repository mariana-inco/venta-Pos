# Ventas, pagos y cierre de ruta — DOK POLLO MC 1.3.0

Implementación en el proyecto existente y en el árbol de trabajo de `deploy/backend-pos`. Se mantuvieron Expo/React Native, Express/SQLite, estilos, roles y relaciones históricas. Se conservaron los cambios locales que ya estaban en curso (usuarios/rutas, cierre administrativo e impresión); no se descartaron ni se publicaron automáticamente. La captura de los cambios previos está en `tmp/route-payments-baseline/preexisting.patch`.

## Funcionamiento

- **Cliente fijo:** el servidor filtra y valida la pertenencia a la ruta, incluso para una venta realizada por un administrador. Al elegir vendedor y cliente se crea una venta iniciada en `/api/sale-drafts`, con cliente/ruta/vendedor/tipo y precios fijados. La confirmación debe usar su mismo identificador y no puede sustituirlos. El precio mayorista seleccionado se conserva aunque cambie el catálogo durante ese proceso; disponibilidad, estado activo y ruta se vuelven a validar. Para cambiar cliente hay que cancelar el proceso e iniciar otra venta.
- **Crédito:** abono inicial opcional, en efectivo o un medio electrónico configurado; el pago se guarda en `payments`, se refleja en el estado de cuenta y reduce el saldo. Sin abono no se crea un pago. No se duplica como otra venta ni como un recaudo posterior de cartera.
- **Electrónicos:** referencia obligatoria por transacción, incluido un abono inicial, una línea de VARIOS o un abono posterior. Clave única por medio configurado + referencia normalizada (NFKC, sin espacios, sin distinción entre mayúsculas/minúsculas). No se libera por anulaciones/reversiones: el historial sigue evitando reutilizarla. La misma referencia en otros medios sí se admite. La pantalla verifica las referencias de una venta antes de confirmar y el servidor vuelve a hacerlo transaccionalmente.
- **VARIOS:** varias líneas de importe y método; efectivo y todos los electrónicos activos, incluidos Nequi, Daviplata, Bancolombia y Bold. Se muestra total de factura, ingresado y falta/exceso. La suma debe ser exactamente igual a la factura, sin pagos cero, parciales ni excedentes; validación de UI y backend. Listados y reportes agregan pagos por venta para que una factura con varias líneas no se cuente varias veces.
- **Rutas:** listado, búsqueda, consulta y formulario de nombre, separado de inventarios. Crear/editar un cliente exige seleccionar una ruta activa; al editar se muestra la actual. Las nuevas asignaciones sustituyen su relación operativa anterior. Facturas y movimientos conservan su ruta histórica. Si un registro antiguo tiene varias rutas, el editor no elige una por suposición: el administrador debe seleccionarla al guardar.
- **Entregas:** cada entrega es una fotografía completa que reemplaza todo el stock de la ruta. Productos omitidos quedan en cero. Se valida primero toda la lista; el reemplazo, el registro de la entrega y los movimientos se guardan juntos. El retiro del sobrante anterior queda como ajuste negativo y la nueva entrega como asignación. Se conservan todas las entregas anteriores e idempotencia por referencia de solicitud. La antigua operación `inventory kind=assign` ya no suma stock; se usa el flujo de entrega completa. Los ajustes administrativos con motivo se mantienen.
- **Desactivados y grupos:** no se ofrecen productos inactivos en nuevas operaciones; los endpoints de entrega, venta y asociación también los rechazan. El grupo muestra sus productos activos; solo se pueden agregar productos activos sin grupo. Retirar un producto elimina únicamente su asociación actual, registra auditoría y lo deja libre para otro grupo. No elimina productos, ventas, movimientos ni saldos del grupo anterior, ni traslada stock por suposición. Una nueva entrega o cierre reinicia esos saldos según el flujo correspondiente.
- **Caja:** sigue siendo por usuario, con pagos, abonos, diferencias y cierre administrativo existentes. Las nuevas fotografías y vistas de cierre de caja no incluyen existencias. Los PDF originales de cierres históricos ya guardados no se reescriben.
- **Cierre de ruta:** módulo independiente para la ruta asignada al usuario. Solo pide confirmar/cancelar. Captura ruta, responsable, fecha, total vendido de la jornada (incluye crédito) y el inventario con entregas, ventas, ajustes y sobrantes. Guarda la fotografía inmutable y después pone en cero TODOS los grupos de stock de la ruta, incluso aquellos sin productos activos. Ambas operaciones son una sola transacción. Cierres duplicados, rutas ajenas y nuevas ventas en una jornada cerrada se rechazan. La jornada usa fecha de Colombia; al día siguiente una nueva entrega establece el nuevo stock. El administrador puede consultar todas las fotografías anteriores.

En grupos compartidos, el sobrante pertenece al grupo, no se reparte artificialmente entre presentaciones: el detalle de producto muestra su entrega/consumo y el saldo común claramente identificado. No se deben sumar esos sobrantes repetidos como si fueran inventarios separados. Si hubo varias entregas en el día, el historial y los ajustes de reemplazo explican el saldo final.

## Migración y compatibilidad

Nueva migración aditiva `server/src/route-payments-schema.sql`:

1. `sale_drafts`: permite comprobar en backend que el cliente, el vendedor, la ruta y los precios no se cambien entre inicio y confirmación. Es inmutable.
2. `payment_references`: relaciona una referencia real con el pago de venta o el abono posterior. Restricción única por medio/referencia y relación única con cada pago/abono. Es inmutable.

Se reutilizan `payments`, `collections`, `customer_routes`, `product_groups`, `route_stock`, `stock_movements`, `delivery_batches`, `delivery_items` y `daily_closures`. No se elimina ni reconstruye ninguna de esas tablas. Se importan las referencias reales que existan en `snapshot.payment_reference` de ventas anteriores; las referencias que nunca se capturaron no pueden deducirse ni se inventan. El resto de snapshots, IDs, importes y pagos originales permanece intacto.

Se agregan Bancolombia y Bold a los medios configurados solo si no existen; no se reactivan ni sobrescriben configuraciones existentes. Los cierres antiguos siguen conservando la fotografía y el comportamiento con que se emitieron; la migración no pone en cero retroactivamente el inventario de un cierre antiguo.

**Orden de publicación:** sincronizar operaciones anteriores, guardar copia consistente de SQLite y coordinar actualización del backend y de todas las terminales. Los APK antiguos no envían la venta iniciada, la ruta obligatoria del cliente ni las referencias requeridas por estas operaciones nuevas. No instalar este APK contra el backend anterior para operar. El puente de colas antiguas se conserva y no se borra información pendiente.

Esta entrega no cambió producción ni publicó un commit: el repositorio ya tenía cambios locales previos en estos módulos y se conservaron. Antes de publicar, revisar el conjunto integrado del árbol de trabajo; no descartar los módulos locales que necesita la compilación actual.

## Archivos y módulos

Backend:

- `server/src/sale-drafts.js`, `payments.js`, `route-operations.js`: inicio fijo, pagos/referencias y entregas/cierres transaccionales.
- `route-payments-schema.sql`, `db.js`: migración y preservación de referencias históricas conocidas.
- `service.js`, `validation.js`, `app.js`: validaciones, confirmación, pagos múltiples, filtros y listado sin duplicaciones.
- `commerce.js`, `business.js`: clientes/rutas, grupos, abonos, inventarios e historial.
- `pdf.js`, `statement-pdf.js`: detalle de pagos y referencias, abono inicial y cierre financiero sin existencias.

Web/Android:

- `mobile/src/SaleScreen.tsx`, `CatalogScreen.tsx`: cliente fijo, precios, pagos y ruta del cliente.
- `RoutesScreen.tsx`, `InventoryScreen.tsx`, `RouteClosureScreen.tsx`: flujos separados y confirmación de cierre.
- `OperationsScreen.tsx`, `ResultsScreen.tsx`, `HistoryScreen.tsx`, `Receipt.tsx`, `printing/receipt.js`: referencias, estado de cuenta y separación de caja/inventario.
- `App.tsx`, `HomeScreen.tsx`, `types.ts`, `mobile/app.json`: integración, navegación y versión 1.3.0 / versionCode 11.

Pruebas:

- `server/test/route-payments.test.js`: protocolo nuevo, solicitudes manipuladas, crédito, referencias entre medios, VARIOS, reemplazo, grupos, cierre/reinicio y rollback.
- `business-fixtures.js`, `api.test.js`, `business.test.js`, `commerce.test.js`, `settings.test.js`: adaptación de escenarios anteriores al nuevo protocolo, conservación de históricos y migración de referencias.
- `scripts/business-e2e.mjs`: recorrido real del frontend actualizado, conservando las pruebas locales previas de usuarios/rutas.

## Resultados

- `npm test`: **25 pruebas correctas**, incluidas referencias duplicadas disputadas por dos ventas concurrentes (201/409), dos cierres concurrentes (200/409), fallo simulado al reiniciar stock con rollback de fotografía y movimientos, y nueva entrega del día siguiente sin cambiar el cierre anterior.
- `npm run check`: TypeScript correcto.
- `npm run test:e2e`: correcto. Cliente mayorista fijo, búsqueda por código con Enter y nombre, crédito con abono inicial, referencia electrónica obligatoria, VARIOS bloqueado por faltante y aceptado al cuadrar, cartera/PDF y cierre de ruta con stock cero. Capturas en `output/screenshots/business`, 320/390/768/1280 px.
- Android `:app:assembleRelease`: correcto. ARM32/ARM64, minSdk 24, targetSdk 36, compileSdk 37; conserva applicationId y certificado. Las reglas R8 existentes siguen incluidas.
- `:pos-printer:testDebugUnitTest`: **5 pruebas nativas correctas**, sin fallos.
- PDF de estado de cuenta descargado por el recorrido real, extraído y revisado visualmente.
- APK: `output/dok-pollo-mc-1.3.0-neotek.apk`. Firma v2 verificada; SHA-256 `92606662cf766df208a939abf66a6aa882b1153c3d65c582a53f4c0e012bfa9d`.

Pendiente real: instalación y comprobación física de esta versión en Neotek (lector, pantalla táctil e impresión). ADB no encontró dispositivos conectados. La compilación y las pruebas compartidas de lógica no se presentan como evidencia de impresión física.
