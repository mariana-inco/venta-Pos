import {id,now,transaction,audit} from './db.js';
import {fail,sessionFor,recordSale,totals} from './service.js';
import {routeFor,customerBalance} from './commerce.js';
import {agentsFor,requireOpenRoute,dayOf} from './business.js';
import {reserveReceipts} from './receipt-numbers.js';
import {digest} from './auth.js';
export function assertRouteNotReserved(db,routeId){
 if(db.prepare("SELECT 1 FROM offline_route_reservations WHERE route_id=? AND state<>'released'").get(routeId))fail(409,'La ruta tiene ventas sin internet habilitadas. Sincroniza y finaliza ese modo en la terminal antes de continuar.');
}
export function activeReservation(db,user,deviceId){return db.prepare("SELECT * FROM offline_route_reservations WHERE device_id=? AND user_id=? AND state='active'").get(deviceId,user.id)||null;}
export function prepareOfflineRoute(db,user,deviceId,sessionId,catalogFactory){return transaction(db,()=>{
 const old=activeReservation(db,user,deviceId);if(old){if(old.session_id!==sessionId)fail(409,'Finaliza la reserva anterior de esta terminal.');return old;}
 const route=routeFor(db,user);requireOpenRoute(db,route);assertRouteNotReserved(db,route.id);
 const session=sessionFor(db,user,sessionId);if(session.opened_by!==user.id||session.state!=='open')fail(403,'Prepara tu propia caja abierta.');
 if(db.prepare("SELECT 1 FROM offline_route_reservations WHERE device_id=? AND state<>'released'").get(deviceId))fail(409,'La terminal ya tiene una ruta reservada.');
 const catalog=catalogFactory(),key=id();
 catalog.customers=catalog.customers.map(c=>({...c,balance_cents:customerBalance(db,c.id)}));
 const payload={...catalog,sales_policy:'route-offline-v1',agents:agentsFor(db,user),session:{...session,...totals(db,session.id)},reservation_id:key,reservation_day:dayOf(now()),reservation_sequence:catalog.ack_sequence,receipt_ranges:reserveReceipts(db,deviceId)};
 payload.version=digest(JSON.stringify(payload));
 db.prepare('INSERT INTO offline_route_reservations VALUES (?,?,?,?,?,?,?,?,?,?)').run(key,deviceId,user.id,route.id,session.id,payload.reservation_day,now(),null,JSON.stringify(payload),'active');
 audit(db,user.id,'route.offline.prepare',key,{route_id:route.id,device_id:deviceId,session_id:session.id});return activeReservation(db,user,deviceId);
 });}
export function releaseOfflineRoute(db,user,deviceId,sequence){return transaction(db,()=>{
 const r=activeReservation(db,user,deviceId);if(!r)return {ok:true};
 if(db.prepare('SELECT last_sequence FROM sync_devices WHERE id=?').get(deviceId).last_sequence!==sequence)fail(409,'Quedan operaciones sin sincronizar.');
 db.prepare("UPDATE offline_route_reservations SET state='released',released_at=? WHERE id=?").run(now(),r.id);
 audit(db,user.id,'route.offline.release',r.id,{route_id:r.route_id});return {ok:true};
 });}
export function ingestRouteSale(db,user,deviceId,event){
 const d=event.data,r=activeReservation(db,user,deviceId);
 if(!r||r.id!==d.reservation_id)fail(409,'La reserva de esta venta no está activa. La venta queda conservada para revisión.');
 const c=JSON.parse(r.payload),input=d.input;
 if(c.version!==d.catalog_version||dayOf(event.created_at)!==r.day||Date.parse(event.created_at)<Date.parse(r.created_at)-300000||Date.parse(event.created_at)>Date.now()+300000)fail(409,'La fecha o catálogo de la venta no corresponde a su reserva.');
 if(input.session_id!==r.session_id||routeFor(db,user)?.id!==r.route_id||input.request_key!==event.id||input.draft_id!==event.id)fail(403,'La venta no corresponde a esta caja, ruta o terminal.');
 if(!['cash','credit'].includes(input.method)||(input.initial_payment&&Number(input.initial_payment)>0&&input.initial_method!=='cash')||input.payments?.length)fail(400,'Los pagos electrónicos requieren conexión para verificar sus referencias.');
 const customer=c.customers.find(x=>x.id===input.customer_id&&x.active),agent=c.agents.find(x=>x.id===input.agent_id);
 if(!customer||!agent)fail(403,'Cliente o vendedor no autorizado en el catálogo reservado.');
 const prices={};for(const p of c.products.filter(p=>p.active))prices[p.id]={price_cents:customer.customer_type==='wholesale'?p.wholesale_price_cents:p.price_cents,unit:p.unit};
 const old=db.prepare('SELECT * FROM sale_drafts WHERE id=?').get(event.id);
 if(old&&(old.user_id!==user.id||old.customer_id!==input.customer_id||old.agent_id!==input.agent_id))fail(409,'Referencia de venta utilizada.');
 if(!old)db.prepare('INSERT INTO sale_drafts VALUES (?,?,?,?,?,?,?,?,?)').run(event.id,user.id,agent.id,customer.id,r.route_id,customer.customer_type||'normal',JSON.stringify(prices),digest(JSON.stringify({customer_id:customer.id,agent_id:agent.id})),event.created_at);
 db.prepare("UPDATE offline_route_reservations SET state='syncing' WHERE id=?").run(r.id);
 const sale=recordSale(db,user,input,{id:event.id,createdAt:event.created_at,deviceId,receiptSequence:d.receipt_sequence,catalog:c,customer,agent});
 db.prepare("UPDATE offline_route_reservations SET state='active' WHERE id=?").run(r.id);
 return {id:sale.id,total_cents:sale.total_cents,cloud_number:sale.number,receipt_number:sale.snapshot.receipt_number};
}
