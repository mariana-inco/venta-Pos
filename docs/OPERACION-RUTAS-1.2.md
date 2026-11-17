# Operación por rutas — DOK POLLO MC 1.2.0

Implementado sobre Express/SQLite y Expo/React Native existentes, en `deploy/backend-pos`. No se sustituyen tablas principales, IDs, relaciones ni comprobantes guardados.

## Datos y transición

Migración automática al abrir el backend (`server/src/business-schema.sql`):

- `customer_profiles`: tipo Normal/Mayorista, obligatorio en almacenamiento. Los clientes anteriores se conservan como Normal, correspondiente al precio anterior; se pueden editar. Los clientes enviados por un APK antiguo sin tipo conservan Normal por compatibilidad.
- `product_pricing`: precio mayorista separado. `products.price_cents` sigue siendo el precio normal anterior. No se copia ni deduce ningún mayorista: permanece sin configurar y bloquea ventas mayoristas hasta definirlo.
- `sales_agents` y `sale_agents`: varios vendedores por cuenta de usuario, sin cuentas/contraseñas propias; relación inmutable con las ventas nuevas. Los históricos no reciben vendedores inventados.
- `delivery_batches` y `delivery_items`: entregas múltiples, aditivas e idempotentes; cada producto/cantidad/usuario/fecha queda registrado junto al libro de movimientos existente.
- `daily_closures`: copia inmutable de resultados financieros e inventario por ruta/día.
- `business_policy`: fecha de transición del protocolo de ventas. Las ventas nuevas se confirman online y exigen ruta, vendedor válido y stock disponible.

Se reutilizan `seller_routes`, `customer_routes`, `product_codes`, inventarios compartidos, `route_stock`, `stock_movements`, ventas/pagos/cartera/abonos y cierres existentes. El campo único Código oculta la clasificación interna anterior y conserva códigos alternativos ya registrados para búsqueda, sin duplicar el producto.

Las existencias globales antiguas se conservan como datos históricos y dejan de editarse desde productos. No se distribuyen automáticamente entre rutas. Los stocks y grupos por ruta ya existentes se conservan. Un producto sin grupo recibe un grupo propio al efectuar su primera entrega, sin crear existencias adicionales por suposición.

## Pantallas y permisos

- Catálogo: tipo de cliente editable; precio normal/mayorista separados; Código; eliminación del control manual de existencias.
- Perfil → Usuarios y accesos: crear/editar usuario, asignar ruta, crear/editar/activar varios vendedores sin acceso propio y restablecer contraseña. El backend valida los permisos y no permite cambiar la ruta con cajas abiertas.
- Rutas e inventario: crear/editar/desactivar rutas; consultar usuarios; asociar clientes; buscar productos y preparar una entrega múltiple; confirmar/reintentar sin duplicar; consultar sobrantes e historial; ajustes con motivo y versión de stock; grupos compartidos.
- Vender: vendedor propio → cliente → productos/cantidades → efectivo/electrónico/crédito → confirmación. El cambio de cliente recalcula el carrito. El servidor valida nuevamente el precio y conserva el aplicado en la venta; identifica usuario, vendedor, cliente y ruta. Una venta nueva a crédito sin pago inicial genera deuda y no registra dinero recibido.
- Cuentas por cobrar: búsqueda de deudores, selector desplegable para abonos, deuda e historial, movimientos y saldos; abonos de administrador o usuario vendedor, sin crear otra venta. Los reintentos mantienen su referencia y la asignación del pago se realiza en una transacción.
- Estado de cuenta PDF: completo o filtrado por fechas; cliente/tipo, productos, referencias P-XX, fechas, crédito, pagos, responsables, saldo anterior al rango, saldo de cada movimiento, resumen y saldo actual. Se descarga autenticado, sin publicar información ni tokens en enlaces.
- Resultados y cierres: desglose por vendedor, usuario y ruta; cobros de ventas separados de abonos por medio de pago; consolidado sin duplicar. Incluye inventario inicial, entregas, vendido neto, ajustes y final. Los productos de inventario compartido muestran su consumo y el saldo común del grupo: ese saldo no se suma varias veces.
- Los cierres de caja nuevos también incorporan el desglose financiero y el inventario en su snapshot; los cierres antiguos no se reconstruyen ni cambian.

El usuario vendedor solo obtiene vendedores propios y clientes/productos de su ruta. Los productos agotados no se ofrecen para vender. Puede consultar cartera y registrar abonos, pero no administrar usuarios, agentes, otras rutas, entregas, ajustes ni cierres.

## Orden de actualización

1. Sincronizar ventas anteriores y cerrar las cajas desde la terminal de origen. Guardar copia consistente de SQLite y la clave de firma. No borrar datos locales con colas pendientes.
2. Actualizar el backend. La migración es aditiva; no elimina ventas, abonos, stocks ni PDFs. Los nombres y precios históricos conservan sus snapshots.
3. Instalar el APK 1.2.0 como actualización, con el mismo applicationId y certificado. No instalarlo solo contra un servidor antiguo: necesita los endpoints nuevos.
4. Revisar usuarios/rutas, asociar sus vendedores, clasificar clientes, configurar precios mayoristas y entregar inventario por ruta. No se inventa esta configuración al migrar.
5. Iniciar sesión con conexión; la ruta se identifica automáticamente. Probar una venta por usuario y verificar su vendedor, precio y stock.
6. Al cerrar una jornada de ruta se congela toda su información. Se bloquean nuevas ventas, abonos, entregas y ajustes de ese día; los sobrantes siguen disponibles al día siguiente. Las anulaciones/reversiones de operaciones cuyo día ya cerró se rechazan; requieren conciliación administrativa, sin alterar el cierre.

Las colas antiguas no se borran. El puente de sincronización acepta eventos de venta anteriores a la transición con catálogos antiguos; conserva sus importes históricos y la conciliación anterior. Un catálogo nuevo no permite crear ventas offline que eludan la validación de ruta. Una venta antigua con fecha posterior a la transición se conserva en la cola y se marca para conciliación: no se inventan vendedor/precio/stock para convertirla silenciosamente.

## Verificación

- `npm run check`: TypeScript.
- `npm test`: 22 pruebas de formato, API, permisos, migración, persistencia, históricos, cartera, reintentos, reservas y concurrencia.
- `npm run test:e2e`: recorrido actual en web móvil. Entrega por ruta, dos vendedores del mismo usuario, búsqueda por código/Enter y nombre, cambio de tipo de cliente con recálculo, venta a crédito, pago electrónico, abono del vendedor, descarga PDF, resultados y cierre. Capturas en 320/390/768/1280 px en `output/screenshots/business`.
- Backend: abonos por ambos perfiles, efectivo/electrónico/crédito, bloqueo de excesos y rutas ajenas, dos ventas distintas disputando stock con resultado 201/409, idempotencia de ventas/abonos/entregas/cierres, precios históricos intactos, PDF completo/filtrado y saldo previo al rango.
- PDF de ejemplo: `output/estado-cuenta-ejemplo.pdf`, revisado mediante extracción y renderizado.

La aceptación física de la versión nueva en Neotek (instalación, escáner nativo e impresión) debe realizarse en la terminal. Esta implementación no cambia el controlador nativo de la impresora ni el mecanismo de firma.

APK generado y verificado: `output/dok-pollo-mc-1.2.0-neotek.apk`, versión 1.2.0 / versionCode 8, mismo `com.ventapos.mobile`, ARM32/ARM64, minSdk 24, targetSdk 36. Firma v2 correcta y certificado SHA-256 `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`, igual al de las entregas anteriores. SHA-256 del archivo: `9023a2daa4e0d945911a5194f236c228c83c44f7bbb84cec47ac97c306b30986`. Compilación nativa release correcta, conservando las reglas R8 de WorkManager.

Estado de entrega: código y pruebas locales completos. Este cambio no se desplegó automáticamente al backend de producción, porque exige preparar vendedores/rutas/precios y coordinar la actualización de las terminales: los APK anteriores no envían el vendedor asociado requerido por las ventas nuevas. Antes de usar este APK contra producción debe actualizarse el servidor y completarse la configuración descrita arriba. No se modificaron datos de producción durante esta implementación.

## Corrección de usuarios y rutas — 1.2.2 (11 de noviembre)

El mensaje «Ruta no encontrada» al abrir/guardar usuarios se debía a que el backend publicado (25a080e) carecía de `PUT /api/users/:id` y `/api/agents`. El listado de usuarios tampoco incluía su `route_id`. Se publicó la corrección compatible `8aa2c64ba76d05c2dcb691dea05bb7c62aae4249`, rama `fix/user-route-compat`, partiendo de aquella versión. Coolify ahora apunta a esa rama; antes de cambiarla para otra publicación, comprobar expresamente la compatibilidad del protocolo de ventas.

- Usuarios y ruta se crean en una sola transacción; una ruta inválida no deja un usuario creado parcialmente. La edición devuelve el perfil actualizado y mantiene el bloqueo de cambios de ruta si hay cajas abiertas. Se incluyen vendedores asociados y consulta de usuarios por ruta.
- APK 1.2.2: contador cargado sin mostrar cero antes de consultar, actualización del contador tras guardar/activar usuarios, errores visibles dentro del formulario y cierre del formulario tras guardar. Conserva Bluetooth de 1.2.1. No desinstalar la versión anterior para actualizar.
- Respaldo previo: `/data/backups/pos-2026-11-11T04-54-28.782Z.sqlite`. Despliegue final: `qtd2oahxtitptxr9kunh8veg`, saludable. Durante la publicación se lanzó por error la rama general d99a8ca (`pixjkhqkppvfv97e7dluga4s`); se corrigió a la rama de compatibilidad. Sus migraciones aditivas permanecen en SQLite; no eliminar tablas para revertirlas. El backend final conserva el protocolo de ventas anterior y no activa el nuevo flujo comercial.
- Verificación tras publicar: integridad SQLite `ok`; mismos 4 usuarios, 9 ventas, 3 clientes, 6 cajas y 0 asignaciones de ruta que antes. Las pruebas de alta con ruta, edición, rechazo de ruta inválida sin alta parcial y vendedores se ejecutaron dentro del contenedor final **sobre una copia temporal de la base**; los datos reales no se modificaron en esas pruebas. HTTPS `/health` responde `{"ok":true}`.
- Pruebas: 21 del backend compatible, 23 del código actual, TypeScript correcto y E2E de formulario (crear con ruta, editar, contador actualizado y aviso de caja abierta) junto al recorrido comercial existente, en 320/390/768/1280 px. Compilación release y firma v2 verificadas.

APK: `output/dok-pollo-mc-1.2.2-usuarios-rutas.apk`, versionCode 10, mismo certificado `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`. SHA-256: `38afbaff3458b4ba812731fbbb83e160f1f7242a50a86ef94a210df2c21331c9`. Preparado para instalar; ningún equipo estaba conectado por ADB al terminar esta corrección.

## Actualización física y cierre administrativo autorizado

El APK 1.2.2 se instaló posteriormente en la H10S por USB mediante actualización, sin desinstalar. Verificados versionCode 10 / versionName 1.2.2, sesión conservada, cero operaciones pendientes, contador de 4 usuarios activos y receptor Bluetooth reactivado.

La titular solicitó cerrar todas las cajas abiertas y respondió expresamente que se usaran los saldos registrados por caja, sin conteo físico informado, y que todos los equipos estaban sincronizados sin pendientes. Se incorporó un flujo administrativo interno separado del cierre ordinario desde el dispositivo: `closeReviewedSessions` en `server/src/admin-close.js`. Exige administrador activo, declaración de sincronización, revisión de ventas/importes, motivo y referencia idempotente. Valida todas las cajas antes de cerrar ninguna; el lote es transaccional y deja auditoría individual y del lote. No se expuso un parámetro de excepción a las rutas HTTP de cierre normales ni se suplantaron identidades de dispositivo offline. Los snapshots identifican `administrative_recorded_totals`, `physical_count_reported: false` y el dispositivo de origen.

Publicado en la rama de compatibilidad, commit `f109917662c280966bfd14defd5ab784183b2746`, despliegue `tshgk60yxobrlemfbhy7huu1`, saludable. Pruebas: 22 en el backend compatible y 24 en el código actual, incluyendo permisos, bloqueo del cierre ordinario remoto, revisión obsoleta sin cierres parciales, importes, auditoría e idempotencia. Antes de ejecutar se verificó también el lote completo y sus PDFs sobre una copia temporal de la base real.

Respaldo previo: `/data/backups/pos-2026-11-11T05-20-36.872Z.sqlite`. Se cerraron las cajas **#1, #2, #3, #4 y #6**, generando cierres **#2 a #6**. Efectivo registrado: **$595.000 COP**; electrónicos registrados: **$66.880 COP**. No se certificó arqueo físico ni verificación bancaria independiente. Referencia de lote: `92967c9d-7fb1-4c9b-a60d-b7ac836ebf34`.

Resultado verificado: **0 cajas abiertas**, cinco PDFs de cierre listos en 58/80 mm, integridad SQLite `ok`. Permanecieron las mismas 9 ventas, 14 ítems, 9 pagos, 3 clientes y 4 usuarios. La Neotek mostró «Tu caja está cerrada» y «Jornada · 0 cajas abiertas». Evidencia local: `output/admin-closures-2026-11-11.json` y `output/android-diagnostic/neotek-after-closures.xml`.
