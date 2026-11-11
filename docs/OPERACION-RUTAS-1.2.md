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
