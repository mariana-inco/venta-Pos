package expo.modules.posprinter

import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.InputStream
import java.io.OutputStream

/** Length-prefixed UTF-8 frames, bounded before allocating; shared by both Bluetooth peers. */
object ReceiptFrames {
  const val MAX_BYTES = 1_000_000
  fun read(input: InputStream, limit: Int = MAX_BYTES): String {
    val data = DataInputStream(input)
    val length = data.readInt()
    require(length in 1..limit) { "Tamaño de ticket inválido." }
    val bytes = ByteArray(length)
    data.readFully(bytes)
    return String(bytes, Charsets.UTF_8)
  }
  fun write(output: OutputStream, text: String) {
    val bytes = text.toByteArray(Charsets.UTF_8)
    require(bytes.size in 1..MAX_BYTES) { "Ticket demasiado grande." }
    DataOutputStream(output).apply { writeInt(bytes.size); write(bytes); flush() }
  }
}
