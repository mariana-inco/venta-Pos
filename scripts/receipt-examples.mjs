import {mkdirSync,writeFileSync} from 'node:fs';
import {receiptPdf} from '../server/src/pdf.js';
const dir=new URL('../output/pdf/',import.meta.url);mkdirSync(dir,{recursive:true});
const product=(name,unit,qty,price)=>({name,unit,quantity_milli:qty,price_cents:price,subtotal_cents:price*qty/1000});
const items=[product('Pollo entero','kg',10000,1200000),product('Gaseosa','unit',5000,300000),product('Pechuga','kg',2500,1600000)];
for(const [name,lines,credit] of [['un-producto',items.slice(0,1),false],['varios-productos',items,false],['credito',items,true]]){
 const total=lines.reduce((n,i)=>n+i.subtotal_cents,0);
 const sale={id:'muestra-sin-operacion-real',number:1,created_at:'2026-11-09T15:00:00Z',total_cents:total,items:lines,payments:[{method:'cash',amount_cents:credit?5000000:total}],snapshot:{business_name:"Dok Pollo MC",receipt_number:"P-01",customer_name:'Cliente de ejemplo',customer_city:'Bogotá',seller_name:'Vendedor de ejemplo',route_name:'Ruta de ejemplo',credit,initial_paid_cents:credit?5000000:total,initial_balance_cents:credit?total-5000000:0}};
 writeFileSync(new URL(`recibo-${name}-58mm.pdf`,dir),await receiptPdf(sale,58));
}
console.log('Tres recibos de ejemplo en output/pdf. No se guardaron ventas ni clientes.');
