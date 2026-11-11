package expo.modules.posprinter

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import java.io.ByteArrayOutputStream
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.Context
import android.view.KeyEvent
import android.view.Window
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.nio.charset.Charset
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Only explicitly selected, already paired Bluetooth Classic SPP printers.
 * No discovery, automatic reconnect or print retry: a timeout may have printed paper.
 */
class PosPrinterModule : Module() {
  private val spool = Executors.newSingleThreadExecutor()
  private val watchdog = Executors.newSingleThreadScheduledExecutor()
  private val spp = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
  private fun adapter() = (appContext.reactContext?.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter
    ?: throw IllegalStateException("Este equipo no dispone de Bluetooth.")

  // ESC/POS raster: 192 dots (24 mm at 203 dpi), black silhouette on white.
  private fun rasterLogo(encoded: String): ByteArray {
    require(encoded.length <= 2_000_000) { "El logo supera el tamaño permitido." }
    val data = Base64.decode(encoded, Base64.DEFAULT)
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(data, 0, data.size, bounds)
    require(bounds.outWidth in 1..2048 && bounds.outHeight in 1..2048) { "Logo inválido." }
    val source = BitmapFactory.decodeByteArray(data, 0, data.size) ?: error("No se pudo leer el logo.")
    val width = 192
    val height = (width * source.height / source.width).coerceIn(1, 384)
    val image = Bitmap.createScaledBitmap(source, width, height, true)
    val rows = ByteArray(width / 8 * height)
    for (y in 0 until height) for (x in 0 until width) {
      val c = image.getPixel(x, y)
      val alpha = (c ushr 24) and 255
      val luma = (((c ushr 16) and 255) * 299 + ((c ushr 8) and 255) * 587 + (c and 255) * 114) / 1000
      if ((luma * alpha + 255 * (255 - alpha)) / 255 < 180) {
        val i = y * (width / 8) + x / 8
        rows[i] = (rows[i].toInt() or (0x80 ushr (x % 8))).toByte()
      }
    }
    if (image !== source) image.recycle()
    source.recycle()
    return ByteArrayOutputStream().apply {
      write(byteArrayOf(0x1b, 0x61, 1, 0x1d, 0x76, 0x30, 0, (width / 8).toByte(), 0, (height and 255).toByte(), (height ushr 8).toByte()))
      write(rows)
      write(byteArrayOf(0x0a, 0x1b, 0x61, 0))
    }.toByteArray()
  }

  private var scannerWindow: Window? = null
  private var originalCallback: Window.Callback? = null
  private var scannerCallback: Window.Callback? = null
  private fun scanner(enabled: Boolean) {
    val activity = appContext.currentActivity ?: return
    activity.runOnUiThread {
      if (!enabled) {
        if (scannerWindow?.callback === scannerCallback) scannerWindow?.callback = originalCallback
        scannerWindow = null; originalCallback = null; scannerCallback = null
      } else if (scannerCallback == null) {
        val window = activity.window
        val original = window.callback
        val consumed = mutableSetOf<Int>()
        var buffer = StringBuilder()
        var lastKey = 0L
        val callback = object : Window.Callback by original {
          override fun dispatchKeyEvent(event: KeyEvent): Boolean {
            // Hardware wedge only. Touch keyboard/IME input remains available for quantities.
            if (event.flags and KeyEvent.FLAG_SOFT_KEYBOARD != 0 || event.isCtrlPressed || event.isAltPressed) return original.dispatchKeyEvent(event)
            if (event.action == KeyEvent.ACTION_UP && consumed.remove(event.keyCode)) return true
            if (event.action != KeyEvent.ACTION_DOWN) return original.dispatchKeyEvent(event)
            val char = event.unicodeChar
            if (event.keyCode == KeyEvent.KEYCODE_ENTER || event.keyCode == KeyEvent.KEYCODE_NUMPAD_ENTER || event.keyCode == KeyEvent.KEYCODE_TAB) {
              if (buffer.isEmpty()) return original.dispatchKeyEvent(event)
              val code = buffer.toString(); buffer = StringBuilder()
              consumed.add(event.keyCode)
              sendEvent("barcodeScan", mapOf("code" to code))
              return true
            }
            if (char in 32..126) {
              if (event.eventTime - lastKey > 2000) buffer = StringBuilder()
              lastKey = event.eventTime
              if (buffer.length < 80) buffer.append(char.toChar()) else buffer = StringBuilder()
              consumed.add(event.keyCode)
              return true
            }
            return original.dispatchKeyEvent(event)
          }
        }
        originalCallback = original; scannerCallback = callback; scannerWindow = window
        window.callback = callback
      }
    }
  }

  override fun definition() = ModuleDefinition {
    Name("PosPrinter")
    Events("barcodeScan")
    AsyncFunction("setScannerEnabled") { enabled: Boolean -> scanner(enabled) }
    AsyncFunction("pairedDevices") {
      val bt = adapter()
      check(bt.isEnabled) { "Activa Bluetooth en Ajustes de Android." }
      bt.bondedDevices.map { mapOf("address" to it.address, "name" to (it.name ?: it.address)) }
    }
    AsyncFunction("print") { address: String, text: String, codePage: Int, charset: String, logo: String, promise: expo.modules.kotlin.Promise ->
      spool.execute {
        var socket: BluetoothSocket? = null
        try {
          require(text.length <= 100_000) { "El comprobante es demasiado largo." }
          require(codePage in listOf(0, 2, 16)) { "Tabla de caracteres no admitida." }
          require(charset in listOf("IBM437", "IBM850", "windows-1252")) { "Codificación no admitida." }
          val logoBytes = if (logo.isNotEmpty()) rasterLogo(logo) else byteArrayOf()
          val bt = adapter()
          check(bt.isEnabled) { "Activa Bluetooth." }
          val device = bt.bondedDevices.firstOrNull { it.address == address }
            ?: throw IllegalStateException("Empareja esta impresora desde Ajustes de Android.")
          socket = device.createRfcommSocketToServiceRecord(spp)
          val connection = socket
          val timeout = watchdog.schedule({ try { connection.close() } catch (_: Exception) {} }, 25, TimeUnit.SECONDS)
          try {
            connection.connect()
            val output = connection.outputStream
            output.write(byteArrayOf(0x1b, 0x40, 0x1b, 0x74, codePage.toByte()))
            // Strip control bytes supplied by product/customer text; only LF is printable formatting.
            val printable = text.filter { it == '\n' || it.code >= 32 && it.code != 127 }
            val bytes = logoBytes + (printable + "\n\n\n").toByteArray(Charset.forName(charset))
            for (chunk in bytes.asList().chunked(512)) {
              output.write(chunk.toByteArray()); output.flush(); Thread.sleep(40)
            }
            promise.resolve(null)
          } finally { timeout.cancel(false) }
        } catch (error: Exception) {
          promise.reject("PRINT_FAILED", error.message ?: "No se pudo enviar el ticket.", error)
        } finally { try { socket?.close() } catch (_: Exception) {} }
      }
    }
    OnDestroy { scanner(false); spool.shutdownNow(); watchdog.shutdownNow() }
  }
}
