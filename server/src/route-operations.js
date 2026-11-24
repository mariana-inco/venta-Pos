import {currentOpening,deliveredProducts,cycleSummary,cycleAccess,openCycle} from './route-cycles.js';
import {assertRouteNotReserved} from './offline-route.js';
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
// Additional deliveries are scoped to one opening, never replace previous stock.
export function replaceDelivery(db,user,d){return transaction(db,()=>{
 const hash=digest(JSON.stringify(d)),old=db.prepare('SELECT * FROM delivery_batches WHERE request_key=?').get(d.request_key);if(old){if(old.request_hash!==hash)fail(409,'Referencia usada con otra entrega.');return old;}
 const route=db.prepare('SELECT * FROM routes WHERE id=? AND active=1').get(d.route_id);requireOpenRoute(db,route);assertRouteNotReserved(db,route.id);
 const opening=currentOpening(db,route.id);if(d.opening_id&&d.opening_id!==opening.id)fail(409,'La apertura cambió. Actualiza la entrega.');
 const delivered=new Set(deliveredProducts(db,opening.id)),batch=id(),at=now(),items=[],seen=new Set();
 for(const i of d.items){if(seen.has(i.product_id)||delivered.has(i.product_id))fail(409,'Este producto ya fue entregado en esta apertura. Usa Ajustes para modificarlo.');seen.add(i.product_id);const p=db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(i.product_id);if(!p)fail(400,'Producto desactivado o no disponible.');const qty=quantity(i.quantity,p.unit);let group=db.prepare('SELECT group_id FROM product_groups WHERE product_id=?').get(p.id)?.group_id;
 if(!group){group=id();db.prepare('INSERT INTO inventory_groups VALUES (?,?,?)').run(group,p.name+' · '+group.slice(0,6),p.unit);db.prepare('INSERT INTO product_groups VALUES (?,?)').run(p.id,group);}
 if(db.prepare('SELECT active FROM inventory_group_status WHERE group_id=?').get(group)?.active===0)fail(409,'Grupo desactivado.');items.push({product_id:p.id,group_id:group,qty});}
 db.prepare('INSERT INTO delivery_batches VALUES (?,?,?,?,?,?,?)').run(batch,route.id,user.id,d.request_key,hash,at,d.note);
 for(const i of items){const stock=db.prepare('SELECT * FROM route_stock WHERE route_id=? AND group_id=?').get(route.id,i.group_id);if((stock?.available_milli||0)+i.qty>100_000_000_000)fail(400,'Inventario fuera de rango.');db.prepare('INSERT INTO route_stock VALUES (?,?,?,?) ON CONFLICT(route_id,group_id) DO UPDATE SET initial_milli=initial_milli+excluded.initial_milli,available_milli=available_milli+excluded.available_milli').run(route.id,i.group_id,i.qty,i.qty);db.prepare('INSERT INTO stock_movements VALUES (?,?,?,?,?,?,?,?,?,?)').run(id(),route.id,i.group_id,i.product_id,null,i.qty,'assign',user.id,d.note,at);db.prepare('INSERT INTO delivery_items VALUES (?,?,?)').run(batch,i.product_id,i.qty);}
 audit(db,user.id,'inventory.delivery.additional',batch,{...d,opening_id:opening.id});return db.prepare('SELECT * FROM delivery_batches WHERE id=?').get(batch);
 });}
export function closeRoute(db,user,at=now(),options={}){return transaction(db,()=>{
 const route=options.route_id?db.prepare('SELECT * FROM routes WHERE id=? AND active=1').get(options.route_id):routeFor(db,user);if(route)cycleAccess(db,user,route.id);requireOpenRoute(db,route,at);assertRouteNotReserved(db,route.id);
 const opening=currentOpening(db,route.id);if(options.opening_id&&options.opening_id!==opening.id)fail(409,'La apertura cambió. Revisa el resumen antes de cerrar.');
 const inventory=cycleSummary(db,opening),key=id(),day=dayOf(at);if(options.review_key&&options.review_key!==inventory.review_key)fail(409,'El consolidado cambió. Actualiza y revisa el cierre nuevamente.');
 for(const g of inventory.groups){const actual=db.prepare('SELECT available_milli FROM route_stock WHERE route_id=? AND group_id=?').get(route.id,g.group_id)?.available_milli||0;if(actual!==g.final_milli)fail(409,'El inventario no coincide con sus movimientos. Revisa antes de cerrar.');}
 const snapshot={version:4,opening_id:opening.id,opened_at:opening.created_at,opened_by:opening.actor_name||'Saldo de transición',stock_movement_cursor:db.prepare('SELECT COALESCE(MAX(rowid),0) n FROM stock_movements').get().n,route:{...route},responsible:{id:user.id,name:user.name},day,closed_at:at,total_cents:inventory.total_cents,inventory};
 for(const g of db.prepare('SELECT * FROM route_stock WHERE route_id=?').all(route.id))if(g.available_milli)db.prepare('INSERT INTO stock_movements VALUES (?,?,?,?,?,?,?,?,?,?)').run(id(),route.id,g.group_id,null,null,-g.available_milli,'adjust',user.id,'Cierre de ruta '+key,at);
 db.prepare('UPDATE route_stock SET available_milli=0,initial_milli=0 WHERE route_id=?').run(route.id);
 db.prepare('INSERT INTO route_cycle_closures VALUES(?,?,?,?,?)').run(key,opening.id,user.id,at,JSON.stringify(snapshot));
 db.prepare('INSERT INTO daily_closures VALUES (?,?,?,?,?,?)').run(key,route.id,day,user.id,at,JSON.stringify(snapshot));
 audit(db,user.id,'route.cycle.close',key,{route_id:route.id,opening_id:opening.id,total_cents:inventory.total_cents});return {id:key,route_id:route.id,day,actor_id:user.id,created_at:at,snapshot};
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
 openCycle(db,user,{route_id:c.route_id,request_key:input.request_key});audit(db,user.id,'route.reopen',key,snapshot);return {id:key,created_at:at,snapshot};
 });}
