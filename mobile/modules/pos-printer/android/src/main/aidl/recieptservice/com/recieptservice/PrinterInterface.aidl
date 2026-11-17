package recieptservice.com.recieptservice;
import android.graphics.Bitmap;

// First eleven transactions verified against SRPrinter 8.3.6 on the connected H10S.
// Keep the order: these are Binder transaction IDs, not an arbitrary API list.
interface PrinterInterface {
  void printEpson(in byte[] data);
  String getServiceVersion();
  void printText(String text);
  void printBitmap(in Bitmap pic);
  void printBarCode(String data, int symbology, int height, int width);
  void printQRCode(String data, int modulesize, int errorlevel);
  void setAlignment(int alignment);
  void setTextSize(float textSize);
  void nextLine(int line);
  void printTableText(in String[] text, in int[] weight, in int[] alignment);
  void setTextBold(boolean bold);
}
