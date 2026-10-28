import {randomBytes} from 'node:crypto';
import {z} from 'zod';
import {digest,authenticate,admin,publicUser} from './auth.js';
import {id,now,transaction,audit} from './db.js';
import {fail,sessionFor,saleDetail,closeSession,closureDetail} from './service.js';
import {subtotal} from './money.js';

const uuid=z.string().uuid();
const amount=z.number().int().min(0).max(100_000_000_000);
const text=(max=120)=>z.string().trim().min(1).max(max);
const base={id:uuid,sequence:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),created_at:z.iso.datetime()};
export const eventSchema=z.discriminatedUnion('type',[
 z.object({...base,type:z.literal('customer.create'),data:z.object({name:text(),city:text(100)})}),
 z.object({...base,type:z.literal('cash.open'),data:z.object({opening_cents:amount})}),
 z.object({...base,type:z.literal('sale.create'),data:z.object({session_id:uuid,customer_id:uuid,catalog_version:z.string().length(64),customer_name:text(),customer_city:text(100),items:z.array(z.object({product_id:uuid,quantity_milli:amount.refine(n=>n>0)})).min(1).max(100),method:z.enum(['cash','electronic']),platform_id:z.string().max(80).nullable()})}),
 z.object({...base,type:z.literal('cash.close'),data:z.object({session_id:uuid,declared_cash_cents:amount,declared_electronic_cents:amount,reviewed_sale_count:z.number().int().nonnegative(),notes:z.string().max(2000)})}),
 z.object({...base,type:z.literal('closure.note'),data:z.object({closure_id:uuid,note:text(2000)})})
]);
// Canonical key order makes HTTP retries independent of object property order.
export function canonical(value){return Array.isArray(value)?`[${value.map(canonical).join(',')}]`:value&&typeof value==='object'?`{${Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')}}`:JSON.stringify(value);}
export const ticketNumber=(deviceId,sequence)=>`${deviceId}/${sequence}`;
export function registerDevice(db,user,input){
 const parsed=z.object({device_id:uuid,name:text(80)}).parse(input);
 return transaction(db,()=>{
  db.prepare('INSERT OR IGNORE INTO sync_devices(id,name,created_at) VALUES (?,?,?)').run(parsed.device_id,parsed.name,now());
  const token=randomBytes(32).toString('hex');
  db.prepare('INSERT INTO device_access(device_id,user_id,token_hash,revoked) VALUES (?,?,?,0) ON CONFLICT(device_id,user_id) DO UPDATE SET token_hash=excluded.token_hash,revoked=0').run(parsed.device_id,user.id,digest(token));
  audit(db,user.id,'device.register',parsed.device_id);
  return {device_id:parsed.device_id,token};
 });
}
export function authenticateDevice(db){return (req,res,next)=>{
 const raw=req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
 const row=raw&&db.prepare('SELECT u.*,a.device_id FROM device_access a JOIN users u ON u.id=a.user_id WHERE a.token_hash=? AND a.revoked=0 AND u.active=1').get(digest(raw));
 if(!row)return res.status(401).json({error:'Vuelve a iniciar sesión para autorizar la sincronización. Las ventas locales se conservan.'});
 req.user=publicUser(row);req.deviceId=row.device_id;next();
};}
export function catalogFor(db,user,deviceId){
 return transaction(db,()=>{
  const payload={settings:db.prepare('SELECT * FROM settings WHERE id=1').get(),products:db.prepare('SELECT * FROM products ORDER BY id').all().map(p=>({...p,stock_milli:p.stock_milli===null?null:p.stock_milli-(db.prepare('SELECT quantity_milli FROM stock_debts WHERE product_id=?').get(p.id)?.quantity_milli||0)})),platforms:db.prepare('SELECT * FROM platforms ORDER BY id').all()};
  const serialized=canonical(payload),version=digest(serialized);
  db.prepare('INSERT OR IGNORE INTO catalog_versions VALUES (?,?,?)').run(version,serialized,now());
  db.prepare('INSERT OR IGNORE INTO device_catalogs VALUES (?,?)').run(deviceId,version);
  db.prepare('UPDATE sync_devices SET last_seen_at=? WHERE id=?').run(now(),deviceId);
  return {...payload,version,user,customers:db.prepare('SELECT * FROM customers ORDER BY name').all(),ack_sequence:db.prepare('SELECT last_sequence FROM sync_devices WHERE id=?').get(deviceId).last_sequence,server_time:now()};
 });
}
export function ingestEvent(db,user,deviceId,raw){
 const parsed=eventSchema.safeParse(raw);
 if(!parsed.success)fail(400,'Operación de sincronización inválida.');
 const event=parsed.data;
 return transaction(db,()=>{
  const hash=digest(canonical(event));
  const previous=db.prepare('SELECT * FROM sync_events WHERE device_id=? AND event_id=?').get(deviceId,event.id);
  if(previous){if(previous.request_hash!==hash||previous.actor_id!==user.id)fail(409,'La referencia pertenece a otra operación.');return JSON.parse(previous.result);}
  const device=db.prepare('SELECT * FROM sync_devices WHERE id=?').get(deviceId);
  if(!device)fail(404,'Dispositivo no registrado.');
  if(event.sequence!==device.last_sequence+1)fail(409,'Falta una operación anterior de este dispositivo. Conserva la cola y vuelve a sincronizar.');
  const result=applyEvent(db,user,deviceId,event);
  if(new Date(event.created_at).getTime()>Date.now()+24*60*60*1000){
   const warning={message:'El reloj del dispositivo está adelantado. Se conservó la fecha original y se registró la fecha de recepción.'};
   db.prepare('INSERT INTO sync_issues VALUES (?,?,?,?,?)').run(id(),deviceId,event.type==='sale.create'?event.id:null,JSON.stringify(warning),now());
   result.warnings=[...(result.warnings||[]),warning];
  }
  db.prepare('INSERT INTO sync_events VALUES (?,?,?,?,?,?,?,?)').run(deviceId,event.id,event.sequence,user.id,hash,canonical(event),JSON.stringify(result),now());
  db.prepare('UPDATE sync_devices SET last_sequence=?,last_seen_at=? WHERE id=?').run(event.sequence,now(),deviceId);
  audit(db,user.id,'sync.accept',event.id,{device_id:deviceId,sequence:event.sequence,type:event.type});
  return result;
 });
}
function applyEvent(db,user,deviceId,event){
 const d=event.data;
 if(event.type==='customer.create'){
  db.prepare('INSERT INTO customers VALUES (?,?,?,?,?,?)').run(event.id,d.name,d.city,1,event.created_at,event.created_at);
  audit(db,user.id,'customer.create',event.id,{device_id:deviceId});
  return {id:event.id};
 }
 if(event.type==='cash.open'){
  db.prepare('INSERT INTO cash_sessions(id,opened_by,opened_at,opening_cents,state,closed_at,device_id) VALUES (?,?,?,?,?,?,?)').run(event.id,user.id,event.created_at,d.opening_cents,'open',null,deviceId);
  audit(db,user.id,'cash.open',event.id,{device_id:deviceId});return {id:event.id};
 }
 const sessionId=event.type==='closure.note'?db.prepare('SELECT session_id FROM closures WHERE id=?').get(d.closure_id)?.session_id:d.session_id;
 const session=sessionFor(db,user,sessionId||'');
 if(session.device_id!==deviceId)fail(403,'La operación pertenece a otro dispositivo.');
 if(event.type==='closure.note'){
  if(user.role!=='admin')fail(403,'Solo un administrador puede anotar cierres.');
  db.prepare('INSERT INTO closure_notes VALUES (?,?,?,?,?)').run(event.id,d.closure_id,user.id,d.note,event.created_at);
  return {id:event.id};
 }
 if(event.type==='cash.close'){
  const c=closeSession(db,user,session.id,{declared_cash:(d.declared_cash_cents/100).toFixed(2),declared_electronic:(d.declared_electronic_cents/100).toFixed(2),reviewed_sale_count:d.reviewed_sale_count,notes:d.notes},{deviceId,id:event.id,createdAt:event.created_at,ticketNumber:ticketNumber(deviceId,event.sequence)});
  return {id:c.id,cloud_number:c.number};
 }
 if(session.opened_by!==user.id||session.state!=='open')fail(409,'La caja no está abierta para este vendedor.');
 const delivered=db.prepare('SELECT v.payload FROM device_catalogs d JOIN catalog_versions v ON v.id=d.version WHERE d.device_id=? AND d.version=?').get(deviceId,d.catalog_version);
 if(!delivered)fail(409,'No existe el catálogo de origen de esta venta en el dispositivo registrado.');
 const catalog=JSON.parse(delivered.payload);
 if(!db.prepare('SELECT id FROM customers WHERE id=?').get(d.customer_id))fail(409,'Sincroniza primero el cliente de esta venta.');
 const platform=d.method==='electronic'?catalog.platforms.find(p=>p.id===d.platform_id&&p.active):null;
 if(d.method==='electronic'&&!platform||d.method==='cash'&&d.platform_id!==null)fail(400,'Medio de pago inválido para el catálogo utilizado.');
 const seen=new Set();
 const items=d.items.map(item=>{
  const p=catalog.products.find(p=>p.id===item.product_id&&p.active);
  if(!p||seen.has(p.id))fail(400,'Producto inválido o repetido.');seen.add(p.id);
  if(p.unit==='unit'&&item.quantity_milli%1000!==0)fail(400,'Las unidades deben ser enteras.');
  return {id:id(),product_id:p.id,name:p.name,unit:p.unit,price_cents:p.price_cents,quantity_milli:item.quantity_milli,subtotal_cents:subtotal(p.price_cents,item.quantity_milli)};
 });
 const total=items.reduce((n,i)=>n+i.subtotal_cents,0);
 if(!Number.isSafeInteger(total)||total>100_000_000_000)fail(400,'Total fuera de rango.');
 const snapshot={...catalog.settings,customer_name:d.customer_name,customer_city:d.customer_city,seller_name:user.name,ticket_number:ticketNumber(deviceId,event.sequence),device_id:deviceId,catalog_version:d.catalog_version};
 const number=db.prepare('SELECT COALESCE(MAX(number),0)+1 AS n FROM sales').get().n;
 db.prepare('INSERT INTO sales VALUES (?,?,?,?,?,?,?,?,?,?)').run(event.id,number,session.id,user.id,d.customer_id,event.created_at,total,JSON.stringify(snapshot),event.id,digest(canonical(event)));
 const warnings=[];
 for(const item of items){
  db.prepare('INSERT INTO sale_items VALUES (?,?,?,?,?,?,?,?)').run(item.id,event.id,item.product_id,item.name,item.unit,item.quantity_milli,item.price_cents,item.subtotal_cents);
  const current=db.prepare('SELECT * FROM products WHERE id=?').get(item.product_id);
  if(current.stock_milli!==null){
   const debt=db.prepare('SELECT quantity_milli FROM stock_debts WHERE product_id=?').get(item.product_id)?.quantity_milli||0;
   const balance=current.stock_milli-debt-item.quantity_milli;
   db.prepare('UPDATE products SET stock_milli=?,updated_at=? WHERE id=?').run(Math.max(0,balance),now(),item.product_id);
   db.prepare('INSERT INTO stock_debts VALUES (?,?) ON CONFLICT(product_id) DO UPDATE SET quantity_milli=excluded.quantity_milli').run(item.product_id,Math.max(0,-balance));
   if(balance<0)warnings.push({product_id:item.product_id,message:`Inventario por conciliar: ${item.name}`,shortfall_milli:Math.min(item.quantity_milli,-balance)});
  }
  if(current.price_cents!==item.price_cents||!current.active)warnings.push({product_id:item.product_id,message:`Se conservó el catálogo de emisión: ${item.name}`});
 }
 db.prepare('INSERT INTO payments VALUES (?,?,?,?,?,?)').run(id(),event.id,d.method,platform?.id||null,platform?.name||null,total);
 db.prepare('INSERT INTO offline_sales VALUES (?,?,?,?,?)').run(event.id,deviceId,event.sequence,d.catalog_version,snapshot.ticket_number);
 for(const warning of warnings)db.prepare('INSERT INTO sync_issues VALUES (?,?,?,?,?)').run(id(),deviceId,event.id,JSON.stringify(warning),now());
 audit(db,user.id,'sale.create',event.id,{device_id:deviceId,total_cents:total});
 return {id:event.id,cloud_number:number,total_cents:total,warnings};
}
export function mountSync(app,db){
 const auth=authenticateDevice(db);
 app.get('/api/sync/catalog',auth,(req,res)=>res.json(catalogFor(db,req.user,req.deviceId)));
 app.post('/api/sync/events',auth,(req,res)=>{
  const body=z.object({events:z.array(eventSchema).min(1).max(20)}).safeParse(req.body);
  if(!body.success)fail(400,'Lote de sincronización inválido.');
  // Each event commits separately. Lost batch responses can always replay accepted prefixes.
  const accepted=[];
  for(const event of body.data.events){
   try{accepted.push({event_id:event.id,...ingestEvent(db,req.user,req.deviceId,event)});}
   catch(error){if(!error.status)throw error;return res.json({accepted,rejected:{event_id:event.id,status:error.status,error:error.message}});}
  }
  res.json({accepted});
 });
}
export function mountDeviceAdmin(app,db){
 app.post('/api/devices/register',(req,res)=>{
  const input=z.object({device_id:uuid,name:text(80)}).safeParse(req.body);if(!input.success)fail(400,'Datos del dispositivo inválidos.');
  res.status(201).json(registerDevice(db,req.user,input.data));
 });
 app.get('/api/devices',admin,(_,res)=>res.json(db.prepare('SELECT d.*,u.username,a.user_id,a.revoked FROM sync_devices d JOIN device_access a ON a.device_id=d.id JOIN users u ON u.id=a.user_id ORDER BY d.created_at').all()));
 app.post('/api/devices/:id/revoke',admin,(req,res)=>{transaction(db,()=>{db.prepare('UPDATE device_access SET revoked=1 WHERE device_id=?').run(req.params.id);audit(db,req.user.id,'device.revoke',req.params.id);});res.json({ok:true});});
 app.get('/api/sync-issues',admin,(_,res)=>res.json({issues:db.prepare('SELECT * FROM sync_issues ORDER BY created_at DESC LIMIT 200').all().map(i=>({...i,detail:JSON.parse(i.detail)})),stock_debts:db.prepare('SELECT d.*,p.name FROM stock_debts d JOIN products p ON p.id=d.product_id WHERE d.quantity_milli>0').all()}));
}
