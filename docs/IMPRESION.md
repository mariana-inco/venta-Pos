# Impresión actual: Android offline

El módulo Bluetooth Classic SPP/ESC-POS ya está implementado en `mobile/modules/pos-printer`. Lee tickets guardados en SQLite local y no requiere internet. Configuración, límites y prueba física en [OFFLINE.md](OFFLINE.md#impresión).

La ficha enviada el 28 de octubre indica un terminal con impresora integrada de **58 mm**, sin identificar marca ni modelo. No confirma que su impresora interna use Bluetooth ni ESC/POS; se requiere el SDK o protocolo del fabricante para asegurar compatibilidad. La selección Bluetooth actual corresponde a equipos ya emparejados.

El resto del documento conserva el diseño y la investigación de la versión inicial. Las referencias a una MTP-3 de 80 mm y a una integración propuesta son antecedentes, no la identificación del hardware actual.

# Impresión y prueba real

Configuración confirmada por el usuario: celular Android e impresora con papel de 80 mm. Este es el ancho predeterminado para nuevas instalaciones. Impresora indicada por el usuario: genérica, modelo MTP-3. La variante de hardware, firmware y transporte Bluetooth aún requieren prueba.

## Diseño del comprobante

El comprobante incluye el logo oficial en versión de impresión (`server/assets/dannys-logo-print.png`, escala de grises sobre blanco generada desde el original con `scripts/logo-print.mjs`), nombre comercial, solo los datos fiscales configurados (NIT, dirección, ciudad, teléfono), número corto de venta (`#0025`), fecha y hora separadas, vendedor, caja corta (`#3`, en vez del UUID), cliente y ciudad. Cada producto muestra su nombre en mayúsculas y, debajo, `cantidad × precio` a la izquierda y el subtotal a la derecha; si no caben en una línea, el subtotal baja alineado a la derecha. Total resaltado entre líneas dobles, método de pago y el aviso “Comprobante de venta. No es factura electrónica.” Sin fondos oscuros.

Márgenes laterales calculados para el área imprimible habitual: 5 mm en papel de 58 mm (48 mm útiles) y 4 mm en papel de 80 mm (72 mm útiles). La app muestra una vista previa con los datos guardados de la venta antes de imprimir. Los datos del negocio se congelan en la venta: editarlos después no cambia los comprobantes ya emitidos, y los PDF guardados de ventas anteriores conservan su diseño original.

La API genera PDF con texto seleccionable mediante PDFKit. El ancho físico es exactamente 58 o 80 mm (164,409 o 226,772 puntos); la altura depende del contenido. Los tickets extensos se dividen si superan el límite de página PDF. No se crean hojas carta. Las copias de cierre usan el snapshot original, sin recalcular ni incorporar modificaciones posteriores del negocio.

En Android/iOS se descarga el archivo con autenticación y se entrega a expo-sharing o expo-print. Abrir/guardar muestra el selector del sistema para elegir visor, Archivos o una aplicación compatible. En web se descarga el archivo, que se abre con el visor PDF del navegador.

La generación de PDF no establece comunicación Bluetooth con una impresora. expo-print usa servicios de impresión del sistema: AirPrint en iOS y el servicio de impresión instalado en Android. Una impresora Bluetooth SPP/ESC/POS puede necesitar la app del fabricante o un módulo nativo.

## Integración propuesta para la MTP-3 genérica

El manual original de la familia MTP-3 describe comandos ESC/POS y conexión Bluetooth para Android. Esto orienta la integración, pero no demuestra que todas las variantes genéricas tengan el mismo firmware, ancho imprimible o transporte. No se identifica esta unidad como GOOJPRT sin comprobar la etiqueta.

La ruta propuesta es Bluetooth Classic SPP/RFCOMM con comandos ESC/POS, condicionada a que la unidad real exponga ese servicio. Si solo ofrece BLE, se necesitará el servicio y la característica GATT documentados por su proveedor; no enviar comandos a una característica arbitraria.

Para el proyecto Expo, usar un módulo nativo Android que liste dispositivos ya emparejados, permita seleccionar la impresora explícitamente y mantenga una cola de impresión. La biblioteca Android DantSu/ESCPOS-ThermalPrinter-Android es una candidata para ese módulo; su integración debe compilarse y probarse con la versión actual de Expo. Se requiere un APK propio o development build para incluirlo; la función actual de expo-print no es un transporte ESC/POS.

En Android 12+ solicitar BLUETOOTH_CONNECT al acceder a dispositivos emparejados. Emparejar desde Ajustes de Android permite evitar descubrimiento dentro de la aplicación y sus permisos adicionales. Si se implementa búsqueda interna, declarar y solicitar BLUETOOTH_SCAN según la documentación Android.

La impresión directa leerá el detalle de una venta/cierre ya confirmado por la API y enviará su contenido histórico a la impresora. Un fallo o reintento de impresión nunca creará una venta nueva. No se debe presentar un envío Bluetooth como impresión física confirmada cuando la impresora no devuelve ese estado.

Configurar el ancho imprimible y la tabla de caracteres desde el autotest real: papel de 80 mm no implica 80 mm imprimibles. Probar acentos, ñ, valores, productos por kg, alimentación y observaciones. No activar corte automático sin comprobar que la impresora tiene cortador.

Estado: modelo documentado e integración definida; módulo Bluetooth, APK y prueba en esta unidad física pendientes. La aplicación conserva la generación PDF y la impresión mediante servicios Android que ya estaban implementadas.

## Prueba con la unidad física

1. Identificar modelo, firmware, ancho, resolución (por ejemplo 203 dpi), protocolo, Bluetooth Classic SPP o BLE, y soporte Android/iOS.
2. Si el fabricante acepta PDF, compartir a su app e imprimir al 100 %, sin ajustar a carta.
3. Para ESC/POS directo, integrar un adaptador nativo y crear un development build de Expo. Expo Go no incorpora módulos Bluetooth arbitrarios. Android 12+ requiere permisos Bluetooth correspondientes. iOS no admite cualquier dispositivo SPP; comprobar BLE/MFi y SDK del fabricante.
4. El adaptador debe convertir el recibo a comandos compatibles, controlar caracteres españoles, ancho de columnas, alimentación y corte según soporte del modelo. Nunca debe registrar otra venta al reintentar una impresión.

## Protocolo de aceptación

- Descargar una venta y un cierre en ambos anchos.
- Abrir cada PDF y verificar texto, acentos, total, cliente y diferencias con los registros de la API.
- Imprimir con escala 100 % en la impresora real; comprobar márgenes, tamaño de fuente, recorte, longitud y orientación.
- Probar compartir/guardar, impresora desconectada y reimpresión de una venta/cierre histórico.
- Registrar marca/modelo, sistema del celular, servicio de impresión, ancho y resultado.

Estado actual: PDF generados y revisados visualmente en 58/80 mm. Prueba de impresión física y Bluetooth no realizada: se indicó el modelo MTP-3 genérico, pero no hay acceso a la unidad física.

Referencias: https://docs.expo.dev/versions/v58.0.0/sdk/print/ y https://docs.expo.dev/versions/latest/sdk/sharing/.

## Fuentes para la integración

- [Manual original de la familia MTP-3](https://ae01.alicdn.com/kf/S55918724c77144889e36e53322da7f7c1.pdf). La aplicabilidad exacta a la unidad genérica del usuario está pendiente de comprobar.
- [Permisos Bluetooth de Android](https://developer.android.com/develop/connectivity/bluetooth/bt-permissions).
- [Biblioteca Android ESC/POS de DantSu](https://github.com/DantSu/ESCPOS-ThermalPrinter-Android).
- [Development builds de Expo](https://docs.expo.dev/develop/development-builds/introduction/).

## Actualización Neotek H10S

### Envío desde otro Android por Bluetooth (1.2.1)

La H10S conectada por USB se identificó como Android H10S y tiene instalado `recieptservice.com.recieptservice` 8.3.6. Se contrastaron descriptor, firmas y primeros once códigos de transacción AIDL con el APK instalado. El módulo ahora puede enlazar ese servicio para imprimir texto Unicode y logo y recibir comprobantes desde otro Android. Esto acredita el servicio de esta unidad; no identifica todos los firmwares vendidos como Neotek.

1. Actualizar **los dos equipos** al APK 1.2.1 o superior, conservando los datos.
2. Emparejar el celular y la H10S en Ajustes de Bluetooth de Android; aceptar el código en ambos.
3. En la H10S: Perfil → **Recibir tickets por Bluetooth** → **Activar recepción**. Mantener Venta POS abierta. La app mantiene la pantalla encendida; al salir de ella o bloquear el equipo se detiene la recepción y hay que activarla de nuevo.
4. En el celular: Perfil → Impresión → **Neotek por Bluetooth** → **Ver equipos emparejados** → seleccionar la H10S → **Imprimir prueba**.
5. Para imprimir directamente desde la H10S, seleccionar **Integrada H10S**. La opción **Impresora externa** conserva el transporte SPP/ESC-POS anterior.

El enlace entre los Android usa RFCOMM seguro con un UUID propio y acepta equipos previamente emparejados. No requiere Wi-Fi, datos móviles ni servidor para transportar el ticket. Los comprobantes de venta guardados en el celular se leen de su caché local antes de consultar la API; si el documento solo existe en el servidor, sigue siendo necesaria la conexión para obtenerlo. Esta mejora de impresión no cambia las reglas de conexión de ventas por ruta, cartera o consulta de datos.

Cada envío lleva un UUID y una huella del contenido. La H10S registra el trabajo en SQLite antes de tocar papel; el mismo UUID no se vuelve a imprimir, incluso tras reiniciar la app. Una interrupción conserva estado desconocido. No hay reintentos automáticos: comprobar el papel antes de solicitar una nueva impresión. «Enviado» significa que el servicio aceptó los comandos, no que un sensor haya confirmado la salida física. El logo se reduce a 192 puntos antes de viajar por Bluetooth.

Verificación: compilación release Android, comprobación TypeScript y cinco pruebas JVM del protocolo (Unicode, mensajes consecutivos, límites y truncamiento). En la H10S se verificaron actualización con la misma firma y conservación de sesión, detección del servicio y activación real del receptor. El usuario confirmó que la prueba física con logo, acentos y texto salió y se lee bien.

El Samsung SM-S928B (Android 17) se actualizó de 1.1.5 a 1.2.1 sin desinstalar y conservó la sesión de vendedor. Se seleccionó la H10S emparejada en **Neotek por Bluetooth**. Se envió una prueba con Wi-Fi y datos móviles apagados; la app mostró «Prueba enviada a la impresora» y el usuario confirmó que el nuevo ticket salió y se lee bien en la H10S. Se restauraron los datos móviles a su estado anterior (Wi-Fi ya estaba apagado). Ambas instalaciones quedaron configuradas. Esta prueba acredita el transporte Bluetooth y la salida física, sin crear una venta; no amplía las reglas offline del resto de la aplicación.

APK: `output/dok-pollo-mc-1.2.1-neotek-bluetooth.apk` (versionCode 9), SHA-256 `2f2e182d2ec711f2a9b94c19aa7d465d75eb9a34151044ac019fe616d6dff7f3`.

El diagnóstico previo, antes de conectar esta unidad por USB, está en [ACTUALIZACION-H10S.md](ACTUALIZACION-H10S.md). El PDF por ruta conserva 58 mm físicos y altura dinámica. La integración 1.2.1 descrita arriba incorpora el servicio interno identificado en esta unidad; otras variantes de firmware requieren comprobarlo de nuevo.
