// Shared, synchronous SQLite business layer. The Android adapter uses expo-sqlite;
// integration tests use a real node:sqlite file with the same SQL and transactions.
const LIMIT=100_000_000_000;
const fail=message=>{throw Object.assign(new Error(message),{status:409});};
const canonical=value=>Array.isArray(value)?`[${value.map(canonical).join(',')}]`:value&&typeof value==='object'?`{${Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')}}`:JSON.stringify(value);
const decimal=(value,places)=>{
 if(typeof value!=='string'||!new RegExp(`^\\d{1,10}([.,]\\d{1,${places}})?$`).test(value))fail('Escribe un valor positivo válido.');
 const [a,b='']=value.replace(',','.').split('.');const n=Number(a)*10**places+Number(b.padEnd(places,'0'));
 if(!Number.isSafeInteger(n)||n>LIMIT)fail('El valor supera el límite permitido.');return n;
};
const lineTotal=(p,q)=>Number((BigInt(p)*BigInt(q)+500n)/1000n);
const clean=(s,max=120)=>{if(typeof s!=='string'||!s.trim()||s.trim().length>max)fail('Completa los campos de texto.');return s.trim();};
export class LocalStore {
 constructor(db,uuid,clock=()=>new Date().toISOString()){
  this.db=db;this.uuid=uuid;this.clock=clock;
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
   CREATE TABLE IF NOT EXISTS local_meta (key TEXT PRIMARY KEY,value TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS local_records (kind TEXT NOT NULL,id TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(kind,id));
   CREATE TABLE IF NOT EXISTS local_events (id TEXT PRIMARY KEY,sequence INTEGER NOT NULL UNIQUE,actor_id TEXT NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',error TEXT,result TEXT);
   CREATE INDEX IF NOT EXISTS local_events_pending ON local_events(state,sequence);
   CREATE TABLE IF NOT EXISTS local_print_jobs (id TEXT PRIMARY KEY,record_id TEXT NOT NULL,state TEXT NOT NULL,created_at TEXT NOT NULL,error TEXT);
  `);
  if(!this.meta('device_id'))this.tx(()=>{if(!this.meta('device_id'))this.setMeta('device_id',uuid());});
 }
 tx(fn){this.db.exec('BEGIN IMMEDIATE');try{const value=fn();this.db.exec('COMMIT');return value;}catch(e){this.db.exec('ROLLBACK');throw e;}}
 meta(key){const row=this.db.get('SELECT value FROM local_meta WHERE key=?',key);return row?JSON.parse(row.value):null;}
 setMeta(key,value){this.db.run('INSERT INTO local_meta VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',key,JSON.stringify(value));}
 get deviceId(){return this.meta('device_id');}
 get catalog(){return this.meta('catalog');}
 get(kind,id){const row=this.db.get('SELECT payload FROM local_records WHERE kind=? AND id=?',kind,id);return row?JSON.parse(row.payload):null;}
 all(kind){return this.db.all('SELECT payload FROM local_records WHERE kind=?',kind).map(r=>JSON.parse(r.payload));}
 put(kind,record){this.db.run('INSERT INTO local_records VALUES (?,?,?) ON CONFLICT(kind,id) DO UPDATE SET payload=excluded.payload',kind,record.id,JSON.stringify(record));return record;}
 profile(user){this.put('profile',user);}
 profiles(){return this.all('profile');}
 applyCatalog(catalog){
  if(!catalog?.version||!Array.isArray(catalog.products)||!catalog.settings||!Number.isSafeInteger(catalog.ack_sequence))fail('Catálogo recibido inválido.');
  this.tx(()=>{
   if(catalog.ack_sequence>(this.meta('sequence')||0))fail('La nube contiene operaciones que no están en esta base local. No reutilices copias antiguas del dispositivo.');
   this.setMeta('catalog',catalog);this.setMeta('last_sync',this.clock());this.profile(catalog.user);
   for(const row of this.db.all("SELECT payload FROM local_events WHERE sequence<=? AND state='sent'",catalog.ack_sequence)){
    const e=JSON.parse(row.payload);if(e.type==='customer.create')this.db.run("DELETE FROM local_records WHERE kind='customer' AND id=?",e.id);
   }
  });
 }
 pending(){return this.db.all("SELECT * FROM local_events WHERE state!='sent' ORDER BY sequence").map(r=>({...r,event:JSON.parse(r.payload)}));}
 acknowledge(id,result){this.tx(()=>{
  const sale=this.get('sale',id);if(sale&&result.total_cents!==sale.total_cents)fail('El importe confirmado no coincide con el ticket local. Conserva la operación para revisión.');
  this.db.run("UPDATE local_events SET state='sent',error=NULL,result=? WHERE id=?",JSON.stringify(result),id);
  for(const kind of ['sale','closure','session']){const r=this.get(kind,id);if(r)this.put(kind,{...r,sync_status:'synced',cloud_number:result.cloud_number,sync_warnings:result.warnings||[]});}
 });}
 block(id,error){this.db.run("UPDATE local_events SET state='blocked',error=? WHERE id=?",error,id);}
 status(){const pending=this.pending();return {device_id:this.deviceId,pending:pending.length,blocked:pending.filter(e=>e.state==='blocked').length,error:pending.find(e=>e.error)?.error||null,last_sync:this.meta('last_sync'),catalog_ready:!!this.catalog};}
 enqueue(user,type,data,operationId=this.uuid()){
  const sequence=(this.meta('sequence')||0)+1;
  const event={id:operationId,sequence,type,created_at:this.clock(),data};
  this.db.run('INSERT INTO local_events(id,sequence,actor_id,payload) VALUES (?,?,?,?)',event.id,sequence,user.id,canonical(event));
  this.setMeta('sequence',sequence);return event;
 }
 products(user){
  const catalog=this.catalog;if(!catalog)return [];
  const deductions=new Map();
  for(const row of this.db.all('SELECT payload FROM local_events WHERE sequence>?',catalog.ack_sequence)){
   const e=JSON.parse(row.payload);if(e.type==='sale.create')for(const i of e.data.items)deductions.set(i.product_id,(deductions.get(i.product_id)||0)+i.quantity_milli);
  }
  return catalog.products.filter(p=>user.role==='admin'||p.active).map(p=>({...p,stock_milli:p.stock_milli===null?null:p.stock_milli-(deductions.get(p.id)||0)}));
 }
 customers(){const map=new Map((this.catalog?.customers||[]).map(c=>[c.id,c]));for(const c of this.all('customer'))map.set(c.id,c);return [...map.values()].filter(c=>c.active!==0);}
 sales(user){return this.all('sale').filter(s=>user.role==='admin'||s.seller_id===user.id).sort((a,b)=>b.created_at.localeCompare(a.created_at)||b.number-a.number);}
 totals(sessionId){
  const sales=this.all('sale').filter(s=>s.session_id===sessionId),platforms=new Map();let cash=0,electronic=0;
  for(const s of sales){const p=s.payments[0];if(p.method==='cash')cash+=s.total_cents;else{electronic+=s.total_cents;const key=p.platform_id;const prev=platforms.get(key)||{platform_id:key,platform_name:p.platform_name,amount:0};prev.amount+=s.total_cents;platforms.set(key,prev);}}
  return {sale_count:sales.length,cash_cents:cash,electronic_cents:electronic,total_cents:cash+electronic,platforms:[...platforms.values()]};
 }
 sessions(user){return this.all('session').filter(s=>user.role==='admin'||s.opened_by===user.id).map(s=>({...s,...this.totals(s.id)})).sort((a,b)=>b.number-a.number);}
 session(user,id){const s=this.sessions(user).find(s=>s.id===id);if(!s)fail('Caja no encontrada en este dispositivo.');return s;}
 request(user,path,method='GET',body){
  const saved=this.get('profile',user.id);if(saved?.blocked)fail('El acceso del dispositivo fue revocado. Inicia sesión con conexión. Tus ventas están conservadas.');
  const [route,query='']=path.split('?');
  if(method==='GET'){
   if(route==='/products')return this.products(user);
   if(route==='/customers')return this.customers();
   if(route==='/platforms')return (this.catalog?.platforms||[]).filter(p=>user.role==='admin'||p.active);
   if(route==='/settings')return this.catalog?.settings;
   if(route==='/cash-sessions')return this.sessions(user);
   if(/^\/cash-sessions\/.+$/.test(route))return this.session(user,route.split('/')[2]);
   if(route==='/sales')return this.salesPage(user,new URLSearchParams(query));
   if(/^\/sales\/.+$/.test(route)){const s=this.sales(user).find(s=>s.id===route.split('/')[2]);if(!s)fail('Venta no encontrada en este dispositivo.');return s;}
   if(route==='/closures'||route.startsWith('/closures/')){
    if(user.role!=='admin')fail('Solo un administrador puede consultar cierres.');
    const cs=this.all('closure').sort((a,b)=>b.number-a.number);if(route==='/closures')return cs;
    const c=cs.find(c=>c.id===route.split('/')[2]);if(!c)fail('Cierre no encontrado.');return c;
   }
  }
  if(method==='POST'&&['/customers','/cash-sessions','/sales'].includes(route)||method==='POST'&&/^\/(cash-sessions\/[^/]+\/close|closures\/[^/]+\/notes)$/.test(route)){
   if(!this.catalog)fail('Conéctate una vez para descargar el catálogo antes de operar.');
   return this.tx(()=>{
    if(route==='/customers'){
     const name=clean(body.name),city=clean(body.city,100);const exists=this.customers().find(c=>c.name.toLowerCase()===name.toLowerCase()&&c.city.toLowerCase()===city.toLowerCase());if(exists)return exists;
     const e=this.enqueue(user,'customer.create',{name,city});return this.put('customer',{id:e.id,name,city,active:1});
    }
    if(route==='/cash-sessions'){
     if(this.sessions(user).some(s=>s.opened_by===user.id&&s.state==='open'))fail('Ya tienes una caja abierta en este dispositivo.');
     const opening_cents=decimal(body.opening||'0',2);const e=this.enqueue(user,'cash.open',{opening_cents});
     return this.put('session',{id:e.id,device_id:this.deviceId,number:e.sequence,opened_by:user.id,opener_name:user.name,opened_at:e.created_at,opening_cents,state:'open',closed_at:null,sync_status:'pending',...this.totals(e.id)});
    }
    if(route==='/sales')return this.recordSale(user,body);
    if(route.endsWith('/close'))return this.close(user,route.split('/')[2],body);
    if(user.role!=='admin')fail('Solo un administrador puede anotar cierres.');
    const c=this.get('closure',route.split('/')[2]);if(!c)fail('Cierre no encontrado.');
    const note=clean(body.note,2000),e=this.enqueue(user,'closure.note',{closure_id:c.id,note});
    return this.put('closure',{...c,annotations:[...c.annotations,{id:e.id,note,author_name:user.name,created_at:e.created_at}]});
   });
  }
  return undefined;
 }
 recordSale(user,input){
  const existing=this.get('sale',input.request_key);
  if(existing){if(existing.seller_id!==user.id||existing.local_request!==canonical(input))fail('Esta referencia pertenece a otra venta.');return existing;}
  const session=this.session(user,input.session_id);
  if(session.opened_by!==user.id||session.state!=='open')fail('Solo puedes vender en tu caja abierta.');
  const customer=this.customers().find(c=>c.id===input.customer_id);if(!customer)fail('Selecciona un cliente activo.');
  const catalog=this.catalog,products=this.products(user);const platform=input.method==='electronic'?catalog.platforms.find(p=>p.id===input.platform_id&&p.active):null;
  if(!['cash','electronic'].includes(input.method)||input.method==='electronic'&&!platform||input.method==='cash'&&input.platform_id)fail('Selecciona un medio de pago válido.');
  if(!Array.isArray(input.items)||!input.items.length||input.items.length>100)fail('La venta debe tener entre 1 y 100 productos.');
  const seen=new Set();
  const items=input.items.map(i=>{
   const p=products.find(p=>p.id===i.product_id&&p.active);if(!p||seen.has(p.id))fail('Producto no disponible o repetido.');seen.add(p.id);
   if(i.expected_price_cents!==undefined&&i.expected_price_cents!==p.price_cents)fail('El catálogo cambió. Revisa los precios antes de confirmar.');
   const qty=decimal(i.quantity,3);if(qty<=0||p.unit==='unit'&&qty%1000)fail('Cantidad inválida.');
   if(p.stock_milli!==null&&qty>p.stock_milli)fail(`Existencias insuficientes en el catálogo local: ${p.name}.`);
   const total=lineTotal(p.price_cents,qty);if(total<=0||total>LIMIT)fail('Subtotal fuera de rango.');
   return {id:this.uuid(),product_id:p.id,name:p.name,unit:p.unit,price_cents:p.price_cents,quantity_milli:qty,subtotal_cents:total};
  });
  const total=items.reduce((n,i)=>n+i.subtotal_cents,0);if(total>LIMIT)fail('Total fuera de rango.');
  const e=this.enqueue(user,'sale.create',{session_id:session.id,customer_id:customer.id,catalog_version:catalog.version,customer_name:customer.name,customer_city:customer.city,items:items.map(i=>({product_id:i.product_id,quantity_milli:i.quantity_milli})),method:input.method,platform_id:platform?.id||null},input.request_key);
  const snapshot={...catalog.settings,customer_name:customer.name,customer_city:customer.city,seller_name:user.name,device_id:this.deviceId,ticket_number:`${this.deviceId}/${e.sequence}`,catalog_version:catalog.version};
  return this.put('sale',{id:e.id,number:e.sequence,session_id:session.id,session_number:session.number,seller_id:user.id,customer_id:customer.id,created_at:e.created_at,total_cents:total,items,payments:[{method:input.method,platform_id:platform?.id||null,platform_name:platform?.name||null,amount_cents:total}],method:input.method,platform_name:platform?.name||null,snapshot,sync_status:'pending',local_request:canonical(input)});
 }
 close(user,id,input){
  if(user.role!=='admin')fail('Solo un administrador puede cerrar la caja.');
  const session=this.session(user,id);if(session.state!=='open')fail('La caja ya está cerrada.');
  const totals=this.totals(id);if(input.reviewed_sale_count!==totals.sale_count)fail('Se registraron ventas nuevas. Revisa de nuevo el cierre.');
  const cash=decimal(input.declared_cash,2),electronic=decimal(input.declared_electronic,2),notes=String(input.notes||'').trim();if(notes.length>2000)fail('Observación demasiado larga.');
  const e=this.enqueue(user,'cash.close',{session_id:id,declared_cash_cents:cash,declared_electronic_cents:electronic,reviewed_sale_count:totals.sale_count,notes});
  const expected=session.opening_cents+totals.cash_cents;
  const snapshot={business_name:this.catalog.settings.business_name,session_id:id,opened_at:session.opened_at,closed_at:e.created_at,opened_by:session.opened_by,opener_name:session.opener_name,admin_name:user.name,opening_cents:session.opening_cents,...totals,expected_cash_cents:expected,declared_cash_cents:cash,declared_electronic_cents:electronic,cash_difference_cents:cash-expected,electronic_difference_cents:electronic-totals.electronic_cents,total_difference_cents:cash-expected+electronic-totals.electronic_cents,notes,ticket_number:`${this.deviceId}/${e.sequence}`,device_id:this.deviceId};
  this.put('session',{...session,state:'closed',closed_at:e.created_at,closure_id:e.id,sync_status:'pending'});
  return this.put('closure',{id:e.id,number:e.sequence,session_id:id,session_number:session.number,created_at:e.created_at,snapshot,annotations:[],sync_status:'pending'});
 }
 salesPage(user,params){
  const sales=this.sales(user).filter(s=>{
   for(const key of ['session_id','seller_id','customer_id','method'])if(params.get(key)&&s[key]!==params.get(key))return false;
   const day=new Date(new Date(s.created_at).getTime()-5*3600000).toISOString().slice(0,10);
   return (!params.get('from')||day>=params.get('from'))&&(!params.get('to')||day<=params.get('to'));
  });
  const groups={};for(const key of ['seller','customer','date','method','platform']){
   const map=new Map();for(const s of sales){const k=key==='seller'?s.seller_id:key==='customer'?s.customer_id:key==='date'?new Date(new Date(s.created_at).getTime()-5*3600000).toISOString().slice(0,10):key==='method'?s.method:s.platform_name;const g=map.get(k)||{key:k,count:0,total_cents:0};g.count++;g.total_cents+=s.total_cents;map.set(k,g);}groups[key]=[...map.values()];
  }
  const page=Math.max(1,Number(params.get('page'))||1);return {sales:sales.slice((page-1)*50,page*50),count:sales.length,page,groups};
 }
}
