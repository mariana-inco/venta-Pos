const fail=message=>{throw Object.assign(new Error(message),{status:409});};
const day=at=>new Date(Date.parse(at)-18000000).toISOString().slice(0,10);
const decimal=(value,places)=>{if(typeof value!=='string'||!new RegExp(`^\\d{1,10}([.,]\\d{1,${places}})?$`).test(value))fail('Escribe una cantidad válida.');const [a,b='']=value.replace(',','.').split('.');const n=Number(a)*10**places+Number(b.padEnd(places,'0'));if(!Number.isSafeInteger(n)||n>100_000_000_000)fail('Importe fuera de rango.');return n;};
export function routeProducts(s){
 const c=s.catalog,deductions=new Map();
 for(const row of s.db.all('SELECT payload FROM local_events WHERE sequence>?',c.reservation_sequence)){
  const e=JSON.parse(row.payload);if(e.type!=='route.sale'||e.data.reservation_id!==c.reservation_id)continue;
  for(const item of e.data.input.items){const p=c.products.find(p=>p.id===item.product_id);if(p)deductions.set(p.group_id,(deductions.get(p.group_id)||0)+decimal(item.quantity,3));}
 }
 return c.products.filter(p=>p.active).map(p=>({...p,stock_milli:Math.max(0,(p.stock_milli||0)-(deductions.get(p.group_id)||0))}));
}
export function routeSession(s){
 const base=s.catalog.session,sales=s.all('sale').filter(x=>x.reservation_id===s.catalog.reservation_id&&x.number>(s.catalog.session_ack_sequence??s.catalog.reservation_sequence));
 let cash=0,electronic=0;for(const sale of sales)for(const p of sale.payments){if(p.method==='cash')cash+=p.amount_cents;else electronic+=p.amount_cents;}
 return {...base,sale_count:(base.sale_count||0)+sales.length,total_cents:(base.total_cents||0)+sales.reduce((n,x)=>n+x.total_cents,0),cash_cents:(base.cash_cents||0)+cash,electronic_cents:(base.electronic_cents||0)+electronic};
}
export function routeRequest(s,user,path,method,body){
 const c=s.catalog,[url]=path.split('?');
 if(user.id!==c.user.id)fail('El modo sin internet pertenece al usuario que preparó esta terminal.');
 if(method==='GET'){
  if(url==='/route')return c.route;
  if(url==='/agents')return c.agents;
  if(url==='/products')return routeProducts(s);
  if(url==='/customers')return c.customers.filter(x=>x.active);
  if(url==='/cash-sessions')return [routeSession(s)];
  if(url==='/cash-sessions/'+c.session.id)return routeSession(s);
 }
 if(method==='POST'&&url==='/sale-drafts')return s.tx(()=>{
  if(day(s.clock())!==c.reservation_day)fail('Conecta y sincroniza la terminal para preparar la nueva jornada.');
  const old=s.get('route-draft',body.request_key);if(old){if(old.customer_id!==body.customer_id||old.agent_id!==body.agent_id)fail('El cliente de esta venta está fijo.');return old;}
  const customer=c.customers.find(x=>x.id===body.customer_id&&x.active);if(!customer||!c.agents.some(x=>x.id===body.agent_id))fail('Selecciona un vendedor y cliente de tu ruta.');
  const prices={};for(const p of routeProducts(s))prices[p.id]={price_cents:customer.customer_type==='wholesale'?p.wholesale_price_cents:p.price_cents,unit:p.unit};
  return s.put('route-draft',{id:body.request_key,customer_id:customer.id,agent_id:body.agent_id,route_id:c.route.id,prices,customer_type:customer.customer_type||'normal'});
 });
 if(method==='POST'&&url==='/sales')return s.tx(()=>{
  const request=JSON.stringify(body),old=s.get('sale',body.request_key);if(old){if(old.seller_id!==user.id||old.local_request!==request)fail('Referencia utilizada en otra venta.');return old;}
  if(day(s.clock())!==c.reservation_day)fail('La reserva es de otra jornada. Sincroniza antes de seguir vendiendo.');
  const draft=s.get('route-draft',body.draft_id);if(!draft||body.request_key!==draft.id||body.agent_id!==draft.agent_id||body.customer_id!==draft.customer_id||body.session_id!==c.session.id)fail('No se puede cambiar cliente, vendedor, ruta o caja de esta venta.');
  if(!['cash','credit'].includes(body.method)||(body.method==='cash'&&body.credit)||(body.initial_payment&&decimal(body.initial_payment,2)>0&&body.initial_method!=='cash')||body.payments?.length)fail('Finaliza el modo sin internet para verificar pagos electrónicos con conexión.');
  if(!Array.isArray(body.items)||!body.items.length||body.items.length>100)fail('Agrega entre 1 y 100 productos.');
  const products=routeProducts(s),used=new Map(),seen=new Set();
  const items=body.items.map(i=>{
   const p=products.find(x=>x.id===i.product_id),price=draft.prices[i.product_id]?.price_cents;
   if(!p||!p.group_id||seen.has(p.id)||!Number.isSafeInteger(price)||price<=0)fail('Producto o precio no disponible.');seen.add(p.id);
   if(i.expected_price_cents!==price)fail('Revisa el precio aplicado antes de confirmar.');
   const qty=decimal(i.quantity,3);if(qty<=0||p.unit==='unit'&&qty%1000)fail('Cantidad inválida.');
   const group=(used.get(p.group_id)||0)+qty;used.set(p.group_id,group);if(group>p.stock_milli)fail(`No hay suficiente inventario reservado de ${p.name}. Disponible: ${p.stock_milli/1000}.`);
   const subtotal=Number((BigInt(price)*BigInt(qty)+500n)/1000n);if(subtotal<=0)fail('Subtotal inválido.');
   return {id:s.uuid(),product_id:p.id,name:p.name,unit:p.unit,price_cents:price,quantity_milli:qty,subtotal_cents:subtotal};
  });
  const total=items.reduce((n,i)=>n+i.subtotal_cents,0);if(!Number.isSafeInteger(total)||total>100_000_000_000)fail('Total fuera de rango.');
  const credit=body.method==='credit',paid=credit?decimal(body.initial_payment||'0',2):total;if(paid>total)fail('El abono supera el total.');
  const received=body.cash_received===undefined?null:decimal(body.cash_received,2);if(received!==null&&(credit||received<total))fail('El efectivo recibido no cubre la venta.');
  const usedNumber=s.meta('receipt_sequence')||0,range=c.receipt_ranges.find(r=>r.end_number>usedNumber);if(!range)fail('Conecta y finaliza el modo sin internet para reservar más consecutivos.');
  const n=Math.max(usedNumber+1,range.start_number);s.setMeta('receipt_sequence',n);
  const event=s.enqueue(user,'route.sale',{reservation_id:c.reservation_id,catalog_version:c.version,receipt_sequence:n,input:body},body.request_key);
  const customer=c.customers.find(x=>x.id===body.customer_id),agent=c.agents.find(x=>x.id===body.agent_id);
  const previousDebt=s.all('sale').filter(x=>x.reservation_id===c.reservation_id&&x.customer_id===customer.id).reduce((n,x)=>n+(x.balance_cents||0),0);
  const snapshot={...c.settings,business_whatsapp:'3225268837',receipt_number:`P-${String(n).padStart(2,'0')}`,customer_name:customer.name,customer_city:customer.city,customer_type:draft.customer_type,seller_name:agent.name,user_name:user.name,route_id:c.route.id,route_name:c.route.name,agent_id:agent.id,credit,initial_paid_cents:paid,initial_balance_cents:total-paid,customer_balance_cents:(customer.balance_cents||0)+previousDebt+total-paid,cash_received_cents:received,cash_change_cents:received===null?null:received-total};
  return s.put('sale',{id:event.id,reservation_id:c.reservation_id,number:event.sequence,session_id:c.session.id,session_number:c.session.number,seller_id:user.id,customer_id:customer.id,created_at:event.created_at,total_cents:total,paid_cents:paid,balance_cents:total-paid,state:paid===total?'PAGADA':paid?'PAGO PARCIAL':'PENDIENTE',items,payments:paid?[{method:'cash',platform_id:null,platform_name:null,amount_cents:paid}]:[],method:body.method,snapshot,sync_status:'pending',local_request:request});
 });
 return undefined;
}
