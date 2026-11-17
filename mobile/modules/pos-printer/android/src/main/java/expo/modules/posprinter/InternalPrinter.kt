package expo.modules.posprinter

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.os.IBinder
import android.util.Base64
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.io.ByteArrayOutputStream
import recieptservice.com.recieptservice.PrinterInterface

/** H10S internal service; no Bluetooth pairing is involved. Called off the UI thread. */
class InternalPrinter(private val context: Context) {
  companion object {
    private fun logoBitmap(logo: String): Bitmap {
      require(logo.length <= 2_000_000) { "Logo demasiado grande." }
      val data = Base64.decode(logo, Base64.DEFAULT)
      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeByteArray(data, 0, data.size, bounds)
      require(bounds.outWidth in 1..2048 && bounds.outHeight in 1..2048) { "Logo inválido." }
      val source = BitmapFactory.decodeByteArray(data, 0, data.size) ?: error("Logo inválido.")
      val height = (192 * source.height / source.width).coerceIn(1, 384)
      val scaled = Bitmap.createScaledBitmap(source, 192, height, true)
      val white = Bitmap.createBitmap(192, height, Bitmap.Config.ARGB_8888)
      Canvas(white).apply { drawColor(Color.WHITE); drawBitmap(scaled, 0f, 0f, null) }
      if (scaled !== source) scaled.recycle()
      source.recycle()
      return white
    }
    fun compactLogo(logo: String): String {
      if (logo.isBlank()) return ""
      val bitmap = logoBitmap(logo)
      return try {
        val bytes = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.PNG, 100, bytes)
        Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP)
      } finally { bitmap.recycle() }
    }
  }
  fun available(): Boolean = try {
    context.packageManager.getPackageInfo("recieptservice.com.recieptservice", 0)
    true
  } catch (_: Exception) { false }

  private fun <T> connected(work: (PrinterInterface) -> T): T {
    val ready = CountDownLatch(1)
    var printer: PrinterInterface? = null
    val connection = object : ServiceConnection {
      override fun onServiceConnected(name: ComponentName, binder: IBinder) {
        printer = PrinterInterface.Stub.asInterface(binder); ready.countDown()
      }
      override fun onServiceDisconnected(name: ComponentName) { printer = null }
      override fun onNullBinding(name: ComponentName) { ready.countDown() }
    }
    val intent = Intent().setComponent(ComponentName("recieptservice.com.recieptservice", "recieptservice.com.recieptservice.service.PrinterService"))
    check(context.bindService(intent, connection, Context.BIND_AUTO_CREATE)) { "No se pudo abrir el servicio de la impresora H10S." }
    try {
      check(ready.await(8, TimeUnit.SECONDS)) { "La impresora H10S no respondió." }
      return work(checkNotNull(printer) { "El servicio de impresión no está disponible." })
    } finally { context.unbindService(connection) }
  }

  fun version(): String = connected { it.serviceVersion ?: "H10S" }

  @Synchronized fun print(text: String, logo: String) {
    require(text.isNotBlank() && text.length <= 100_000) { "Ticket vacío o demasiado largo." }
    // Decode and validate before touching paper; a failed send must never be retried automatically.
    val bitmap = if (logo.isBlank()) null else logoBitmap(logo)
    try {
      connected { printer ->
        printer.setTextBold(false)
        printer.setTextSize(20f)
        printer.setAlignment(1)
        if (bitmap != null) printer.printBitmap(bitmap)
        printer.setAlignment(0)
        printer.printText(text.filter { it == '\n' || it.code >= 32 && it.code != 127 } + "\n")
        printer.nextLine(3)
      }
    } finally { bitmap?.recycle() }
  }
}
