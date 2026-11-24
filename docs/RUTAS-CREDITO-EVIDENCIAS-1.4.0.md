# Rutas por apertura, crédito y evidencias — 1.4.0

Se mantiene Expo/React Native (Android y web), Express y SQLite. Rama `deploy/backend-pos`; mismo paquete Android, firma, datos y diseño. No se ejecutan reinicios ni eliminaciones masivas. Las correcciones anteriores de producción se conservan.

## Funcionalidades

### Aperturas, entregas y cierres

- Apertura administrativa de cualquier ruta activa, sin nombres fijos; varias rutas abiertas a la vez. Fecha/hora ISO UTC, visualización y filtros diarios Colombia. Referencia idempotente y transacción impiden aperturas repetidas.
- Cada apertura tiene un UUID interno; las relaciones de entrega, movimiento, borrador y venta se guardan en `route_operation_links`. No se cambia la forma de las tablas históricas.
- Una entrega agrega únicamente productos que no tengan entrega positiva en esa apertura. Una fila de stock cero no marca un producto como entregado. Se suman existencias por grupo compartido sin tocar otros productos. Reintento de la misma entrega no duplica; solicitudes concurrentes de un producto solo aceptan una.
- Los productos entregados se corrigen con Ajustes (disponible final y motivo), conservando movimientos. Backend exige apertura activa para entregar, ajustar y vender. Una venta/borrador de apertura cerrada no puede facturarse/anularse contra otra apertura.
- Antes de cerrar se muestra el consolidado. Entregado definitivo = saldo de transición + entregas + ajustes netos; vendido = ventas menos anulaciones; sobrante = entregado definitivo - vendido. El cierre compara el resumen revisado con el vigente para detectar movimientos nuevos.
- El snapshot incluye nombres, apertura, responsables, fechas, cantidades, total vendido y totales por unidad (KG y UND separados). En inventarios compartidos el sobrante es del grupo: se muestra una sola vez, con entrega/consumo real por presentación, sin inventar saldos independientes por corte.
- Cierre y limpieza de stock son atómicos; se conserva el manejo anterior de dejar stock operativo en cero mediante un solo movimiento por saldo. Abrir otro ciclo no restituye ni duplica sobrantes. La caja se cierra aparte.
- Historial con filtros de ruta/fechas y páginas de 30, incluidos cierres previos a esta versión. Las instantáneas anteriores no se modifican.
- Se conserva el endpoint anterior de reapertura correctiva para compatibilidad con instalaciones previas; el flujo nuevo abre ciclos independientes, sin restauración automática.

### Transición de datos

La migración no cambia ventas, productos, rutas, stock ni cierres existentes. Si una ruta tiene stock disponible al migrar, crea una apertura de transición con ese saldo real, marcado como transición y sin inventar usuario/fecha de una apertura histórica. Su última entrega real queda identificada para impedir volver a entregarla. Los movimientos y documentos anteriores permanecen intactos. Las rutas sin saldo comienzan cerradas y el administrador debe abrirlas antes de la siguiente entrega. La migración se aplica una sola vez y es repetible.

### Grupos

Administrador: botón de eliminación con confirmación. Desactiva mediante `inventory_group_status` y libera asociaciones sin borrar productos ni referencias históricas. Si hay stock, reserva offline o movimientos de una apertura aún activa, bloquea y pide resolver/cerrar primero. No se puede asociar un producto a un grupo desactivado. Los catálogos nuevos excluyen esos grupos.

### Venta móvil

Seleccionados vendedor y cliente, se muestran compactos; cambiar exige cancelar el borrador e iniciar otro, respetando el cliente fijo. El buscador se desplaza al foco; el resumen inferior se oculta mientras se usa teclado/búsqueda. Android conserva `adjustResize`; web ajusta la altura al visual viewport. Resultados desplazables, botones y diseño de escritorio conservados.

### Crédito en comprobantes

Cada nueva venta conserva en su snapshot: compra actual, pagado actual, crédito anterior, abono a ese crédito, nuevo crédito y deuda total resultante. Los nuevos comprobantes PDF 58/80 mm, vista previa y salida local/ESC-POS usan esos importes guardados. Los documentos históricos ya emitidos y sus instantáneas se conservan; no se recalculan con la deuda de hoy.

El cobro opcional a deuda anterior reutiliza la creación/distribución de abonos. Se ejecuta dentro de la misma transacción de la venta, antes de generar su nueva deuda. No suma ventas, sí suma cobros una vez, con referencia electrónica validada. Si falla una referencia o el importe, se revierte toda la operación. Se informa el cobro adicional en la pantalla. El efectivo recibido en una operación de efectivo con abono anterior incluye ambos importes para calcular el cambio.

El modo Android sin internet conserva sus reservas y cola. Usa la deuda conocida al preparar más sus ventas locales; los abonos a crédito anterior y fotografías continúan requiriendo conexión. No se fuerza un cambio de generación ni se borra la cola.

### Gastos con fotografías

Cámara/galería, vista previa, cambio o eliminación antes de guardar; permisos de cámara bajo demanda. Cliente optimiza a JPEG de hasta 1600 px, servidor valida JPEG/PNG/WebP, máximo 5 MB y 20 millones de píxeles, elimina metadatos y crea JPEG optimizado + miniatura de hasta 320 px. No admite SVG ni imágenes animadas. Carga con porcentaje, referencia idempotente y reintento; gasto y asociación se graban atómicamente.

Los archivos se almacenan junto a la SQLite en `expense-evidence/`; la base solo guarda referencias y metadatos, nunca Base64. Las rutas de lectura requieren autenticación y rol administrador o propietario. No hay URLs públicas de fotografías ni credenciales en enlaces.

Listado administrativo por defecto hoy (Colombia), filtro opcional de caja y rango; SQL devuelve páginas de 30 metadatos. Cada página sustituye a la anterior para mantener memoria acotada. Las miniaturas se solicitan solo cuando entran en pantalla; el original únicamente al ampliar. Los gastos anteriores sin imagen siguen funcionando. El resumen de caja conserva todos sus importes y no descarga imágenes.

## Archivos y módulos

Nuevos:

- `server/src/route-cycle-schema.sql`, `route-cycles.js`: aperturas, vínculos, transición, consolidado, historial.
- `server/src/expense-evidence-schema.sql`, `expense-evidence.js`: metadatos, archivos protegidos, validación, miniaturas.
- `mobile/src/ExpenseEvidence.tsx`: cámara/galería, compresión y visor diferido.
- `server/test/route-cycles-evidence.test.js`: pruebas integradas nuevas.

Modificados:

- Servidor: `db.js`, `business.js`, `route-operations.js`, `commerce.js`, `sale-drafts.js`, `service.js`, `validation.js`, `offline-route.js`, `cash-expenses.js`, `app.js`, `pdf.js`, `receipt-contact.js`, `backup.js`, `reset-operations.js` (solo compatibilidad de mantenimiento, no se ejecutó).
- App: `App.tsx`, `ui.tsx`, `SaleScreen.tsx`, `RouteClosureScreen.tsx`, `InventoryScreen.tsx`, `ExpensesScreen.tsx`, `MenuScreen.tsx`, `Receipt.tsx`, `api.ts`, `types.ts`, `offline/route-store.js`, `printing/contact.js`, `printing/receipt.js`.
- Dependencias/configuración: `mobile/app.json`, `mobile/package.json`, `server/package.json`, ambos lockfiles y lockfile raíz. Expo ImagePicker/Manipulator y Sharp. No se agregan permisos de micrófono.
- Regresiones adaptadas al contrato de apertura/entrega: fixtures, `business.test.js`, `commerce.test.js`, `route-payments.test.js`, `client-receipt.test.js`, `scripts/business-e2e.mjs`.

## Pruebas y resultados

- `npm test`: 40/40. Aperturas independientes, permisos, duplicados/concurrencia, entregas adicionales, ajustes, totales y cierre con fallo inyectado/rollback, nuevos ciclos, histórico inmutable, eliminación lógica de grupos, los tres casos de crédito, abono simultáneo, referencias y reversión transaccional, permisos de imagen, formatos/tamaños, carga idempotente, miniaturas, Colombia/fechas y páginas. Las regresiones de facturación, cartera, caja, permisos y modo sin internet se mantienen.
- `npm run check`: TypeScript correcto.
- E2E web 320/390/768/1280 px: flujo existente completo y fotos reales de prueba seleccionadas por galería, miniatura y ampliación. Verifica que antes de ampliar no se solicita imagen completa. Vista reducida a 420 px simula espacio de teclado; buscador y resultados visibles. Capturas en `output/screenshots/business/`.
- PDF de los tres casos en `output/pdf/credito-desglose-caso-{1,2,3}-58mm.pdf`, una página, ancho físico 58 mm, altura dinámica; inspección visual sin cortes.
- Android 1.4.0, versionCode 17, ARM32/ARM64: compila. Mismo certificado y applicationId para actualizar sin desinstalar. Se resolvió un fallo TLS de Gradle descargando el artefacto AndroidX oficial y comprobando su checksum; no se bajó ninguna protección/versión.
- Ensayo aditivo sobre copia de producción: 53 tablas anteriores conservaron exactamente sus registros (SHA256), doble ejecución correcta, integridad ok y sin errores de FK. Respaldo: `/data/backups/before-routes-evidence-1.4.0-2026-11-24T02-52-46.115Z.sqlite`. En ese instante: 12 ventas, 30 clientes, 16 productos, 2 cajas y 1 cierre de ruta, sin reserva offline activa. No se insertaron ventas de prueba en producción.

## Configuración y actualización

1. Desplegar servidor antes de instalar APK. Las migraciones son automáticas al iniciar; conservar el volumen `/data`.
2. El almacenamiento por defecto será `/data/expense-evidence`. Opcional: `EXPENSE_FILES_DIR`, siempre persistente y escribible por el usuario del servidor. No exponer esa carpeta como contenido estático.
3. `npm run backup` conserva SQLite y copia la carpeta de evidencias en `<respaldo>.files`; restaurar ambos juntos. Las fotos son inmutables y no se sobrescriben.
4. Instalar el APK seleccionando Actualizar, sin borrar datos ni desinstalar. Abrir con internet, revisar estado de rutas y abrir la correspondiente antes de entregar.
5. Cámara y galería solicitan únicamente los permisos necesarios; permitir cámara para tomar comprobantes.

Pendiente físico: no hay Neotek conectado por ADB; falta comprobar en el equipo real la captura de cámara, teclado Android, escáner físico e impresión de este APK. Las pruebas de interfaz corresponden a navegador y las de reglas a SQLite/API reales, sin simular el resultado financiero. Las fotografías y el abono a deuda anterior requieren conexión.

Referencias de integración: [Expo ImagePicker](https://docs.expo.dev/versions/latest/sdk/imagepicker/), [Sharp: límites de imagen](https://sharp.pixelplumbing.com/api-constructor/).

APK: `output/dok-pollo-mc-1.4.0-neotek.apk`. SHA256: `0d5830e4933e239bab506914b7fad28f064bff9ccfb883e9bdaccce1451007b9`. Certificado SHA256: `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`.
