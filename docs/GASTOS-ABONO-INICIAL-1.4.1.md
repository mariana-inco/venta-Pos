# Fotografía obligatoria y abono inicial multimétodo — 1.4.1

## Comportamiento

- Un gasto nuevo exige fotografía: cámara/galería, vista previa, compresión y carga privada existentes. El formulario indica que es obligatoria y valida al guardar. Backend exige una evidencia cargada, del mismo usuario y caja, con archivos disponibles y sin vinculación previa. Un fallo revierte el gasto completo. Los gastos históricos sin foto siguen consultándose; reintentar un gasto existente recupera su registro sin duplicarlo.
- Crédito reutiliza el editor de líneas de Varios: agregar/quitar hasta 20 medios, importe independiente y referencia obligatoria por medio electrónico. El total de líneas es el abono inicial; puede ser menor o igual a la factura, nunca mayor. Cada importe debe ser positivo. Sin activar abono inicial se conserva crédito completo. Varios sigue exigiendo pago exacto.
- Se conserva el formato anterior `initial_payment`/`initial_method` para terminales anteriores. El nuevo formato usa `payments`; si también envía `initial_payment`, ambos totales deben coincidir.
- Las líneas quedan en `payments`, una sola vez por venta. Caja, cierres, reportes y cartera reutilizan sus sumas actuales. No se crean `collections` artificiales. Referencias electrónicas conservan su validación global por plataforma y la transacción completa de la venta.
- Estado de cuenta, detalle y recibos muestran cada medio. Recaudos consulta una proyección de los pagos iniciales de crédito junto con abonos posteriores (`include_initial=1`); identifica su factura, medio, referencia y fecha. No ofrece revertir una línea inicial como si fuera un abono posterior independiente. La consulta anterior sin ese parámetro conserva su contrato.
- Sin internet se admiten líneas de abono en efectivo con la reserva de ruta existente; sincronizan una sola vez. Los medios electrónicos siguen requiriendo conexión para validar referencias.

## Archivos

- `server/src/payments.js`: abono inicial con múltiples líneas y compatibilidad.
- `server/src/cash-expenses.js`, `expense-evidence.js`: obligatoriedad y validación de evidencia persistida.
- `server/src/commerce.js`: proyección del abono inicial en historial de recaudos.
- `server/src/offline-route.js`, `mobile/src/offline/route-store.js`: abono en efectivo, persistencia y sincronización.
- `mobile/src/SaleScreen.tsx`, `ExpensesScreen.tsx`, `OperationsScreen.tsx`: formularios y consulta.
- `server/scripts/correct-p35-payments.mjs`: mantenimiento de alcance único; nunca se ejecuta al iniciar ni al desplegar.
- Pruebas: `cash-route.test.js`, `offline-route.test.js`, `route-cycles-evidence.test.js`, `p35-correction.test.js`, `scripts/business-e2e.mjs`.
- Versión móvil: `mobile/app.json`, `mobile/package.json`, `package-lock.json`.

## Datos y actualización

No hay tablas, columnas ni migraciones nuevas. No se reescriben gastos o ventas históricos al desplegar. Se conserva el volumen `/data`, las evidencias privadas, usuarios, catálogo, inventario, claves y `data_generation`.

Actualizar backend desde `deploy/backend-pos`. Instalar APK 1.4.1, versionCode 18, sobre la aplicación existente usando **Actualizar**, sin desinstalar. La interfaz Android nueva requiere APK; Coolify actualiza el backend, no el código instalado en la terminal. Terminales anteriores mantienen ventas de crédito con un solo medio; al registrar un gasto nuevo, backend exige foto también en ellas.

## Corrección P-35 efectuada

La revisión de producción mostró que **$1.014.000 es el abono, no el total de la compra**. Se conservaron compra **$1.215.750**, abono **$1.014.000**, saldo **$201.750** y fecha **24/11/2026 15:37:39 Colombia**. Solo se redistribuyó el pago original: Bold **$950.000**, efectivo **$64.000**.

Se conserva el identificador y referencia del pago Bold; el efectivo se agrega como segunda línea del mismo abono, no como otro abono. Ambas líneas heredan la fecha original de la venta. Snapshot de la venta, términos, cartera, colecciones, productos, inventario y demás pagos permanecen intactos. Caja estaba abierta; sus saldos se recalculan desde pagos, sin alterar cierres ajenos. Solo se invalidaron y regeneraron los PDF de P-35 en 58/80 mm.

El script crea respaldo consistente, ensaya con fallo forzado y rollback, verifica huellas de tablas/filas ajenas, actúa en transacción y deja auditoría con distribución anterior/nueva. Rechaza repetir la corrección o actuar si cambia la factura o se cierra su caja.

Respaldo de ejecución: `/data/backups/before-p35-payment-split-2026-11-25T00-31-23.565Z.sqlite`. Auditoría: `sale.p35.initial_payment_split.authorized`. Integridad SQLite `ok`; sin errores de claves foráneas. Los dos PDF regenerados quedaron listos.

## Verificaciones

- Suite de servidor: 43 pruebas; pagos parciales y completos, medios múltiples, referencias, errores, transacciones, reintentos, saldos, caja/cierre, permisos, proyección de recaudos, evidencias e históricos, reserva/sincronización offline y corrección P-35.
- Web real contra API de prueba: flujo completo a 320/390/768/1280 px; valida no guardar gasto sin foto, carga/reintento, crédito dividido y Varios exacto.
- TypeScript y compilación Android ARM32/ARM64.
- Pendiente verificación física de cámara, instalación e impresión en Neotek; no hubo terminal conectada durante estas pruebas.
