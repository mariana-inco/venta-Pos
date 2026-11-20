# Historial de ventas del vendedor — 1.3.4

Rama `deploy/backend-pos`. Vendedor consulta únicamente sus ventas del día actual de Colombia (UTC−5). Administrador conserva todos los días y todos los vendedores.

## Cambios

- `server/src/app.js`: listado, paginación, conteos y agrupaciones siempre acotados a usuario y jornada actual para vendedores, aun si solicitan otro rango o caja. Administrador conserva sus filtros.
- `server/src/service.js`: detalle y PDF de ventas de otros días rechazados para vendedor; no basta conocer el ID. Venta ajena sigue bloqueada.
- `mobile/src/HistoryScreen.tsx`: vendedor sin Hoy/Ayer/7 días/Todo ni selector de fechas; conserva cliente y medio de pago. Informa que solo puede consultar hoy y retira datos anteriores al cambiar la jornada o volver a primer plano. Administrador conserva historial completo.
- `mobile/src/offline/store.js`: misma restricción por usuario/día para consultas de registros guardados en Android. No se borran registros ni colas.
- No hay migraciones ni borrado de datos. Cuentas por cobrar y abonos conservan su acceso operativo a deudas anteriores; la restricción se aplica al historial/detalle/PDF del módulo Ventas. Los comprobantes ya exportados fuera de la app no se revocan.

## Verificación

- `npm test`: 33 aprobadas. Prueba nueva en `server/test/seller-today.test.js`: medianoche Colombia, filtros manipulados, cajas de otros días, vendedor ajeno, detalle/PDF, conteos/agrupaciones, caché Android y cambio de jornada; administrador conserva históricos.
- `npm run check`: TypeScript correcto.
- `npm run test:e2e`: correcto, incluyendo ausencia de fechas para vendedor y filtros históricos disponibles para administrador; flujos anteriores en 320/390/768/1280 px.
- Android 1.3.4, versionCode 15, paquete y firma anteriores. APK `output/dok-pollo-mc-1.3.4-neotek.apk`. Instalar como Actualizar, sin desinstalar. Backend aplica la restricción también a APK anteriores; actualizar APK retira los filtros antiguos y ajusta la caché local.
- Pendiente: instalación física en Neotek (sin dispositivo conectado).

APK compilado y firma v2 verificada (mismo certificado SHA256 `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`). SHA256 del archivo: `9ba44c93ff4c7f830b34e27fbbac8223e056b3d4531ecc8c4907b26b5ccd42da`.

Desplegado en Coolify: `qcxvohiraqpmpjmezqpt88pv`, commit `5e48324af9735c0fd937af5ecad022a7e998ee68`, 20/11/2026 08:05:47 Colombia. Contenedor saludable `0sxtn0nojcnijnl1dxn7rmev-20261120T130506`; `/health` HTTP200. Verificación autenticada en producción: administrador conserva históricos; vendedor no obtiene ventas anteriores aun con fechas manipuladas, detalle/PDF de una venta anterior HTTP403. Integridad y relaciones OK. Sin operaciones comerciales de prueba ni eliminación de registros; sesiones diagnósticas temporales retiradas.
