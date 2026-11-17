import {activeRouteClosure} from './route-state.js';
import {id,now,transaction,audit} from './db.js';
import {digest} from './auth.js';
import {fail} from './service.js';
import {routeFor} from './commerce.js';
import {requireOpenRoute,dayOf,results,inventoryReport} from './business.js';
import {quantity} from './money.js';
export function setCustomerRoute(db,user,customerId,routeId,identification=''){
 if(!db.prepare('SELECT 1 FROM customers WHERE id=?').get(customerId))fail(404,'Cliente no encontrado.');
 const route=db.prepare('SELECT * FROM routes WHERE id=? AND active=1').get(routeId);if(!route)fail(400,'Selecciona una ruta activa para el cliente.');
 if(user.role!=='admin'&&routeFor(db,user)?.id!==routeId)fail(403,'No puedes asignar clientes a otra ruta.');
 const before=db.prepare('SELECT * FROM customer_routes WHERE customer_id=?').all(customerId);
 db.prepare('DELETE FROM customer_routes WHERE customer_id=?').run(customerId);db.prepare('INSERT INTO customer_routes VALUES (?,?,?)').run(customerId,routeId,identification||before.find(r=>r.route_id===routeId)?.identification||'');
 audit(db,user.id,'customer.route',customerId,{before,route_id:routeId});
}
// A delivery is a complete replacement snapshot, including zero for omitted groups.
export function replaceDelivery(db,user,d){return transaction(db,()=>{
 const hash=digest(JSON.stringify(d)),old=db.prepare('SELECT * FROM delivery_batches WHERE request_key=?').get(d.request_key);if(old){if(old.request_hash!==hash)fail(409,'Referencia usada con otra entrega.');return old;}
 const route=db.prepare('SELECT * FROM routes WHERE id=? AND active=1').get(d.route_id);requireOpenRoute(db,route);
 const batch=id(),at=now(),targets=new Map(),items=[],seen=new Set();
 for(const i of d.items){if(seen.has(i.product_id))fail(400,'No repitas productos.');seen.add(i.product_id);const p=db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(i.product_id);if(!p)fail(400,'Producto desactivado o no disponible.');const qty=quantity(i.quantity,p.unit);let group=db.prepare('SELECT group_id FROM product_groups WHERE product_id=?').get(p.id)?.group_id;
  if(!group){group=id();db.prepare('INSERT INTO inventory_groups VALUES (?,?,?)').run(group,p.name+' · '+group.slice(0,6),p.unit);db.prepare('INSERT INTO product_groups VALUES (?,?)').run(p.id,group);}
  const sum=(targets.get(group)||0)+qty;if(sum>100_000_000_000)fail(400,'Cantidad fuera de rango.');targets.set(group,sum);items.push({product_id:p.id,group_id:group,qty});
 }
 db.prepare('INSERT INTO delivery_batches VALUES (?,?,?,?,?,?,?)').run(batch,route.id,user.id,d.request_key,hash,at,d.note);
 for(const s of db.prepare('SELECT * FROM route_stock WHERE route_id=?').all(route.id)){
  if(s.available_milli)db.prepare('INSERT INTO stock_movements VALUES (?,?,?,?,?,?,?,?,?,?)').run(id(),route.id,s.group_id,null,null,-s.available_milli,'adjust',user.id,'Reemplazo por entrega '+batch,at);
 }
 db.prepare('UPDATE route_stock SET initial_milli=0,available_milli=0 WHERE route_id=?').run(route.id);
 for(const [group,qty] of targets)db.prepare('INSERT INTO route_stock VALUES (?,?,?,?) ON CONFLICT(route_id,group_id) DO UPDATE SET initial_milli=excluded.initial_milli,available_milli=excluded.available_milli').run(route.id,group,qty,qty);
 for(const i of items){db.prepare('INSERT INTO stock_movements VALUES (?,?,?,?,?,?,?,?,?,?)').run(id(),route.id,i.group_id,i.product_id,null,i.qty,'assign',user.id,d.note,at);db.prepare('INSERT INTO delivery_items VALUES (?,?,?)').run(batch,i.product_id,i.qty);}
 audit(db,user.id,'inventory.delivery.replace',batch,d);return db.prepare('SELECT * FROM delivery_batches WHERE id=?').get(batch);
 });}
export function closeRoute(db,user,at=now()){return transaction(db,()=>{
 const route=routeFor(db,user);requireOpenRoute(db,route,at);const day=dayOf(at),key=id();
 const financial=results(db,{route_id:route.id,from:day,to:day}),inventory=inventoryReport(db,route.id,day,day);
 const snapshot={version:3,stock_movement_cursor:db.prepare('SELECT COALESCE(MAX(rowid),0) n FROM stock_movements').get().n,route:{...route},responsible:{id:user.id,name:user.name},day,closed_at:at,total_cents:financial.total_cents,financial,inventory};
 db.prepare('INSERT INTO daily_closures VALUES (?,?,?,?,?,?)').run(key,route.id,day,user.id,at,JSON.stringify(snapshot));
 for(const s of db.prepare('SELECT * FROM route_stock WHERE route_id=?').all(route.id))if(s.available_milli)db.prepare('INSERT INTO stock_movements VALUES (?,?,?,?,?,?,?,?,?,?)').run(id(),route.id,s.group_id,null,null,-s.available_milli,'adjust',user.id,'Cierre de ruta '+key,at);
 db.prepare('UPDATE route_stock SET available_milli=0,initial_milli=0 WHERE route_id=?').run(route.id);
 audit(db,user.id,'route.close',key,{route_id:route.id,day,total_cents:financial.total_cents});return {id:key,route_id:route.id,day,actor_id:user.id,created_at:at,snapshot};
 });}

export function reopenRoute(db,user,input,at=now()){return transaction(db,()=>{
 if(user.role!=='admin')fail(403,'Solo el administrador puede abrir una ruta cerrada.');
 const previous=db.prepare('SELECT * FROM route_reopenings WHERE request_key=?').get(input.request_key);
 if(previous){if(previous.closure_id!==input.closure_id||previous.actor_id!==user.id)fail(409,'Referencia usada para otra reapertura.');return {...previous,snapshot:JSON.parse(previous.snapshot)};}
 const c=db.prepare('SELECT * FROM daily_closures WHERE id=?').get(input.closure_id);
 if(!c)fail(404,'Cierre no encontrado.');
 if(c.day!==dayOf(at))fail(409,'Solo puedes abrir una ruta de la jornada actual.');
 if(activeRouteClosure(db,c.route_id,c.day)?.id!==c.id)fail(409,'Ese cierre ya fue reabierto. Actualiza la ruta.');
 if(!db.prepare('SELECT 1 FROM routes WHERE id=? AND active=1').get(c.route_id))fail(409,'Activa la ruta antes de abrirla.');
 const s=JSON.parse(c.snapshot),groups=s.inventory?.groups;
 if(!Array.isArray(groups))fail(409,'Este cierre no tiene inventario recuperable.');
 const note='Cierre de ruta '+c.id;
 const after=s.stock_movement_cursor!=null?db.prepare('SELECT * FROM stock_movements WHERE route_id=? AND rowid>? AND note<>?').all(c.route_id,s.stock_movement_cursor,note):db.prepare('SELECT * FROM stock_movements WHERE route_id=? AND created_at>?').all(c.route_id,c.created_at);
 if(after.length)fail(409,'Hubo cambios de inventario después del cierre. Revisa los movimientos antes de abrir la ruta.');
 const stock=db.prepare('SELECT * FROM route_stock WHERE route_id=?').all(c.route_id);
 if(stock.length!==groups.length||stock.some(g=>g.initial_milli!==0||g.available_milli!==0||!groups.some(x=>x.group_id===g.group_id)))fail(409,'El inventario cambió después del cierre. No se puede restaurar automáticamente.');
 for(const g of groups){
  if(!Number.isSafeInteger(g.initial_milli)||!Number.isSafeInteger(g.available_milli)||g.initial_milli<0||g.available_milli<0)fail(409,'Inventario histórico inválido.');
  db.prepare('UPDATE route_stock SET initial_milli=?,available_milli=? WHERE route_id=? AND group_id=?').run(g.initial_milli,g.available_milli,c.route_id,g.group_id);
  if(g.available_milli)db.prepare('INSERT INTO stock_movements VALUES (?,?,?,?,?,?,?,?,?,?)').run(id(),c.route_id,g.group_id,null,null,g.available_milli,'adjust',user.id,'Reapertura de ruta '+c.id,at);
 }
 const key=id(),snapshot={route_id:c.route_id,day:c.day,closure_id:c.id,restored_stock:groups.map(g=>({group_id:g.group_id,initial_milli:g.initial_milli,available_milli:g.available_milli}))};
 db.prepare('INSERT INTO route_reopenings VALUES (?,?,?,?,?,?)').run(key,c.id,user.id,at,input.request_key,JSON.stringify(snapshot));
 audit(db,user.id,'route.reopen',key,snapshot);return {id:key,created_at:at,snapshot};
 });}
