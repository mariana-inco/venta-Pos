package expo.modules.posprinter

import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.io.EOFException

class ReceiptFramesTest {
  @Test fun unicodeAndConsecutiveFrames() {
    val wire = ByteArrayOutputStream()
    val ticket = "ÁÉÍÓÚ ñ · Pollo 1,5 kg\nTotal $ 36.000\n"
    ReceiptFrames.write(wire, ticket)
    ReceiptFrames.write(wire, "recibido")
    val input = ByteArrayInputStream(wire.toByteArray())
    assertEquals(ticket, ReceiptFrames.read(input))
    assertEquals("recibido", ReceiptFrames.read(input))
    assertEquals(0, input.available())
  }
  @Test(expected = IllegalArgumentException::class) fun rejectsOversizedFrameBeforeReadingPayload() {
    val wire = ByteArrayOutputStream()
    DataOutputStream(wire).writeInt(ReceiptFrames.MAX_BYTES + 1)
    ReceiptFrames.read(ByteArrayInputStream(wire.toByteArray()))
  }
  @Test(expected = IllegalArgumentException::class) fun rejectsNegativeLength() {
    ReceiptFrames.read(ByteArrayInputStream(byteArrayOf(-1, -1, -1, -1)))
  }
  @Test(expected = EOFException::class) fun incompleteTicketIsNotAccepted() {
    ReceiptFrames.read(ByteArrayInputStream(byteArrayOf(0, 0, 0, 5, 65)))
  }
  @Test(expected = IllegalArgumentException::class) fun responseHasItsOwnSmallLimit() {
    val wire = ByteArrayOutputStream()
    ReceiptFrames.write(wire, "x".repeat(4097))
    ReceiptFrames.read(ByteArrayInputStream(wire.toByteArray()), 4096)
  }
}
