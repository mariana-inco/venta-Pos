import {fail} from './service.js';
import {money} from './money.js';
import {id,now} from './db.js';
export function normalizedReference(value){return String(value||'').normalize('NFKC').replace(/\s/g,'').toUpperCase();}
export function checkReference(db,platformId,value){
 const reference=String(value||'').trim(),key=normalizedReference(reference);
 if(!key||reference.length>120||/[\x00-\x1f\x7f]/.test(reference))fail(400,'Ingresa la referencia de pago electrónico (máximo 120 caracteres).');
 if(db.prepare('SELECT 1 FROM payment_references WHERE platform_id=? AND normalized_reference=?').get(platformId,key))fail(409,'La referencia de pago ya fue registrada para este medio.');
 return {reference,key};
}
export function paymentLine(db,line){
 const amount=money(line.amount);if(amount<=0)fail(400,'Cada pago debe ser mayor a cero.');
 if(line.method==='cash')return {method:'cash',platform_id:null,platform_name:null,amount_cents:amount,reference:null};
 if(line.method!=='electronic')fail(400,'Medio de pago inválido.');
 const p=db.prepare('SELECT * FROM platforms WHERE id=? AND active=1').get(line.platform_id||'');if(!p)fail(400,'Selecciona un medio electrónico activo.');
 const ref=checkReference(db,p.id,line.reference);return {method:'electronic',platform_id:p.id,platform_name:p.name,amount_cents:amount,reference:ref.reference,key:ref.key};
}
export function salePayments(db,input,total){
 const credit=input.method==='credit'||!!input.credit;
 if(input.method==='mixed'&&credit)fail(400,'VARIOS debe pagar la factura completa. Usa CRÉDITO para pagos parciales.');
 let lines=[];
 if(input.method==='mixed'){
  if(!input.payments?.length)fail(400,'Agrega las líneas de pago.');lines=input.payments.map(p=>paymentLine(db,p));
 }else if(credit){
  if(input.payments!==undefined){
   if(!input.payments.length)fail(400,'Agrega al menos un medio para el abono inicial.');
   lines=input.payments.map(p=>paymentLine(db,p));
   if(input.initial_payment!==undefined&&money(input.initial_payment)!==lines.reduce((n,p)=>n+p.amount_cents,0))fail(400,'El abono inicial no coincide con sus medios de pago.');
  }else{
   const initial=money(input.initial_payment||'0');
   if(initial>0)lines=[paymentLine(db,{method:input.initial_method||(input.method==='electronic'?'electronic':'cash'),platform_id:input.initial_platform_id||input.platform_id,reference:input.reference,amount:input.initial_payment})];
  }
 }else lines=[paymentLine(db,{method:input.method,platform_id:input.platform_id,reference:input.reference,amount:String(total/100)})];
 const paid=lines.reduce((n,p)=>n+p.amount_cents,0);if(!Number.isSafeInteger(paid))fail(400,'Importe fuera de rango.');
 if(credit&&paid>total)fail(400,'El abono inicial supera el total de la factura.');
 if(!credit&&paid!==total)fail(400,paid<total?'Falta dinero para completar la factura.':'El pago supera el total de la factura.');
 const seen=new Set();for(const p of lines){if(p.method==='electronic'){const key=p.platform_id+'/'+p.key;if(seen.has(key))fail(409,'Referencia de pago repetida dentro de la factura.');seen.add(key);}}
 return {credit,paid,lines};
}
export function saveReference(db,{platform_id,reference,payment_id=null,collection_id=null}){
 const ref=checkReference(db,platform_id,reference);
 db.prepare('INSERT INTO payment_references VALUES (?,?,?,?,?,?,?)').run(id(),platform_id,ref.reference,ref.key,payment_id,collection_id,now());
}
export function paymentsFor(db,saleId){return db.prepare('SELECT p.*,r.reference FROM payments p LEFT JOIN payment_references r ON r.payment_id=p.id WHERE p.sale_id=? ORDER BY p.rowid').all(saleId);}
