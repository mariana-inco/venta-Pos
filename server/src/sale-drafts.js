import {currentOpening} from './route-cycles.js';
import {id,now,transaction} from './db.js';
import {digest} from './auth.js';
import {fail} from './service.js';
import {routeFor,productsFor} from './commerce.js';
import {agentsFor,typeFor,requireOpenRoute} from './business.js';
export function startSale(db,user,input){return transaction(db,()=>{
 const key=input.request_key||id(),hash=digest(JSON.stringify({customer_id:input.customer_id,agent_id:input.agent_id}));
 const previous=db.prepare('SELECT * FROM sale_drafts WHERE id=?').get(key);
 if(previous){if(previous.user_id!==user.id||previous.request_hash!==hash)fail(409,'La venta iniciada ya tiene otro cliente o vendedor.');return {...previous,prices:JSON.parse(previous.prices)};}
 const route=routeFor(db,user);requireOpenRoute(db,route);
 if(!agentsFor(db,user).some(a=>a.id===input.agent_id))fail(400,'Selecciona un vendedor asociado a tu usuario.');
 const customer=db.prepare('SELECT * FROM customers WHERE id=? AND active=1').get(input.customer_id);
 if(!customer||!db.prepare('SELECT 1 FROM customer_routes WHERE customer_id=? AND route_id=?').get(customer?.id||'',route.id))fail(403,'El cliente no pertenece a tu ruta.');
 const type=typeFor(db,customer.id),prices={};for(const p of productsFor(db,user).filter(p=>p.active&&p.stock_milli>0))prices[p.id]={price_cents:type==='wholesale'?p.wholesale_price_cents:p.price_cents,unit:p.unit};
 const at=now();db.prepare('INSERT INTO sale_drafts VALUES (?,?,?,?,?,?,?,?,?)').run(key,user.id,input.agent_id,customer.id,route.id,type,JSON.stringify(prices),hash,at);
 return {id:key,user_id:user.id,agent_id:input.agent_id,customer_id:customer.id,route_id:route.id,customer_type:type,prices,created_at:at};
 });}
export function lockedSale(db,user,input,route){
 const draft=db.prepare('SELECT * FROM sale_drafts WHERE id=? AND user_id=?').get(input.draft_id||'',user.id);
 if(!draft)fail(400,'Inicia la venta seleccionando primero vendedor y cliente.');
 if(input.request_key!==draft.id||draft.customer_id!==input.customer_id||draft.agent_id!==input.agent_id||draft.route_id!==route.id)fail(409,'No se puede cambiar el cliente, vendedor o ruta de una venta iniciada.');
 const link=db.prepare("SELECT opening_id FROM route_operation_links WHERE kind='draft' AND event_id=?").get(draft.id);if(link&&link.opening_id!==currentOpening(db,route.id)?.id)fail(409,'La apertura de esta venta ya está cerrada. Inicia otra venta.');
 return {...draft,prices:JSON.parse(draft.prices)};
}
