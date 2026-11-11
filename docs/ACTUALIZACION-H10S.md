# Actualización de ventas por ruta y terminal H10S

Trabajo realizado sobre `deploy/backend-pos`, conservando Expo/React Native, Express, SQLite y la identidad visual existente. No se ejecutaron migraciones ni ventas contra la base del negocio: las verificaciones usan bases temporales.

## Diagnóstico inicial

La app tenía catálogo por unidad/KG, control global opcional de existencias, caja por vendedor/dispositivo, historial, PDF de 58/80 mm y ventas Android con SQLite local y sincronización. La impresión nativa disponible era Bluetooth Classic SPP/ESC-POS; no era una integración demostrada con la impresora interna de Neotek.

La sincronización anterior aceptaba faltantes de inventario para conciliar posteriormente. Ese comportamiento no garantiza exclusión entre dos terminales desconectadas. Las nuevas ventas por ruta, crédito y abonos requieren conexión al servidor. Las operaciones sin ruta conservan su funcionamiento anterior. El servidor rechaza eventos de venta offline de usuarios que ya tengan una ruta asignada.

## Implementación

- Productos: varios códigos de texto por producto, internos o de barras, ceros iniciales, validación de duplicados sin distinguir mayúsculas, edición y auditoría de códigos anteriores/nuevos. Los productos existentes pueden seguir sin código hasta que el administrador los configure.
- Ventas: buscador vacío sin catálogo, nombres/códigos, coincidencia exacta de código prioritaria, cantidad explícita por unidad/KG, resumen visible y editable, validación del consumo acumulado del grupo y confirmación con referencia persistente.
- Rutas: asignación de usuarios/clientes, identificación del cliente, grupos de inventario de la misma unidad, cargas adicionales y ajustes con motivo y control de concurrencia. Para inventario independiente, crear un grupo con un solo producto.
- Existencias: aislamiento por ruta, descuento transaccional compartido, bloqueo de faltantes, movimientos con usuario/fecha/producto/factura y consumo neto por producto. Las asignaciones por ruta no copian ni consumen automáticamente el inventario global anterior.
- Crédito: importe inicial opcional, saldo y estado derivados de pagos efectivos. El vendedor no fija precios: el servidor los obtiene del catálogo y compara los precios esperados.
- Abonos: vendedor de la ruta, caja propia abierta, efectivo/electrónico, observaciones, distribución por antigüedad o factura elegida, historial y filtros administrativos. Se rechazan exceso sobre deuda, distribuciones inválidas y referencias repetidas con otro contenido. El cuerpo de un abono pendiente se conserva para reintentar tras recarga.
- Anulaciones y reversiones: registros compensatorios auditados, sin modificar comprobantes originales. Para anular, primero revertir los abonos asociados. Solo se permite anular/revertir mientras la caja de origen siga abierta; una caja cerrada requiere un flujo adicional de conciliación administrativa. La anulación automática de ventas históricas anteriores a esta actualización está bloqueada porque no existe evidencia fiable del stock descontado en su emisión. Las facturas emitidas se corrigen mediante anulación y una nueva venta, sin edición destructiva.
- Caja: incorpora recaudos y resta anulaciones/reversiones de la conciliación actual. El total de ventas se mantiene separado del recaudo adicional. Los abonos electrónicos tienen una categoría de conciliación propia.
- PDF: 58 mm físicos, contenido de 48 mm para márgenes del papel, altura medida antes de dibujar, ruta, subtotal, total, abono/saldo inicial de crédito, recibido/cambio cuando se envían. Los documentos guardados permanecen inmutables: el saldo actual se consulta en cartera. Las instalaciones nuevas usan 58 mm por defecto; no se sobrescribe la configuración existente.

## Base de datos

Migración aditiva e idempotente en `server/src/commerce-schema.sql`, ejecutada por `openDatabase`:

`routes`, `seller_routes`, `customer_routes`, `product_codes`, `inventory_groups`, `product_groups`, `route_stock`, `stock_movements`, `sale_terms`, `sale_voids`, `collections`, `collection_allocations`, `collection_reversals`, `sale_stock_effects`.

No elimina ni reconstruye tablas existentes. Los movimientos, términos, anulaciones, abonos, distribuciones, reversiones y efectos de stock quedan protegidos contra UPDATE/DELETE. Los saldos se calculan desde esos registros. SQLite usa BEGIN IMMEDIATE para validar y descontar inventario/registrar cartera en la misma transacción, evitando que dos confirmaciones consuman el mismo saldo.

## Actualización de una instalación

1. Sincronizar todas las terminales y cerrar sus cajas antes de asignar rutas. No asignar rutas mientras existan ventas locales pendientes. Guardar el APK y la clave de firma usados actualmente.
2. Ejecutar `npm run backup` contra la configuración correcta del servidor y guardar la copia fuera del equipo.
3. Instalar dependencias con `npm ci`. Actualizar primero el backend y reiniciarlo; la apertura de la base crea las tablas nuevas. No sustituir la base por una de pruebas.
4. Configurar productos/códigos, rutas, clientes e identificaciones desde Catálogo y el botón “Rutas y abonos” del encabezado. Asociar cada producto a un grupo de su misma unidad y cargar stock para cada ruta.
5. Asignar los vendedores a sus rutas con las cajas cerradas y volver a iniciar sesión en las terminales. Verificar los saldos iniciales con el inventario físico. El inventario global anterior se conserva, pero no se interpreta como carga de una ruta.
6. Reconstruir Android con el mismo identificador `com.ventapos.mobile` y el certificado de la instalación anterior; seleccionar un versionCode superior al instalado una vez conocido. No desinstalar para resolver una incompatibilidad de firma: se perderían datos locales.
7. Realizar las pruebas físicas descritas abajo antes de poner esta versión en operación.

## Lector físico

Se implementó recepción por campo de búsqueda y terminador Enter. El módulo Android existente incorpora además captura de eventos de teclado físico a través de Window.Callback mientras la pantalla de venta está activa. Acepta Enter, Enter numérico y Tab; conserva el código como texto. Las lecturas se emiten a la app y no se insertan en campos de cantidad/pago/cliente. Si hay un formulario abierto, la app solicita terminarlo antes de recibir otro producto. El teclado táctil permanece disponible para cantidades y digitación manual.

Este adaptador cubre lectores que generan KeyEvent de teclado. No demuestra cómo está configurada esta unidad H10S: un lector que escriba mediante InputConnection, intents propietarios o SDK exige su documentación y una integración adicional. No se inventaron nombres de intents ni APIs del fabricante. La captura Kotlin fue compilada en el APK 1.1.0; no se ha probado físicamente en esta sesión. El recorrido web con terminador de teclado es una prueba de software; no constituye evidencia del lector H10S.

## Impresora

El PDF de 58 mm y la impresión son caminos distintos. Android conserva Bluetooth ESC/POS si se configura una impresora compatible; sin esa configuración, las ventas por ruta ofrecen el PDF al servicio de impresión de Android. Esto solo imprime en la integrada si el firmware tiene un servicio compatible instalado.

La investigación posterior identificó la H10S de Senraise y bindings públicos para su servicio interno. No se confirmó que Neotek utilice ese fabricante/firmware. La integración directa en esta unidad sigue pendiente de identificar el servicio instalado y contrastar la interfaz, como se detalla abajo. No se afirma que Bluetooth controle la impresora interna ni que abrir el diálogo de Android equivalga a imprimir.

## Instalación Android: evidencia y diagnóstico

La inspección de la configuración generada y de las dependencias muestra:

- applicationId/namespace: `com.ventapos.mobile`, conservado.
- minSdk: 24; targetSdk: 36; compileSdk: 37. Android 13 es API 33, por lo que el mínimo declarado no lo excluye.
- APK 1.1.0 verificado con bibliotecas `armeabi-v7a` y `arm64-v8a`. Las ABIs del dispositivo siguen sin comprobarse mediante ADB.
- versionCode: 2; versionName: 1.1.0. La pantalla de acceso muestra la versión y el servidor.
- El script local produce una compilación de prueba con firma de desarrollo. Una instalación previa con otro certificado puede requerir recuperar la clave anterior. No se ha confirmado que ese sea el error reportado.
- Se instalaron localmente Temurin JDK 21 y las herramientas oficiales Android SDK. La compilación nativa `assembleRelease` finalizó correctamente. `adb devices -l` no encontró equipos conectados.

Se generó `output/dannys-pos-1.1.0-neotek.apk` para actualizar la interfaz antigua que el usuario tiene instalada. Firma APK v2 verificada con `apksigner`; certificado de desarrollo. SHA-256: `44bb1f7ba8c23059209ce058d9ee0b685ce3dfa61b6400f4d963b1dc4ad7371c`. Esto no identifica la causa del rechazo histórico del instalador ni comprueba la apertura en Android 13. El usuario autorizó descartar los datos locales del dispositivo si fuera necesario reinstalar; la base de datos del servidor no se elimina.

Con la H10S conectada y autorizada:

```sh
node scripts/diagnose-android.mjs
# Si hay más de un dispositivo:
ANDROID_SERIAL=SERIAL_DE_LA_H10S node scripts/diagnose-android.mjs
# Obtener el error exacto del APK que ya está fallando, sin borrar datos:
tmp/platform-tools/adb install -r /ruta/al/apk-que-falla.apk
```

El script guarda propiedades (SDK, ABI, fabricante/modelo), paquete instalado, servicios de impresión, servicios del sistema y almacenamiento en `output/android-diagnostic`. El diagnóstico puede contener identificadores del equipo; revisarlo antes de compartir.

Interpretar el resultado antes de modificar versiones:

- `INSTALL_FAILED_NO_MATCHING_ABIS`: comparar `ro.product.cpu.abilist` con las bibliotecas del APK.
- `INSTALL_FAILED_OLDER_SDK`: comparar minSdk del APK con API del dispositivo.
- `INSTALL_FAILED_UPDATE_INCOMPATIBLE`: comparar certificados y recuperar la firma anterior.
- `INSTALL_FAILED_VERSION_DOWNGRADE`: comparar versionCode y publicar una actualización con valor superior.
- `INSTALL_FAILED_USER_RESTRICTED`: revisar autorización de instalación y políticas del equipo.

Para el APK que falla, usar las herramientas Android SDK `apkanalyzer manifest print`, `apkanalyzer files list` y `apksigner verify --print-certs`. No cambiar applicationId, no ejecutar `pm clear`, no desinstalar ni forzar downgrade como atajo.

Fuentes: [ADB oficial](https://developer.android.com/tools/adb), [soporte de arquitecturas](https://developer.android.com/games/optimize/64-bit), [compatibilidad de Expo](https://docs.expo.dev/versions/v58.0.0/). Las versiones del proyecto se contrastaron también con archivos instalados de React Native y Expo Autolinking.

## Verificación y entregables

- Backend: `npm test`; incluye rutas, códigos duplicados con rollback, suma de productos de un mismo grupo, separación entre rutas, dos solicitudes concurrentes con stock insuficiente, reintento idempotente, pagos parciales/final, exceso de abono, permisos, reversión y restitución al anular. Conserva las pruebas anteriores de operación offline sin ruta.
- App: `npm run check` y `npm run test:e2e`. E2E utiliza base temporal y revisa el flujo existente y el nuevo flujo por ruta. Capturas en `output/screenshots`.
- Dependencias: `npm exec -w mobile -- expo install --check` y `npm run doctor`.
- JavaScript Android: `npm exec -w mobile -- expo export --platform android --output-dir ../output/android-bundle`. Esto no es una compilación nativa ni un APK.
- Muestras: `node scripts/receipt-examples.mjs` genera tres PDF sin crear ventas: un producto, varios y crédito. Ancho 164,409 pt = 58 mm, una página cada uno; alturas distintas. Revisados con pdfinfo y renderizado Poppler.

Pendientes de aceptación: causa exacta del instalador, continuidad de firma con el APK anterior, instalación/apertura, lector real con lecturas consecutivas y cantidades, servicio/SDK de la impresora interna, impresión física legible y venta completa en la H10S. Sin esas verificaciones, la actualización no se considera terminada para producción en ese modelo.

## Investigación adicional del hardware

La [ficha oficial Senraise H10S](https://www.senraise.com/products/senraise-h10s-handheld-pos-terminal.html) confirma Android 13, procesador MTK de cuatro núcleos, escáner 1D/2D y térmica integrada de 58 mm. Su [FAQ oficial](https://www.senraise.com/faq.html) confirma soporte SDK/API. Esto identifica un candidato de fabricante; no acredita que la unidad marcada Neotek use su firmware. No se encontró una ficha o manual Neotek H10S que vincule inequívocamente ambas marcas.

El [portal de descarga de Senraise](https://www.senraise.com/download.html) solicita correo y código de verificación. No se envió correo ni se registró una cuenta.

Se revisó el código fuente de [SenraiseLib](https://github.com/abdalla19977/SenraiseLib), revisión `cc30c73507e3067e7bd4f734c25cb43505d0ebfb`, y del [adaptador POS que declara pruebas en H10s](https://github.com/abdalla19977/pos_printer), revisión `da94be99e4445aea3ec77e0827890d2fb2eb89c0`. El código publicado usa Android Binder/AIDL para conectarse a:

- Paquete: `recieptservice.com.recieptservice`.
- Servicio: `recieptservice.com.recieptservice.service.PrinterService`.
- Interfaz: `recieptservice.com.recieptservice.PrinterInterface`.
- Operaciones de impresión de texto/bitmap, tamaño, alineación, avance de papel y comandos ESC/POS.

Estas son evidencias del mecanismo utilizado por esos proyectos, no una certificación para el firmware Neotek. No se añadieron dependencias de Flutter/Capacitor a Expo ni se copió un SDK sin confirmar compatibilidad. El diagnóstico ADB ahora inspecciona expresamente ese paquete. Si está instalado, el siguiente paso es verificar su versión e interfaz y adaptar el módulo Kotlin existente para ese servicio; si no existe, se debe seguir la interfaz real del firmware.

No se localizó un contrato público inequívoco de eventos de escaneo para Neotek H10S. El adaptador de teclado físico queda implementado para el modo wedge, pendiente de comprobar el modo real.

## Resultados registrados

`npm test`: 17 pruebas aprobadas. `npm run check`: aprobado. `expo install --check`: dependencias alineadas. `expo-doctor`: 20/20 comprobaciones aprobadas. E2E completo aprobado: flujo anterior y nuevo recorrido de ruta con código `0001`, terminador Enter, peso/unidades, venta a crédito, dos abonos y estado PAGADA; captura y control de desbordamiento a 320, 360, 390, 430, 768 y 1280 px.

Las tres muestras de una página tienen ancho 164,409 pt (58 mm) y alturas de 435,573 / 491,109 / 540,645 pt, respectivamente. Se revisaron visualmente los tres renderizados.

Se aplicaron actualizaciones compatibles de dependencias transitivas tras la auditoría npm. Se corrigió el hallazgo alto de body-parser; quedan cinco hallazgos moderados en la cadena de herramientas Expo/glob/minimatch. No se aplicó el downgrade a Expo 53 sugerido por audit --force.

## Historial de crédito

El listado de ventas incluye las facturas a crédito sin abono inicial, distingue el filtro Crédito y muestra anulaciones. Sus totales agrupados usan el importe facturado y excluyen importes anulados; los recaudos permanecen en su módulo.

## Archivos cambiados en esta rama de trabajo

Incluye los ajustes Expo que ya estaban pendientes al iniciar y los cambios de esta actualización:

- `README.md`
- `docs/ACTUALIZACION-H10S.md`
- `docs/IMPRESION.md`
- `mobile/.env.example`
- `mobile/App.tsx`
- `mobile/modules/pos-printer/android/src/main/java/expo/modules/posprinter/PosPrinterModule.kt`
- `mobile/package.json`
- `mobile/src/CatalogScreen.tsx`
- `mobile/src/HistoryScreen.tsx`
- `mobile/src/HomeScreen.tsx`
- `mobile/src/OperationsScreen.tsx`
- `mobile/src/Receipt.tsx`
- `mobile/src/SaleScreen.tsx`
- `mobile/src/api.ts`
- `mobile/src/offline/runtime.native.ts`
- `mobile/src/printing/receipt.js`
- `mobile/src/scanner.ts`
- `mobile/src/transport.ts`
- `mobile/src/types.ts`
- `package-lock.json`
- `package.json`
- `pnpm-lock.yaml`
- `scripts/diagnose-android.mjs`
- `scripts/e2e.mjs`
- `scripts/receipt-examples.mjs`
- `server/src/app.js`
- `server/src/commerce-schema.sql`
- `server/src/commerce.js`
- `server/src/db.js`
- `server/src/pdf.js`
- `server/src/schema.sql`
- `server/src/service.js`
- `server/src/sync.js`
- `server/src/validation.js`
- `server/test/commerce.test.js`
- `server/test/receipt.test.js`

## Actualización por LocalSend — APK 1.1.0

1. Descargar `output/dannys-pos-1.1.0-neotek.apk` al equipo desde el que se enviará.
2. Conectar ese equipo y la Neotek a la misma red Wi-Fi y abrir LocalSend en ambos. No hace falta volver a instalar F-Droid.
3. En el equipo emisor: Enviar → Archivo → seleccionar el APK → seleccionar la Neotek. Aceptar la transferencia en la terminal.
4. Abrir el APK recibido e instalar. Si Android solicita permiso para instalar aplicaciones desde esa fuente, habilitarlo para la aplicación que abre el archivo.
5. Si informa conflicto de paquete o firma, desinstalar únicamente DANNY'S POS y volver a abrir el APK. Esta alternativa borra sus datos locales; fue autorizada por el usuario. No elimina los registros del servidor.
6. Abrir DANNY'S POS y comprobar «Versión 1.1.0» y «Servidor: https://backend-pos.dromos.co/» en el acceso.

Verificación de esta entrega: TypeScript correcto, compilación nativa correcta, firma v2 válida, applicationId conservado, minSdk 24, targetSdk 36, compileSdk 37 y ambas ABIs ARM presentes. El APK incluye el adaptador de lector por teclado físico. Su funcionamiento real y la impresión interna siguen pendientes de prueba en la H10S.

## Identidad de aplicación — Dok Pollo MC 1.1.1

El nombre visible de la aplicación Android/web, el ícono del lanzador, la imagen de acceso/configuración, el encabezado y la prueba de impresión ahora usan Dok Pollo MC y el pollo suministrado por el usuario. El PNG original se conserva sin alteraciones en `mobile/assets/brand/dok-pollo-mc.png`. Se conserva `com.ventapos.mobile`; versionCode 3 y versionName 1.1.1. El script genera `output/dok-pollo-mc-preview.apk`.

Esta actualización cambia la identidad de la aplicación. Los datos comerciales configurados del negocio y los comprobantes históricos se conservan. No requiere migración ni despliegue del backend. Para instalar por LocalSend, usar `output/dok-pollo-mc-1.1.1-neotek.apk` y comprobar «Versión 1.1.1» en el acceso.

Verificación: TypeScript y compilación nativa correctos; etiqueta Android «Dok Pollo MC», minSdk 24, targetSdk 36, ABIs ARM32/ARM64 y firma v2 verificadas. Certificado SHA-256 idéntico al APK 1.1.0: `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`. APK SHA-256: `75c2f6234f2277e1dd3715240b577b7a880f0826ad0815ac9efc756277b5ed6c`. Acceso web verificado con el nombre, imagen cargada, versión y servidor de producción. Instalación física pendiente.

## Ticket Dok Pollo MC y serie pública — 1.1.2

- La venta nueva guarda `snapshot.receipt_number` como P-01, P-02…; su UUID y la clave dispositivo/evento se conservan solo para sincronización y relaciones internas. Historial, detalle, cartera, vista previa, PDF nuevo y ticket Bluetooth usan el consecutivo público. Los cierres ya no imprimen UUID.
- La migración agrega `receipt_counter`, `receipt_ranges` y `receipt_numbers`. Arranca después del máximo número histórico de venta, sin borrar ni reiniciar datos. Las ventas online asignan números transaccionalmente; cada terminal reserva bloques de 100 y recibe otro cuando le quedan menos de 20 confirmados. Los números asignados se conservan al sincronizar y nunca se reutilizan; puede haber saltos entre terminales o por reservas abandonadas. Sin números reservados se impide guardar una venta offline y se pide conexión.
- Actualizar primero el servidor y después instalar el APK. Abrir la app conectada para sincronizar y recibir su reserva. Una venta antigua pendiente creada con un APK anterior recibe el consecutivo del servidor al sincronizar; los nuevos comprobantes conservan el mismo consecutivo desde su creación local. Los PDF históricos ya almacenados se conservan como originales, sin sobrescribirlos.
- Ticket Bluetooth: logo original convertido a raster ESC/POS de 192 puntos (24 mm a 203 dpi) con umbral blanco/negro; encabezado centrado, nombre Dok Pollo MC, detalle en tres líneas por producto y total separado. Se eliminan «ID venta» y «ID cierre». El logo no depende de caracteres de la impresora. No hay reintentos automáticos de impresión. Falta confirmar en papel que la impresora seleccionada acepte GS v 0. El adaptador sigue siendo Bluetooth ESC/POS; no afirma compatibilidad nueva con un SDK interno Neotek.
- Se reemplaza exclusivamente el nombre predeterminado anterior por Dok Pollo MC para ventas futuras. Los nombres comerciales personalizados se respetan. Los snapshots históricos no se modifican. El dibujo Dok Pollo MC se usa también en los PDF nuevos y la vista previa.
- Pruebas: 20 pruebas de servidor/offline/formato correctas; reservas disjuntas, no duplicación, rechazo de reserva ajena, rollback, idempotencia, conservación de consecutivo al sincronizar y bloqueo al agotar reserva. Recorrido E2E completo correcto, con Venta P-01 y Factura P-03 pagada. PDF 58 mm de una página revisado visualmente.
- Copia de producción previa a esta actualización: `/data/backups/pos-2026-11-11T00-35-14.118Z.sqlite`.

APK: `output/dok-pollo-mc-1.1.2-neotek.apk`, versionCode 4, ARM32/ARM64. Compilación nativa y firma v2 correctas, mismo certificado de 1.1.0/1.1.1. SHA-256 del APK: `8c36e903eab278023acdcde85bb7e93832679c16450b01210399cc364fa8332b`. La impresión física del nuevo raster y la instalación de este APK siguen pendientes de prueba en la terminal.

Despliegue de tickets: Coolify `rc2tewptvptn5xtcrmpbquda`, commit `25a080eb2ef6329e71669c89da01d486072c030f`, completado el 10/11/2026 a las 19:37 (Bogotá). Contenedor saludable y `/health` devuelve `{"ok":true}`. Verificación posterior de SQLite: integrity_check=ok; 2 ventas y 2 clientes conservados; nombre Dok Pollo MC; contador público preparado en 3 (siguiente disponible P-03 antes de nuevas reservas/ventas). No se crearon ventas de prueba en producción.

Rediseño 1.1.3: `output/dok-pollo-mc-1.1.3-neotek.apk`, versionCode 5, mismo certificado (SHA-256 `fac61745…3b9c`). Sistema visual Dok Pollo MC (marfil, carbón y acento morado), cabecera con estado de sincronización, navegación que se oculta en el cobro y con el teclado, Historial con filtros compactos y pantalla de venta registrada que separa guardado, sincronización e impresión. Verificado en navegador (E2E 320–1280 px, sin desplazamiento horizontal); pendiente revisar en la Neotek el tamaño real, el teclado y la impresión.

APK 1.1.4: `output/dok-pollo-mc-1.1.4-neotek.apk`, versionCode 6, mismo certificado. Nombre visible DOK POLLO MC y acciones principales en morado de marca, con superficies neutras.

APK 1.1.5: `output/dok-pollo-mc-1.1.5-neotek.apk`, versionCode 7. Corrige el cierre al iniciar en compilación release: R8 eliminaba el constructor de la base Room de WorkManager (expo-background-task). Reglas en `mobile/plugins/with-release-keep-rules.cjs`. Verificado en TECNO CM6 (Android 16): abre, sincroniza y recorre las cinco pestañas sin errores.
