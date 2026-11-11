import PDFDocument from 'pdfkit';
const cop=n=>new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:2}).format(n/100).replace(/[\u00a0\u202f]/g,' ');
const stamp=v=>new Intl.DateTimeFormat('es-CO',{dateStyle:'short',timeStyle:'short',timeZone:'America/Bogota'}).format(new Date(v));
export async function statementPdf(s){
 const doc=new PDFDocument({size:'A4',margin:40,info:{Title:'Estado de cuenta · '+s.customer.name,Author:'Dok Pollo MC'}}),chunks=[];
 const done=new Promise((resolve,reject)=>{doc.on('data',c=>chunks.push(c));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});
 const header=()=>{doc.font('Helvetica-Bold').fontSize(18).text('DOK POLLO MC');doc.fontSize(15).text('Estado de cuenta');doc.moveDown(.5);doc.font('Helvetica').fontSize(10).text(`Cliente: ${s.customer.name} · ${s.customer.customer_type==='wholesale'?'Mayorista':'Normal'}`).text(`Período: ${s.from||'Todo el historial'} a ${s.to}`).text(`Saldo anterior al período: ${cop(s.opening_cents)}`).moveDown();};header();
 for(const m of s.movements){
  const method=m.method==='cash'?'Efectivo':m.method==='electronic'?'Electrónico':m.method==='credit'?'Crédito':'';
  const kind=m.kind==='sale'?(m.credit?'VENTA A CRÉDITO':'VENTA DE CONTADO'):m.kind==='collection'?'ABONO':m.kind==='void'?'ANULACIÓN':'REVERSIÓN';
  const body=`${m.description}\n${m.user_name?'Registró: '+m.user_name+' · ':''}${method}${m.kind==='sale'?' · Venta: '+cop(m.total_cents)+' · Cobro inicial: '+cop(m.initial_paid_cents):''}\nMovimiento en cartera: ${cop(m.amount_cents)} · Saldo: ${cop(m.balance_cents)}`;
  const h=doc.font('Helvetica').fontSize(10).heightOfString(body,{width:515})+45;
  if(doc.y+h>780){doc.addPage();doc.font('Helvetica-Bold').fontSize(12).text('Estado de cuenta · '+s.customer.name).moveDown();}
  doc.font('Helvetica-Bold').fontSize(11).text(`${stamp(m.created_at)} · ${kind} · ${m.number}`);doc.font('Helvetica').fontSize(10).text(body,{width:515});doc.moveDown(.6);doc.moveTo(40,doc.y).lineTo(555,doc.y).strokeColor('#dddddd').stroke();doc.moveDown(.5);
 }
 if(doc.y>650)doc.addPage();doc.moveDown().font('Helvetica-Bold').fontSize(12).text('Resumen del período');doc.font('Helvetica').fontSize(11).text(`Ventas: ${cop(s.total_sales_cents)}`).text(`Abonos netos: ${cop(s.total_collections_cents)}`).text(`Saldo al final del período: ${cop(s.closing_cents)}`);doc.font('Helvetica-Bold').text(`Saldo pendiente actual: ${cop(s.balance_cents)}`);doc.end();return done;
}
