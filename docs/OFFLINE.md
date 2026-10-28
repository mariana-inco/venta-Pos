# Operación Android sin conexión y sincronización

Implementación del 28 de octubre de 2026. La web sigue siendo un cliente conectado a la API. El APK Android tiene una base SQLite propia y puede operar sin conexión después de descargar su primer catálogo.

## Componentes

- `server/`: servicio Node 24 independiente. Se puede instalar y arrancar sin `mobile/`. Incluye lockfile propio, Dockerfile, healthcheck y configuración Railway.
- `mobile/src/offline/store.js`: reglas locales, transacciones SQLite, catálogo, clientes, cajas, ventas, cierres y cola de envío. Se prueba con SQLite real en Node.
- `mobile/src/offline/runtime.native.ts`: adaptador expo-sqlite, credenciales en SecureStore, sincronización y tareas Android.
- `server/src/sync.js`: registro de dispositivos, catálogos versionados y recepción idempotente.
- `mobile/modules/pos-printer/`: módulo nativo Android de Bluetooth Classic SPP/RFCOMM y ESC/POS.

## Primer acceso y sesiones

El primer acceso de cada usuario al dispositivo requiere internet. Se valida la contraseña, registra el dispositivo, guarda su autorización de sincronización en SecureStore y descarga el catálogo. La aplicación no declara completado ese acceso si falla la descarga.

Después se puede cerrar y abrir la aplicación sin conexión: restaura la sesión local. La contraseña no se guarda en el equipo. Cerrar sesión explícitamente exige volver a autenticarse con conexión para iniciar otra sesión. Los datos y la cola nunca se borran al salir.

El token de sesión web de 12 horas y la autorización del dispositivo son distintos. Vencer la sesión web no elimina ni interrumpe por sí solo la cola del dispositivo. El administrador puede revocar equipos en Perfil → Dispositivos y conciliación. Desactivar un usuario o restablecer su contraseña también revoca sus autorizaciones. Un equipo desconectado solo puede conocer una revocación cuando vuelve a contactar al servidor; al conocerla bloquea nuevas operaciones de ese usuario y conserva las anteriores para revisión/reautorización.

SQLite se almacena en el directorio privado de la aplicación, en un archivo separado por URL de API. No se incluye en Android Auto Backup para evitar clonar la identidad y el contador del dispositivo. Desinstalar, borrar datos o perder el equipo antes de sincronizar puede perder ventas que aún no llegaron al servidor. No restaure una copia antigua de SQLite sobre una instalación activa.

## Venta y ticket locales

Confirmar una venta realiza una única transacción: valida productos y existencias locales, calcula importes con enteros, guarda el detalle histórico y agrega el evento a la cola. Si la escritura falla, no queda una venta sin cola ni una cola sin venta.

Cada operación tiene un UUID inmutable y un número de secuencia del dispositivo. El ticket usa `UUID-dispositivo/secuencia`. Su identificador impreso no cambia después de sincronizar. La nube asigna además su consecutivo de consulta central. Una reimpresión usa siempre la misma venta.

Los catálogos descargados incluyen una versión de contenido conservada por el servidor. La venta hace referencia a esa versión: la nube recalcula con sus precios históricos, no con los actuales ni con un total arbitrario enviado por el teléfono. Un producto desactivado o con precio cambiado mientras el equipo estaba desconectado no invalida una venta emitida con un catálogo previamente autorizado; se registra una observación de conciliación.

Los clientes nuevos también se guardan localmente y se envían antes de sus ventas. Dos dispositivos pueden crear clientes con igual nombre y distinto UUID: no se fusionan automáticamente identidades por coincidencia de texto.

## Sincronización

Se intenta cada 30 segundos mientras la aplicación está activa, al volver al primer plano y al recibir una señal de conexión. Hay un botón Sincronizar ahora en Perfil. Además se registra una tarea de fondo con intervalo mínimo de 15 minutos; Android decide cuándo puede ejecutarla. La app no promete sincronizar a una hora exacta si el sistema la suspende, la detiene el usuario o limita su batería.

La cola es global al dispositivo y mantiene el orden de operaciones de todos sus usuarios: cliente, apertura, ventas, cierre y aclaraciones. Cada evento se envía con la autorización de quien lo creó. Un cierre administrativo no puede adelantarse a una venta pendiente del vendedor.

La nube exige la siguiente secuencia y tiene restricciones únicas por `(device_id, event_id)` y `(device_id, sequence)`. Aceptación, venta, inventario, auditoría y avance de secuencia se guardan en una transacción. Reenviar el mismo contenido devuelve el resultado guardado; reutilizar su identidad con otro contenido produce un conflicto. Cada evento del lote tiene su propia transacción para poder reintentar prefijos ya aceptados.

El celular marca enviado solo tras recibir confirmación explícita. Si cae la red después del commit remoto, vuelve a enviar la misma operación. Un HTTP 401/403, un conflicto o un error de servidor conserva la cola. Los conflictos se muestran y detienen las operaciones posteriores de ese dispositivo: no se saltan ventas ni se inventan números para continuar.

Después del envío se obtiene el catálogo actual. Su `ack_sequence` indica qué ventas ya están incluidas en las existencias de nube; las ventas posteriores siguen descontándose localmente. Esto evita tanto descontar dos veces como restaurar stock al recibir una respuesta vieja.

## Cajas

Una caja abierta por vendedor **y dispositivo**. Un mismo vendedor puede trabajar desde dos equipos; cada uno tiene su propia caja. Las cajas web mantienen el ámbito anterior sin dispositivo.

Solo el propietario vende en su caja. El administrador puede cerrar cualquier caja que esté en el dispositivo donde inició sesión. Las cajas móviles se cierran desde su equipo de origen, incluso sin conexión, y se sincronizan después de todas sus ventas. La API bloquea las ventas web y los cierres remotos sobre cajas móviles abiertas: no puede afirmar que conoce todas las ventas de un celular desconectado.

La conciliación local incluye base, efectivo y electrónicos. El cierre congela la caja y es definitivo; no admite ventas posteriores. El servidor vuelve a verificar el número de ventas y la conciliación antes de aceptar el cierre.

Las pantallas Android consultan ventas y cajas de ese dispositivo. La web permite al administrador consultar la consolidación de todos los equipos una vez recibida. Las altas/ediciones administrativas del catálogo, usuarios y configuración central requieren conexión.

## Inventario distribuido

El stock local es orientativo respecto al conjunto de equipos. Dos equipos sin comunicación pueden vender la misma última unidad. La aplicación evita exceder la disponibilidad que conoce localmente, pero no puede reservar existencias globales sin conexión.

Al consolidar, la nube conserva ambas ventas ya emitidas. Si el saldo resulta negativo registra la deuda de inventario y un aviso; las existencias efectivas muestran el faltante. Perfil → Dispositivos y conciliación permite revisar esas diferencias. Un administrador realiza recuento y ajuste explícito en Catálogo. Los avisos originales permanecen en la auditoría.

Las ediciones de catálogo desde la app incluyen la versión/stock que se estaba editando para evitar reponer accidentalmente unidades vendidas desde otro equipo. Un producto ya descargado no puede cambiar de unidad: debe crearse otro.

## Impresión

En Perfil → Impresora Bluetooth seleccione un dispositivo emparejado en Ajustes de Android, papel de 58 o 80 mm y tabla de caracteres. Se propone PC850 y 58 mm para la ficha suministrada. Ejecute la prueba de impresión y compruebe acentos, ñ y valores antes de operar.

El APK incluye el módulo nativo; Expo Go y el navegador no lo incluyen. Android 12 o posterior solicita permiso para conectar dispositivos cercanos. No se hace descubrimiento de dispositivos, no se solicita ubicación y no se imprime automáticamente en cualquier equipo encontrado.

El envío a la impresora se serializa y tiene límite de tiempo. No se reintenta automáticamente después de un fallo: el papel podría haberse impreso parcialmente. El historial de trabajos local conserva estado enviado/desconocido. El mensaje de éxito acredita el envío del flujo de bytes, no un sensor de papel ni una confirmación física de impresión.

La copia HTML/PDF local también se genera desde el ticket guardado sin pedirlo al servidor. La versión Bluetooth es texto ESC/POS y no incluye el logo raster del PDF de nube.

**Hardware pendiente:** la imagen recibida describe un terminal Android 2 GB/32 GB con impresora integrada de 58 mm; no contiene fabricante, modelo, versión de Android ni protocolo de la impresora. Esta implementación cubre impresoras Bluetooth Classic SPP que acepten ESC/POS. Una impresora interna por SDK, USB, serie o BLE necesita su adaptador específico. No se ha probado impresión física ni se afirma compatibilidad con ese terminal sin identificarlo.

## Construcción y prueba

```sh
npm ci
npm test
npm run check
npm run test:offline
npm run test:e2e

# APK para una API de nube ya desplegada
EXPO_PUBLIC_API_URL=https://tu-api.example npm run build:android

# Prueba local explícita (HTTP habilitado solo en este build)
POS_ALLOW_HTTP=1 EXPO_PUBLIC_API_URL=http://localhost:4317 npm run build:android
```

El script local requiere JDK 17, Android SDK y herramientas de compilación; detecta sus ubicaciones habituales en macOS. El APK local en `output/dannys-pos-preview.apk` tiene el JavaScript incluido y firma de desarrollo: sirve para pruebas internas. Para distribución, use EAS y credenciales de firma propias. `EXPO_PUBLIC_API_URL` se incorpora al compilar; cambie la URL y reconstruya para otra nube. No guarde secretos en variables `EXPO_PUBLIC_*`.

Con un Android conectado por USB, `adb reverse tcp:4317 tcp:4317` permite probar el APK local contra la API del computador. Para Wi-Fi debe compilar con la IP LAN del servidor, abrir `HOST=0.0.0.0` y usar una red de confianza. La web sigue en `npm run dev` y requiere conexión.

Prueba de aceptación: autenticar y descargar catálogo; desconectar la red; crear cliente, abrir caja y vender; imprimir; forzar cierre y volver a abrir el APK; comprobar que siguen el ticket y su pendiente; restaurar conexión; verificar una sola venta central; repetir en dos celulares y revisar un eventual faltante de stock; cerrar localmente y confirmar el cierre central. Probar papel agotado y desconexión Bluetooth sin volver a crear ventas.
