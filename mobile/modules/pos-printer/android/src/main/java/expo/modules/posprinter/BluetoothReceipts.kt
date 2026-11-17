package expo.modules.posprinter

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothServerSocket
import android.bluetooth.BluetoothSocket
import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import org.json.JSONObject
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** App-to-app transport. Deliberately different from the SPP UUID of external ESC/POS printers. */
class BluetoothReceipts(private val context: Context, private val adapter: () -> BluetoothAdapter, private val printer: InternalPrinter) {
  companion object { val SERVICE: UUID = UUID.fromString("6a23b308-d9bb-44f8-b3f6-7be2b27f4e11") }
  private val timer = Executors.newSingleThreadScheduledExecutor()
  @Volatile private var server: BluetoothServerSocket? = null
  @Volatile private var current: BluetoothSocket? = null
  @Volatile private var lastError: String? = null
  @Volatile private var received = 0
  private val ledger: SQLiteDatabase by lazy {
    context.openOrCreateDatabase("pos-bluetooth-receipts.sqlite", Context.MODE_PRIVATE, null).apply {
      execSQL("CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, state TEXT NOT NULL, created_at INTEGER NOT NULL)")
    }
  }

  fun status(): Map<String, Any?> = mapOf("active" to (server != null), "internalAvailable" to printer.available(), "received" to received, "error" to lastError)

  @Synchronized fun start(): Map<String, Any?> {
    if (server != null) return status()
    check(printer.available()) { "Este equipo no tiene el servicio de impresión H10S." }
    printer.version() // Verify binding before advertising a printer that cannot be used.
    val bt = adapter()
    check(bt.isEnabled) { "Activa Bluetooth en Ajustes de Android." }
    val listener = bt.listenUsingRfcommWithServiceRecord("DOK POLLO MC H10S", SERVICE)
    lastError = null
    server = listener
    Thread({
      try {
        while (server === listener) {
          val socket = listener.accept()
          current = socket
          val timeout = timer.schedule({ try { socket.close() } catch (_: Exception) {} }, 30, TimeUnit.SECONDS)
          try {
            check(bt.bondedDevices.any { it.address == socket.remoteDevice.address }) { "Empareja primero los dos equipos en Ajustes de Android." }
            val request = JSONObject(ReceiptFrames.read(socket.inputStream))
            val response = receive(request)
            ReceiptFrames.write(socket.outputStream, response.toString())
          } catch (error: Exception) {
            lastError = error.message ?: "No se pudo recibir el ticket."
            try { ReceiptFrames.write(socket.outputStream, JSONObject().put("status", "error").put("message", lastError).toString()) } catch (_: Exception) {}
          } finally { timeout.cancel(false); try { socket.close() } catch (_: Exception) {}; current = null }
        }
      } catch (error: Exception) {
        if (server === listener) lastError = error.message ?: "La recepción Bluetooth se detuvo."
      } finally {
        synchronized(this) { if (server === listener) server = null }
        try { listener.close() } catch (_: Exception) {}
      }
    }, "pos-h10s-receiver").start()
    return status()
  }

  /** Reserve durably BEFORE printing. An interrupted or partially printed job is never replayed. */
  private fun receive(request: JSONObject): JSONObject {
    require(request.getInt("version") == 1) { "Actualiza Venta POS en ambos equipos." }
    val id = request.getString("id")
    require(id == UUID.fromString(id).toString()) { "Identificador de impresión inválido." }
    val text = request.getString("text")
    val logo = request.optString("logo", "")
    require(text.isNotBlank() && text.length <= 100_000 && logo.length <= 500_000) { "Ticket inválido." }
    val fingerprint = MessageDigest.getInstance("SHA-256").digest((text + "\u0000" + logo).toByteArray()).joinToString("") { "%02x".format(it) }
    val reply = JSONObject().put("id", id)
    ledger.rawQuery("SELECT fingerprint,state FROM jobs WHERE id=?", arrayOf(id)).use { rows ->
      if (rows.moveToFirst()) {
        require(rows.getString(0) == fingerprint) { "Este envío ya existe con otro contenido." }
        val state = rows.getString(1)
        return reply.put("status", state).put("message", if (state == "sent") "Envío ya recibido; no se repitió." else "No se confirmó la impresión anterior. Revisa el papel antes de reimprimir.")
      }
    }
    ledger.insertOrThrow("jobs", null, ContentValues().apply {
      put("id", id); put("fingerprint", fingerprint); put("state", "unknown"); put("created_at", System.currentTimeMillis())
    })
    try {
      printer.print(text, logo)
      ledger.execSQL("UPDATE jobs SET state='sent' WHERE id=?", arrayOf(id))
      received++
      lastError = null
      return reply.put("status", "sent")
    } catch (error: Exception) {
      lastError = error.message ?: "No se confirmó la impresión."
      return reply.put("status", "unknown").put("message", lastError + " Revisa el papel antes de reimprimir.")
    }
  }

  fun send(address: String, id: String, text: String, logo: String) {
    val bt = adapter()
    check(bt.isEnabled) { "Activa Bluetooth." }
    val device = bt.bondedDevices.firstOrNull { it.address == address } ?: error("Empareja el celular y la Neotek desde Ajustes de Android.")
    val socket = device.createRfcommSocketToServiceRecord(SERVICE)
    val timeout = timer.schedule({ try { socket.close() } catch (_: Exception) {} }, 30, TimeUnit.SECONDS)
    try {
      val request = JSONObject().put("version", 1).put("id", id).put("text", text).put("logo", InternalPrinter.compactLogo(logo))
      socket.connect()
      ReceiptFrames.write(socket.outputStream, request.toString())
      val reply = JSONObject(ReceiptFrames.read(socket.inputStream, 4096))
      check(reply.optString("id") == id && reply.optString("status") == "sent") { reply.optString("message", "La Neotek no confirmó el envío.") }
    } catch (error: Exception) {
      throw IllegalStateException("No se confirmó el envío a la Neotek. Mantén «Recibir tickets» activo en ella y revisa el papel antes de volver a imprimir. " + (error.message ?: ""), error)
    } finally { timeout.cancel(false); try { socket.close() } catch (_: Exception) {} }
  }

  @Synchronized fun stop() {
    val listener = server; server = null
    try { listener?.close() } catch (_: Exception) {}
    try { current?.close() } catch (_: Exception) {}
  }
  fun close() { stop(); timer.shutdownNow() }
}
