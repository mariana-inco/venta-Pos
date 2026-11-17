# Ticket 1.3.2

La factura incluye el símbolo de WhatsApp y `3225268837`, sin leyendas de llamadas ni mensajes. Símbolo vectorial en PDF/HTML/vista previa y mapa de bits negro en la impresora integrada, ESC/POS y envío a otra H10S. El símbolo no depende de emojis ni de la codificación de la impresora. Contorno derivado de Font Awesome 4.7; licencia incluida.

En ventas nuevas, el servidor calcula y guarda `snapshot.customer_balance_cents` dentro de la misma transacción de la venta: toda la deuda previa del cliente (incluidas otras rutas históricas), más el importe de la nueva venta, menos el pago inicial. Considera abonos, reversiones y anulaciones existentes. El ticket muestra una sola línea «Saldo del cliente» cuando este importe es positivo, incluso en ventas de contado de un cliente con deuda anterior. Oculta el saldo cero, conserva el total, pagos y estado de la venta. Los precios, datos y saldo guardados no cambian en reimpresiones o reintentos.

No hay tablas ni columnas nuevas. Se agrega también `snapshot.business_whatsapp`. Las facturas anteriores conservan sus PDF guardados; si un registro antiguo no tiene saldo total guardado, sus renderizadores usan únicamente su saldo de emisión conocido, sin inventar deuda histórica. La nueva impresión nativa requiere APK 1.3.2/código 13, mismo paquete y certificado, y el backend actualizado.

## Archivos

- Backend: `service.js`, `commerce.js`, `pdf.js`, `receipt-contact.js` y licencia del símbolo.
- Android: `WhatsappContact.kt`, `InternalPrinter.kt`, `PosPrinterModule.kt`.
- Presentación: `Receipt.tsx`, `printing/contact.js`, `printing/receipt.js`, `types.ts`, `app.json`.
- Verificación: `server/test/client-receipt.test.js`.

## Verificación

29 pruebas backend, incluyendo contado con deuda previa, crédito, abonos, saldo cero, reintentos sin duplicar y reimpresión histórica. Se extrajo el texto de los PDF para comprobar presencia de número y saldo solo cuando corresponde. Los ejemplos de 58 mm se renderizaron y revisaron visualmente: icono y número legibles, una página con altura dinámica y sin cortes. TypeScript y E2E web aprobados (320/390/768/1280 px). Compilación Android ARM/ARM64 y 5 pruebas nativas de impresión. Prueba física de lector e impresión en la Neotek pendiente: no hay equipo ADB conectado.

Ejemplos: `output/recibos-1.3.2/con-saldo-58mm.pdf` y `sin-saldo-58mm.pdf`. APK: `output/dok-pollo-mc-1.3.2-neotek.apk`.

## Publicación verificada

Desplegado en Coolify el 16 de noviembre de 2026, 23:04 Colombia: `ij5yrksyez7fl8bvytx9iadu`, commit `696347823708a9cc3f41d1057347b6240845c627`, rama `deploy/backend-pos`. Contenedor saludable, actualización gradual completada y `/health` 200. Respaldo previo consistente e íntegro `/data/backups/pos-2026-11-17T04-02-32.311Z.sqlite`. Se conservaron 1 usuario, 5 productos nuevos, 4 clientes, 1 ruta y 1 grupo; sin ventas/cajas. No se volvió a ejecutar ninguna limpieza. Integridad ok y claves foráneas sin errores.

APK 1.3.2/código 13, `com.ventapos.mobile`, ABI ARM/ARM64, firma v2 verificada con el mismo certificado anterior. SHA256 `7ca5861ae5fe76fb9f6ce4b16e102f18d3d577bbb6c258b0229a33b3f197e3a0`. Instalar como actualización mediante LocalSend en cada terminal. La actualización es necesaria para el símbolo rasterizado y el nuevo formato nativo; los cambios del servidor ya están publicados.
