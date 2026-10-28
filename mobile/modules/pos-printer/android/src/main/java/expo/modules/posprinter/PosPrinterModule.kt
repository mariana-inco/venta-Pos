package expo.modules.posprinter

import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.Context
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

  override fun definition() = ModuleDefinition {
    Name("PosPrinter")
    AsyncFunction("pairedDevices") {
      val bt = adapter()
      check(bt.isEnabled) { "Activa Bluetooth en Ajustes de Android." }
      bt.bondedDevices.map { mapOf("address" to it.address, "name" to (it.name ?: it.address)) }
    }
    AsyncFunction("print") { address: String, text: String, codePage: Int, charset: String, promise: expo.modules.kotlin.Promise ->
      spool.execute {
        var socket: BluetoothSocket? = null
        try {
          require(text.length <= 100_000) { "El comprobante es demasiado largo." }
          require(codePage in listOf(0, 2, 16)) { "Tabla de caracteres no admitida." }
          require(charset in listOf("IBM437", "IBM850", "windows-1252")) { "Codificación no admitida." }
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
            val bytes = (printable + "\n\n\n").toByteArray(Charset.forName(charset))
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
    OnDestroy { spool.shutdownNow(); watchdog.shutdownNow() }
  }
}
