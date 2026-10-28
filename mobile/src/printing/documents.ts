import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as Crypto from 'expo-crypto';
import {ticketHtml,ticketLines} from './receipt';
import {printText,printerConfig} from './printer';
import type {LocalStore} from '../offline/store';
export async function outputLocalDocument(store:LocalStore,record:any,kind:'sale'|'closure',width:58|80,action:'share'|'print'|'open'){
 if(action==='print'){
  const config=await printerConfig();if(!config)throw new Error('Configura la impresora Bluetooth en Perfil.');
  const job=Crypto.randomUUID();
  store.db.run('INSERT INTO local_print_jobs VALUES (?,?,?,?,?)',job,record.id,'sending',new Date().toISOString(),null);
  try{await printText(ticketLines(record,kind,config.width).join('\n')+'\n');store.db.run("UPDATE local_print_jobs SET state='sent' WHERE id=?",job);}
  catch(e){store.db.run("UPDATE local_print_jobs SET state='unknown',error=? WHERE id=?",e instanceof Error?e.message:'Error de impresión',job);throw new Error('No se confirmó el envío completo a la impresora. Revisa el papel antes de reimprimir; la venta está guardada. '+(e instanceof Error?e.message:''));}
  return;
 }
 const file=await Print.printToFileAsync({html:ticketHtml(record,kind,width),width:width*72/25.4});
 if(!await Sharing.isAvailableAsync())throw new Error('El dispositivo no permite compartir documentos.');
 await Sharing.shareAsync(file.uri,{mimeType:'application/pdf',dialogTitle:action==='open'?'Abrir o guardar comprobante':'Compartir comprobante'});
}
