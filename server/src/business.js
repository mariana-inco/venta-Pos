import {z} from 'zod';
import {id,now,transaction,audit} from './db.js';
import {admin,digest} from './auth.js';
import {fail} from './service.js';
import {routeFor,account,customerAccess,balance,productsFor} from './commerce.js';
import {money,quantity} from './money.js';
import {validate} from './validation.js';
import {statementPdf} from './statement-pdf.js';
const uuid=z.string().uuid(),text=z.string().trim().min(1).max(120);
export const dayOf=value=>new Date(new Date(value).getTime()-5*3600000).toISOString().slice(0,10);
export function period(from,to){
 const date=z.iso.date();if((from&&!date.safeParse(from).success)||(to&&!date.safeParse(to).success)||(from&&to&&from>to))fail(400,'Revisa el rango de fechas (AAAA-MM-DD).');
 const end=to||dayOf(now());return {from:from||null,to:end,start:from?`${from}T05:00:00.000Z`:null,end:new Date(new Date(`${end}T05:00:00.000Z`).getTime()+86400000).toISOString()};
}
export const typeFor=(db,id)=>db.prepare('SELECT customer_type FROM customer_profiles WHERE customer_id=?').get(id)?.customer_type||'normal';
export const priced=(db,p,type)=>{if(type!=='wholesale')return p.price_cents;const value=db.prepare('SELECT wholesale_price_cents n FROM product_pricing WHERE product_id=?').get(p.id)?.n;if(!value)fail(409,`Configura el precio mayorista de ${p.name}.`);return value;};
export function requireOpenRoute(db,route,at=now()){
 if(!route)fail(409,'El administrador debe asignar una ruta al usuario antes de operar.');
 if(db.prepare('SELECT 1 FROM daily_closures WHERE route_id=? AND day=?').get(route.id,dayOf(at)))fail(409,'La ruta ya tiene cierre de este día. Opera en la siguiente jornada.');
}
export function agentsFor(db,user){return db.prepare(`SELECT * FROM sales_agents WHERE user_id=? AND active=1 ORDER BY name`).all(user.id);}
export function customerView(db,c){return {...c,customer_type:typeFor(db,c.id)};}
export function inventoryReport(db,routeId,from,to){
 const p=period(from,to),start=p.start||'0000',end=p.end;
 const groups=db.prepare('SELECT s.*,g.name,g.unit FROM route_stock s JOIN inventory_groups g ON g.id=s.group_id WHERE route_id=?').all(routeId).map(g=>{
  const moves=db.prepare('SELECT * FROM stock_movements WHERE route_id=? AND group_id=? ORDER BY created_at,rowid').all(routeId,g.group_id);
  const selected=moves.filter(m=>m.created_at>=start&&m.created_at<end);
  const sum=rows=>rows.reduce((n,m)=>n+m.quantity_milli,0);
  const opening=g.available_milli-sum(moves.filter(m=>m.created_at>=start));
  return {...g,opening_milli:opening,assigned_milli:sum(selected.filter(m=>m.kind==='assign')),sold_milli:-sum(selected.filter(m=>m.kind==='sale'||m.kind==='void')),adjusted_milli:sum(selected.filter(m=>m.kind==='adjust')),final_milli:opening+sum(selected),products:db.prepare('SELECT p.id,p.name FROM products p JOIN product_groups pg ON pg.product_id=p.id WHERE pg.group_id=? ORDER BY p.name').all(g.group_id).map(product=>({...product,assigned_milli:sum(selected.filter(m=>m.kind==='assign'&&m.product_id===product.id)),sold_milli:-sum(selected.filter(m=>(m.kind==='sale'||m.kind==='void')&&m.product_id===product.id)),shared_group:g.group_id}))};
 });return {route_id:routeId,from:p.from,to:p.to,groups};
}
export function results(db,{route_id,user_id,from,to,session_id}={}){
 const p=period(from,to);
 const sales=db.prepare('SELECT s.*,t.credit,t.route_id,a.agent_id FROM sales s LEFT JOIN sale_terms t ON t.sale_id=s.id LEFT JOIN sale_agents a ON a.sale_id=s.id WHERE NOT EXISTS(SELECT 1 FROM sale_voids v WHERE v.sale_id=s.id) ORDER BY s.created_at').all().filter(s=>(!route_id||s.route_id===route_id)&&(!user_id||s.seller_id===user_id)&&(!session_id||s.session_id===session_id)&&(!p.start||s.created_at>=p.start)&&s.created_at<p.end);
 const collections=db.prepare('SELECT c.*,u.name user_name FROM collections c JOIN users u ON u.id=c.seller_id WHERE NOT EXISTS(SELECT 1 FROM collection_reversals r WHERE r.collection_id=c.id) ORDER BY c.created_at').all().filter(c=>(!route_id||c.route_id===route_id)&&(!user_id||c.seller_id===user_id)&&(!session_id||c.session_id===session_id)&&(!p.start||c.created_at>=p.start)&&c.created_at<p.end);
 const summary=rows=>{
  const keys=new Set(rows.map(s=>s.id));const payments=db.prepare('SELECT * FROM payments').all().filter(r=>keys.has(r.sale_id));
  const sum=(arr,key)=>arr.reduce((n,r)=>n+r[key],0);
  const cash=sum(payments.filter(r=>r.method==='cash'),'amount_cents'),electronic=sum(payments.filter(r=>r.method==='electronic'),'amount_cents');
  return {sale_count:rows.length,total_cents:sum(rows,'total_cents'),credit_cents:sum(rows.filter(s=>s.credit),'total_cents'),sale_cash_cents:cash,sale_electronic_cents:electronic};
 };
 const groups=new Map();for(const s of sales){const snap=JSON.parse(s.snapshot),key=s.seller_id+'/'+(s.agent_id||'legacy');const g=groups.get(key)||{user_id:s.seller_id,user_name:snap.user_name||db.prepare('SELECT name FROM users WHERE id=?').get(s.seller_id)?.name,agent_id:s.agent_id||null,seller_name:snap.seller_name,sales:[]};g.sales.push(s);groups.set(key,g);}
 const total=summary(sales),collectionCash=collections.filter(c=>c.method==='cash').reduce((n,c)=>n+c.amount_cents,0),collectionElectronic=collections.filter(c=>c.method==='electronic').reduce((n,c)=>n+c.amount_cents,0);
 return {from:p.from,to:p.to,...total,collection_cash_cents:collectionCash,collection_electronic_cents:collectionElectronic,collection_cents:collectionCash+collectionElectronic,cash_cents:total.sale_cash_cents+collectionCash,electronic_cents:total.sale_electronic_cents+collectionElectronic,by_seller:[...groups.values()].map(g=>({...g,sales:undefined,...summary(g.sales)})),by_user:[...new Set([...sales.map(s=>s.seller_id),...collections.map(c=>c.seller_id)])].map(uid=>{const userSales=sales.filter(s=>s.seller_id===uid),cs=collections.filter(c=>c.seller_id===uid);return {user_id:uid,name:db.prepare('SELECT name FROM users WHERE id=?').get(uid)?.name,...summary(userSales),collection_cash_cents:cs.filter(c=>c.method==='cash').reduce((n,c)=>n+c.amount_cents,0),collection_electronic_cents:cs.filter(c=>c.method==='electronic').reduce((n,c)=>n+c.amount_cents,0)};}),collections,sales:sales.map(s=>({...s,snapshot:JSON.parse(s.snapshot)}))};
}
export function statement(db,user,customerId,from,to){
 customerAccess(db,user,customerId);const customer=db.prepare('SELECT * FROM customers WHERE id=?').get(customerId);if(!customer)fail(404,'Cliente no encontrado.');
 const p=period(from,to),events=[];
 const invoices=account(db,user,customerId).invoices;
 for(const s of invoices){
  const items=db.prepare('SELECT name,quantity_milli,unit FROM sale_items WHERE sale_id=? ORDER BY rowid').all(s.id),credit=!!db.prepare('SELECT credit FROM sale_terms WHERE sale_id=?').get(s.id)?.credit;
  const initial=db.prepare('SELECT COALESCE(SUM(amount_cents),0) n FROM payments WHERE sale_id=?').get(s.id).n;
  events.push({id:s.id,created_at:s.created_at,kind:'sale',number:s.snapshot.receipt_number||`P-${String(s.number).padStart(2,'0')}`,description:items.map(i=>`${i.name} (${i.quantity_milli/1000} ${i.unit==='kg'?'KG':'UND'})`).join(', '),credit,total_cents:s.total_cents,amount_cents:s.total_cents-initial,initial_paid_cents:initial,method:db.prepare('SELECT method FROM payments WHERE sale_id=? LIMIT 1').get(s.id)?.method||'credit',user_id:s.seller_id,user_name:s.snapshot.user_name||s.snapshot.seller_name,seller_name:s.snapshot.seller_name});
  const v=db.prepare('SELECT * FROM sale_voids WHERE sale_id=?').get(s.id);if(v)events.push({id:s.id+'/void',created_at:v.created_at,kind:'void',number:s.snapshot.receipt_number||`P-${String(s.number).padStart(2,'0')}`,description:'Anulación: '+v.reason,amount_cents:-(s.total_cents-initial),user_id:v.actor_id});
 }
 const allowed=new Set(invoices.map(s=>s.id));
 for(const c of db.prepare('SELECT c.*,u.name user_name FROM collections c JOIN users u ON u.id=c.seller_id WHERE customer_id=?').all(customerId)){
  const applied=db.prepare('SELECT * FROM collection_allocations WHERE collection_id=?').all(c.id).filter(a=>allowed.has(a.sale_id)).reduce((n,a)=>n+a.amount_cents,0);if(!applied)continue;
  events.push({id:c.id,created_at:c.created_at,kind:'collection',number:'Abono',description:c.note||'Abono a cartera',amount_cents:-applied,method:c.method,user_id:c.seller_id,user_name:c.user_name});
  const r=db.prepare('SELECT * FROM collection_reversals WHERE collection_id=?').get(c.id);if(r)events.push({id:c.id+'/reverse',created_at:r.created_at,kind:'reversal',number:'Reversión',description:r.reason,amount_cents:applied,method:c.method,user_id:r.actor_id});
 }
 events.sort((a,b)=>a.created_at.localeCompare(b.created_at)||((a.kind==='sale'?0:a.kind==='collection'?1:2)-(b.kind==='sale'?0:b.kind==='collection'?1:2)||a.id.localeCompare(b.id)));
 let running=0,opening=0;const movements=[];for(const e of events){running+=e.amount_cents;if(p.start&&e.created_at<p.start)opening=running;else if(e.created_at<p.end)movements.push({...e,balance_cents:running});}
 const until=events.filter(e=>e.created_at<p.end),current=events.reduce((n,e)=>n+e.amount_cents,0);
 return {customer:customerView(db,customer),from:p.from,to:p.to,opening_cents:opening,movements,closing_cents:opening+movements.reduce((n,e)=>n+e.amount_cents,0),balance_cents:current,total_sales_cents:movements.filter(e=>e.kind==='sale').reduce((n,e)=>n+e.total_cents,0),total_collections_cents:-movements.filter(e=>e.kind==='collection'||e.kind==='reversal').reduce((n,e)=>n+e.amount_cents,0)};
}
export function mountBusiness(app,db){
 app.get('/api/agents',(req,res)=>res.json(req.user.role==='admin'&&req.query.user_id?db.prepare('SELECT * FROM sales_agents WHERE user_id=? ORDER BY name').all(String(req.query.user_id)):agentsFor(db,req.user)));
 const agent=z.object({user_id:uuid,name:text,active:z.boolean().default(true)});
 const saveAgent=(req,res)=>res.json(transaction(db,()=>{const d=req.input;if(!db.prepare('SELECT 1 FROM users WHERE id=? AND active=1').get(d.user_id))fail(400,'Usuario inválido.');const key=req.params.id||id();const old=db.prepare('SELECT * FROM sales_agents WHERE id=?').get(key);if(req.params.id&&!old)fail(404,'Vendedor no encontrado.');if(old&&old.user_id!==d.user_id)fail(409,'Conserva el usuario del vendedor; desactívalo y crea otro.');db.prepare('INSERT INTO sales_agents VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,active=excluded.active').run(key,d.user_id,d.name,Number(d.active));audit(db,req.user.id,old?'agent.update':'agent.create',key,d);return db.prepare('SELECT * FROM sales_agents WHERE id=?').get(key);}));
 app.post('/api/agents',admin,validate(agent),saveAgent);app.put('/api/agents/:id',admin,validate(agent),saveAgent);
 app.put('/api/users/:id',admin,validate(z.object({name:text,username:z.string().regex(/^[a-zA-Z0-9_.-]{3,40}$/),role:z.enum(['admin','seller']),route_id:uuid.nullable()})),(req,res)=>res.json(transaction(db,()=>{const d=req.input,u=db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);if(!u)fail(404,'Usuario no encontrado.');if(u.id===req.user.id&&d.role!=='admin')fail(409,'No puedes quitar tu propio acceso de administrador.');const current=routeFor(db,u);if((current?.id||null)!==d.route_id&&db.prepare("SELECT 1 FROM cash_sessions WHERE opened_by=? AND state='open'").get(u.id))fail(409,'Cierra y sincroniza las cajas antes de cambiar la ruta.');if(d.route_id&&!db.prepare('SELECT 1 FROM routes WHERE id=? AND active=1').get(d.route_id))fail(400,'Ruta inválida.');db.prepare('UPDATE users SET name=?,username=?,role=? WHERE id=?').run(d.name,d.username,d.role,u.id);db.prepare('DELETE FROM seller_routes WHERE user_id=?').run(u.id);if(d.route_id)db.prepare('INSERT INTO seller_routes VALUES (?,?)').run(u.id,d.route_id);audit(db,req.user.id,'user.update',u.id,d);return {ok:true};})));
 app.put('/api/routes/:id',admin,validate(z.object({name:text,active:z.boolean()})),(req,res)=>res.json(transaction(db,()=>{if(!db.prepare('SELECT 1 FROM routes WHERE id=?').get(req.params.id))fail(404,'Ruta no encontrada.');if(!req.input.active&&db.prepare("SELECT 1 FROM cash_sessions c JOIN seller_routes r ON r.user_id=c.opened_by WHERE r.route_id=? AND c.state='open'").get(req.params.id))fail(409,'Cierra las cajas de la ruta antes de desactivarla.');db.prepare('UPDATE routes SET name=?,active=? WHERE id=?').run(req.input.name,Number(req.input.active),req.params.id);audit(db,req.user.id,'route.update',req.params.id,req.input);return {ok:true};})));
 app.get('/api/routes/:id/users',admin,(req,res)=>res.json(db.prepare('SELECT u.id,u.name,u.username FROM users u JOIN seller_routes r ON r.user_id=u.id WHERE r.route_id=? ORDER BY u.name').all(req.params.id)));
 app.post('/api/deliveries',admin,validate(z.object({route_id:uuid,items:z.array(z.object({product_id:uuid,quantity:z.string()})).min(1).max(100),note:z.string().trim().max(1000).default('Entrega de inventario'),request_key:uuid})),(req,res)=>res.json(transaction(db,()=>{
  const d=req.input,hash=digest(JSON.stringify(d)),old=db.prepare('SELECT * FROM delivery_batches WHERE request_key=?').get(d.request_key);if(old){if(old.request_hash!==hash)fail(409,'Referencia usada con otra entrega.');return old;}
  const route=db.prepare('SELECT * FROM routes WHERE id=? AND active=1').get(d.route_id);requireOpenRoute(db,route);
  const batch=id(),at=now();db.prepare('INSERT INTO delivery_batches VALUES (?,?,?,?,?,?,?)').run(batch,route.id,req.user.id,d.request_key,hash,at,d.note);
  const seen=new Set();for(const i of d.items){if(seen.has(i.product_id))fail(400,'No repitas productos.');seen.add(i.product_id);const product=db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(i.product_id);if(!product)fail(400,'Producto no disponible.');const qty=quantity(i.quantity,product.unit);let g=db.prepare('SELECT group_id FROM product_groups WHERE product_id=?').get(product.id)?.group_id;
   if(!g){g=id();db.prepare('INSERT INTO inventory_groups VALUES (?,?,?)').run(g,product.name+' · '+g.slice(0,6),product.unit);db.prepare('INSERT INTO product_groups VALUES (?,?)').run(product.id,g);}
   const available=db.prepare('SELECT available_milli n FROM route_stock WHERE route_id=? AND group_id=?').get(route.id,g)?.n||0;if(available+qty>100_000_000_000)fail(400,'Cantidad fuera de rango.');
   db.prepare('INSERT INTO route_stock VALUES (?,?,?,?) ON CONFLICT(route_id,group_id) DO UPDATE SET initial_milli=initial_milli+excluded.initial_milli,available_milli=available_milli+excluded.available_milli').run(route.id,g,qty,qty);
   db.prepare('INSERT INTO stock_movements VALUES (?,?,?,?,?,?,?,?,?,?)').run(id(),route.id,g,product.id,null,qty,'assign',req.user.id,d.note,at);db.prepare('INSERT INTO delivery_items VALUES (?,?,?)').run(batch,product.id,qty);
  }audit(db,req.user.id,'inventory.delivery',batch,d);return db.prepare('SELECT * FROM delivery_batches WHERE id=?').get(batch);
 })));
 app.get('/api/deliveries',(req,res)=>{const route=req.user.role==='admin'?String(req.query.route_id||''):routeFor(db,req.user)?.id||'';res.json(db.prepare('SELECT b.*,u.name actor_name FROM delivery_batches b JOIN users u ON u.id=b.actor_id WHERE route_id=? ORDER BY b.created_at DESC').all(route).map(b=>({...b,items:db.prepare('SELECT i.*,p.name,p.unit FROM delivery_items i JOIN products p ON p.id=i.product_id WHERE batch_id=?').all(b.id)})));});
 app.get('/api/inventory/report',(req,res)=>{const route=req.user.role==='admin'?String(req.query.route_id||''):routeFor(db,req.user)?.id||'';res.json(inventoryReport(db,route,req.query.from,req.query.to));});
 app.get('/api/accounts',(req,res)=>{let customers=db.prepare('SELECT * FROM customers WHERE active=1 ORDER BY name').all();if(req.user.role!=='admin')customers=customers.filter(c=>db.prepare('SELECT 1 FROM customer_routes WHERE customer_id=? AND route_id=?').get(c.id,routeFor(db,req.user)?.id||''));res.json(customers.map(c=>({...customerView(db,c),balance_cents:account(db,req.user,c.id).balance_cents})).filter(c=>c.balance_cents>0));});
 app.get('/api/accounts/:id/statement',(req,res)=>res.json(statement(db,req.user,req.params.id,req.query.from,req.query.to)));
 app.get('/api/accounts/:id/statement/pdf',async(req,res)=>res.type('pdf').set('Content-Disposition','attachment; filename="estado-de-cuenta.pdf"').send(await statementPdf(statement(db,req.user,req.params.id,req.query.from,req.query.to))));
 app.get('/api/results',admin,(req,res)=>res.json(results(db,req.query)));
 app.get('/api/daily-closures',admin,(req,res)=>res.json(db.prepare('SELECT * FROM daily_closures ORDER BY day DESC,created_at DESC').all().filter(c=>!req.query.route_id||c.route_id===req.query.route_id).map(c=>({...c,snapshot:JSON.parse(c.snapshot)}))));
 app.post('/api/daily-closures',admin,validate(z.object({route_id:uuid,day:z.iso.date()})),(req,res)=>res.json(transaction(db,()=>{const d=req.input,old=db.prepare('SELECT * FROM daily_closures WHERE route_id=? AND day=?').get(d.route_id,d.day);if(old)return {...old,snapshot:JSON.parse(old.snapshot)};if(d.day>dayOf(now()))fail(400,'No puedes cerrar una fecha futura.');if(!db.prepare('SELECT 1 FROM routes WHERE id=?').get(d.route_id))fail(404,'Ruta no encontrada.');const snap={route:db.prepare('SELECT * FROM routes WHERE id=?').get(d.route_id),financial:results(db,{route_id:d.route_id,from:d.day,to:d.day}),inventory:inventoryReport(db,d.route_id,d.day,d.day)},key=id();db.prepare('INSERT INTO daily_closures VALUES (?,?,?,?,?,?)').run(key,d.route_id,d.day,req.user.id,now(),JSON.stringify(snap));audit(db,req.user.id,'route.close',key,d);return {id:key,...d,snapshot:snap};})));
}
