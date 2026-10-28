// Rendering is based only on the saved receipt: never the current catalogue.
const safe=value=>String(value??'').replace(/[\x00-\x1f\x7f]/g,' ').trim();
const money=n=>new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:2}).format(n/100).replace(/[\u00a0\u202f]/g,' ');
const qty=n=>new Intl.NumberFormat('es-CO',{maximumFractionDigits:3}).format(n/1000);
export function ticketLines(record,kind='sale',width=58){
 const s=record.snapshot,columns=width===58?32:48,lines=[];
 const add=value=>{const text=safe(value);if(!text){lines.push('');return;}for(let i=0;i<text.length;i+=columns)lines.push(text.slice(i,i+columns));};
 const pair=(a,b)=>{a=safe(a);b=safe(b);if(a.length+b.length+1<=columns)add(a+' '.repeat(columns-a.length-b.length)+b);else{add(a);add(b.padStart(Math.min(columns,b.length), ' '));}};
 const rule=()=>add('-'.repeat(columns));
 add(s.business_name);if(s.business_nit)add('NIT '+s.business_nit);if(s.business_address)add(s.business_address);if(s.business_city)add(s.business_city);if(s.business_phone)add('Tel. '+s.business_phone);
 rule();add(kind==='sale'?'COMPROBANTE DE VENTA':'CIERRE DE CAJA');
 add('Ticket '+(s.ticket_number||'#'+record.number));
 add(new Intl.DateTimeFormat('es-CO',{dateStyle:'short',timeStyle:'short',timeZone:'America/Bogota'}).format(new Date(record.created_at)));
 if(kind==='sale'){
  add('Vendedor: '+s.seller_name);add('Cliente: '+s.customer_name);add(s.customer_city);rule();
  for(const i of record.items||[]){add(i.name);pair(`${qty(i.quantity_milli)} ${i.unit==='kg'?'kg':'und'} x ${money(i.price_cents)}`,money(i.subtotal_cents));}
  rule();pair('TOTAL',money(record.total_cents));
  for(const p of record.payments||[])pair('Pago',p.method==='cash'?'EFECTIVO':p.platform_name);
  add('ID venta: '+record.id);rule();add('Gracias por su compra');add('Comprobante de venta.');add('No es factura electrónica.');
 }else{
  add('Abrió: '+s.opener_name);add('Cerró: '+s.admin_name);rule();
  pair('Ventas',String(s.sale_count));pair('Total vendido',money(s.total_cents));pair('Base inicial',money(s.opening_cents));
  pair('Efectivo esperado',money(s.expected_cash_cents));pair('Efectivo contado',money(s.declared_cash_cents));pair('Diferencia efectivo',money(s.cash_difference_cents));
  pair('Electrónico registrado',money(s.electronic_cents));pair('Electrónico verificado',money(s.declared_electronic_cents));pair('Diferencia electrónico',money(s.electronic_difference_cents));
  pair('Diferencia total',money(s.total_difference_cents));if(s.notes)add(s.notes);add('ID cierre: '+record.id);
 }
 return lines;
}
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function ticketHtml(record,kind='sale',width=58){
 const lines=ticketLines(record,kind,width);
 return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><style>@page{size:${width}mm auto;margin:3mm}body{margin:0;color:#000;background:white}pre{font:10px monospace;white-space:pre-wrap;overflow-wrap:anywhere;width:${width-6}mm}</style></head><body><pre>${escape(lines.join('\n'))}</pre></body></html>`;
}
