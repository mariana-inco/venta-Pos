import {z} from 'zod';
import {id,now,transaction,audit} from './db.js';
import {fail} from './service.js';
import {admin,digest} from './auth.js';
import {routeFor} from './commerce.js';
import {assertRouteNotReserved} from './offline-route.js';
import {validate} from './validation.js';
export const currentOpening=(db,routeId)=>db.prepare('SELECT o.*,u.name actor_name FROM route_openings o LEFT JOIN users u ON u.id=o.actor_id WHERE o.route_id=? AND NOT EXISTS(SELECT 1 FROM route_cycle_closures c WHERE c.opening_id=o.id) ORDER BY o.rowid DESC LIMIT 1').get(routeId)||null;
export function migrateRouteCycles(db){transaction(db,()=>{
 if(db.prepare('SELECT 1 FROM route_cycle_migration').get())return;
 // Preserve actual stock as a transition balance. No deliveries, sales or dates are fabricated.
 for(const r of db.prepare('SELECT * FROM routes WHERE active=1 AND EXISTS(SELECT 1 FROM route_stock WHERE route_id=routes.id AND available_milli>0)').all()){
  const baseline=db.prepare('SELECT s.*,g.name,g.unit FROM route_stock s JOIN inventory_groups g ON g.id=s.group_id WHERE route_id=?').all(r.id);
  const openingId=id();db.prepare('INSERT INTO route_openings VALUES(?,?,?,?,?,?,1)').run(openingId,r.id,null,now(),null,JSON.stringify(baseline));
  const last=db.prepare('SELECT id FROM delivery_batches WHERE route_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1').get(r.id);if(last)db.prepare("INSERT INTO route_operation_links VALUES('delivery',?,?)").run(last.id,openingId);
 }
 db.prepare('INSERT INTO route_cycle_migration VALUES(1,?)').run(now());
 });}
export function openCycle(db,user,input){return transaction(db,()=>{
 if(user.role!=='admin')fail(403,'Solo el administrador puede abrir rutas.');
 const old=db.prepare('SELECT * FROM route_openings WHERE request_key=?').get(input.request_key);
 if(old){if(old.route_id!==input.route_id||old.actor_id!==user.id)fail(409,'Referencia de apertura utilizada.');return old;}
 const route=db.prepare('SELECT * FROM routes WHERE id=? AND active=1').get(input.route_id);if(!route)fail(404,'Selecciona una ruta activa.');
 assertRouteNotReserved(db,route.id);if(currentOpening(db,route.id))fail(409,'La ruta ya está abierta.');
 const baseline=db.prepare('SELECT s.*,g.name,g.unit FROM route_stock s JOIN inventory_groups g ON g.id=s.group_id WHERE route_id=?').all(route.id);
 const row={id:id(),route_id:route.id,actor_id:user.id,created_at:now(),request_key:input.request_key,baseline:JSON.stringify(baseline),transition:0};
 db.prepare('INSERT INTO route_openings VALUES(?,?,?,?,?,?,0)').run(row.id,row.route_id,row.actor_id,row.created_at,row.request_key,row.baseline);audit(db,user.id,'route.cycle.open',row.id,{route_id:route.id});return row;
 });}
export const deliveredProducts=(db,openingId)=>db.prepare("SELECT DISTINCT i.product_id FROM delivery_items i JOIN route_operation_links l ON l.kind='delivery' AND l.event_id=i.batch_id WHERE l.opening_id=? AND i.quantity_milli>0").all(openingId).map(x=>x.product_id);
export function cycleSummary(db,opening){
 const baseline=JSON.parse(opening.baseline),moves=db.prepare("SELECT m.* FROM stock_movements m JOIN route_operation_links l ON l.kind='movement' AND l.event_id=m.id WHERE l.opening_id=? ORDER BY m.rowid").all(opening.id),ids=new Set([...baseline.map(g=>g.group_id),...moves.map(m=>m.group_id)]);
 const groups=[...ids].map(groupId=>{
  const original=baseline.find(g=>g.group_id===groupId),g=db.prepare('SELECT * FROM inventory_groups WHERE id=?').get(groupId),ms=moves.filter(m=>m.group_id===groupId),sum=kind=>ms.filter(m=>kind.includes(m.kind)).reduce((n,m)=>n+m.quantity_milli,0);
  const carried=original?.available_milli||0,assigned=sum(['assign']),adjusted=sum(['adjust']),sold=-sum(['sale','void']),delivered=carried+assigned+adjusted,available=delivered-sold;
  const productIds=[...new Set([...ms.map(m=>m.product_id).filter(Boolean),...db.prepare('SELECT product_id FROM product_groups WHERE group_id=?').all(groupId).map(x=>x.product_id)])];
  const shared=productIds.length>1;
  return {group_id:groupId,name:g?.name||original?.name||'Inventario histórico',unit:g?.unit||original?.unit,initial_milli:db.prepare('SELECT initial_milli FROM route_stock WHERE route_id=? AND group_id=?').get(opening.route_id,groupId)?.initial_milli||0,opening_milli:carried,assigned_milli:assigned,adjusted_milli:adjusted,delivered_milli:delivered,sold_milli:sold,available_milli:available,final_milli:available,shared,products:productIds.map(pid=>{const p=db.prepare('SELECT name FROM products WHERE id=?').get(pid),pm=ms.filter(m=>m.product_id===pid);return {product_id:pid,name:p?.name||'Producto histórico',delivered_milli:shared?null:delivered,adjusted_milli:shared?null:adjusted,assigned_milli:pm.filter(m=>m.kind==='assign').reduce((n,m)=>n+m.quantity_milli,0),sold_milli:-pm.filter(m=>m.kind==='sale'||m.kind==='void').reduce((n,m)=>n+m.quantity_milli,0),remaining_milli:shared?null:available};})};
 });
 const sales=db.prepare("SELECT s.* FROM sales s JOIN route_operation_links l ON l.kind='sale' AND l.event_id=s.id WHERE l.opening_id=? AND NOT EXISTS(SELECT 1 FROM sale_voids v WHERE v.sale_id=s.id)").all(opening.id);
 return {review_key:digest(JSON.stringify({opening_id:opening.id,groups,sales:sales.map(s=>s.id)})),opening_id:opening.id,route_id:opening.route_id,opened_at:opening.created_at,opened_by:opening.actor_name||'Saldo de transición',groups,total_cents:sales.reduce((n,s)=>n+s.total_cents,0),sale_count:sales.length,totals:['kg','unit'].map(unit=>({unit,delivered_milli:groups.filter(g=>g.unit===unit).reduce((n,g)=>n+g.delivered_milli,0),sold_milli:groups.filter(g=>g.unit===unit).reduce((n,g)=>n+g.sold_milli,0),remaining_milli:groups.filter(g=>g.unit===unit).reduce((n,g)=>n+g.final_milli,0)}))};
}
export function cycleAccess(db,user,routeId){if(user.role!=='admin'&&routeFor(db,user)?.id!==routeId)fail(403,'No puedes operar una ruta ajena.');}
export function mountRouteCycles(app,db){
 app.get('/api/route-cycles',(req,res)=>res.json(db.prepare("SELECT * FROM routes WHERE active=1 ORDER BY name").all().filter(r=>req.user.role==='admin'||r.id===routeFor(db,req.user)?.id).map(r=>({...r,opening:currentOpening(db,r.id)}))));
 app.post('/api/route-cycles/open',admin,validate(z.object({route_id:z.string().uuid(),request_key:z.string().uuid()}).strict()),(req,res)=>res.json(openCycle(db,req.user,req.input)));
 app.get('/api/route-cycles/:route/summary',(req,res)=>{cycleAccess(db,req.user,req.params.route);const opening=currentOpening(db,req.params.route);res.json({opening,summary:opening?cycleSummary(db,opening):null,delivered_products:opening?deliveredProducts(db,opening.id):[]});});
 app.get('/api/route-cycle-closures',(req,res)=>{
  const filter=z.object({route_id:z.string().uuid().optional(),from:z.iso.date().optional(),to:z.iso.date().optional(),page:z.coerce.number().int().min(1).default(1)}).parse(req.query);if(filter.from&&filter.to&&filter.from>filter.to)fail(400,'Revisa el rango de fechas.');
  const where=[],args=[];if(req.user.role!=='admin'){where.push('route_id=?');args.push(routeFor(db,req.user)?.id||'');}if(filter.route_id){where.push('route_id=?');args.push(filter.route_id);}if(filter.from){where.push('created_at>=?');args.push(filter.from+'T05:00:00.000Z');}if(filter.to){where.push('created_at<?');args.push(new Date(Date.parse(filter.to+'T05:00:00.000Z')+86400000).toISOString());}
  const cte="WITH history AS (SELECT c.id,c.opening_id,c.actor_id,c.created_at,c.snapshot,o.route_id FROM route_cycle_closures c JOIN route_openings o ON o.id=c.opening_id UNION ALL SELECT d.id,NULL,d.actor_id,d.created_at,d.snapshot,d.route_id FROM daily_closures d WHERE NOT EXISTS(SELECT 1 FROM route_cycle_closures c WHERE c.id=d.id)) ",condition=where.length?' WHERE '+where.join(' AND '):'';
  const count=db.prepare(cte+'SELECT COUNT(*) n FROM history'+condition).get(...args).n,closures=db.prepare(cte+'SELECT * FROM history'+condition+' ORDER BY created_at DESC,id LIMIT 30 OFFSET ?').all(...args,(filter.page-1)*30).map(c=>({...c,snapshot:JSON.parse(c.snapshot)}));res.json({count,page:filter.page,closures});
 });
}
