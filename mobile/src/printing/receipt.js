import {saleNumber,businessName} from './number.js';
// Values come from saved receipts; strip control bytes before ESC/POS output.
const safe=value=>String(value??'').replace(/[\x00-\x1f\x7f]/g,' ').trim();
const money=n=>new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:Number(n)%100?2:0}).format(n/100).replace(/[\u00a0\u202f]/g,' ');
const qty=n=>new Intl.NumberFormat('es-CO',{maximumFractionDigits:3}).format(n/1000);
export function ticketLines(record,kind='sale',width=58){
 const s=record.snapshot,columns=width===58?32:48,lines=[];
 const add=value=>{
  let text=safe(value);if(!text){lines.push('');return;}
  while(text.length>columns){const space=text.lastIndexOf(' ',columns);const end=space>0?space:columns;lines.push(text.slice(0,end));text=text.slice(end).trimStart();}if(text)lines.push(text);
 };
 const center=value=>{const text=safe(value);if(text.length>columns)return add(text);lines.push(' '.repeat(Math.floor((columns-text.length)/2))+text);};
 const pair=(a,b)=>{a=safe(a);b=safe(b);if(a.length+b.length+1<=columns)add(a+' '.repeat(columns-a.length-b.length)+b);else{add(a);if(b.length>columns)add(b);else lines.push(b.padStart(columns,' '));}};
 const rule=(char='-')=>add(char.repeat(columns));
 center(businessName(s.business_name));if(s.business_nit)center('NIT '+s.business_nit);if(s.business_address)center(s.business_address);if(s.business_city)center(s.business_city);if(s.business_phone)center('Tel. '+s.business_phone);
 rule();center(kind==='sale'?'COMPROBANTE DE VENTA':'CIERRE DE CAJA');
 center(kind==='sale'?saleNumber(record):`C-${String(record.number).padStart(2,'0')}`);
 center(new Intl.DateTimeFormat('es-CO',{dateStyle:'short',timeStyle:'short',timeZone:'America/Bogota'}).format(new Date(record.created_at)));rule();
 if(kind==='sale'){
  add('Vendedor: '+s.seller_name);if(s.route_name)add('Ruta: '+s.route_name);add('Cliente: '+s.customer_name);if(s.customer_city)add(s.customer_city);rule();
  for(const i of record.items||[]){add(i.name.toUpperCase());add(`${qty(i.quantity_milli)} ${i.unit==='kg'?'KG':'UND'} x ${money(i.price_cents)}`);pair('Importe',money(i.subtotal_cents));add('');}
  rule('=');pair('TOTAL',money(record.total_cents));rule('=');
  for(const p of record.payments||[])pair('Pago',p.method==='cash'?'EFECTIVO':p.platform_name||'ELECTRÓNICO');
  if(s.cash_received_cents!=null){pair('Recibido',money(s.cash_received_cents));pair('Cambio',money(s.cash_change_cents||0));}
  if(s.credit){pair('Abono inicial',money(s.initial_paid_cents||0));pair('Saldo al emitir',money(s.initial_balance_cents||0));center((s.initial_balance_cents||0)===0?'PAGADA':s.initial_paid_cents?'PAGO PARCIAL':'PENDIENTE');}
  rule();center('¡Gracias por su compra!');center('DOK POLLO MC');add('');center('Comprobante de venta.');center('No es factura electrónica.');
 }else{
  add('Abrió: '+s.opener_name);add('Cerró: '+s.admin_name);rule();
  pair('Ventas',String(s.sale_count));pair('Total vendido',money(s.total_cents));pair('Base inicial',money(s.opening_cents));
  pair('Efectivo esperado',money(s.expected_cash_cents));pair('Efectivo contado',money(s.declared_cash_cents));pair('Diferencia efectivo',money(s.cash_difference_cents));
  pair('Electrónico registrado',money(s.electronic_cents));pair('Electrónico verificado',money(s.declared_electronic_cents));pair('Diferencia electrónico',money(s.electronic_difference_cents));
  pair('Diferencia total',money(s.total_difference_cents));if(s.notes)add(s.notes);
 }
 return lines;
}
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function ticketHtml(record,kind='sale',width=58,logoData=''){
 const lines=ticketLines(record,kind,width);
 const logo=/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(logoData)?`<img alt="DOK POLLO MC" src="${logoData}">`:'';
 return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><style>@page{size:${width}mm auto;margin:4mm 5mm}body{margin:0;color:#000;background:white;width:${width-10}mm}img{display:block;width:24mm;height:24mm;object-fit:contain;margin:0 auto 2mm;filter:grayscale(1) contrast(2)}pre{font:10px monospace;white-space:pre-wrap;overflow-wrap:anywhere;margin:0}</style></head><body>${logo}<pre>${escape(lines.join('\n'))}</pre></body></html>`;
}
