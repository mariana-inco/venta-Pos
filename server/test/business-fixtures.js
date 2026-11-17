import {digest} from '../src/auth.js';
import {startSale} from '../src/sale-drafts.js';
import {randomUUID} from 'node:crypto';
export function routeUser(db,userId,name='Ruta de prueba'){
 const routeId=randomUUID(),agentId=randomUUID();db.prepare('INSERT INTO routes(id,name) VALUES (?,?)').run(routeId,name+' '+routeId.slice(0,5));db.prepare('INSERT INTO seller_routes VALUES (?,?)').run(userId,routeId);db.prepare('INSERT INTO sales_agents VALUES (?,?,?,1)').run(agentId,userId,'Vendedor de prueba');return {routeId,agentId};
}
export function stockProduct(db,routeId,productId,qty=1000000){let group=db.prepare('SELECT group_id FROM product_groups WHERE product_id=?').get(productId)?.group_id;if(!group){group=randomUUID();const p=db.prepare('SELECT * FROM products WHERE id=?').get(productId);db.prepare('INSERT INTO inventory_groups VALUES (?,?,?)').run(group,'Stock '+group,p.unit);db.prepare('INSERT INTO product_groups VALUES (?,?)').run(productId,group);}db.prepare('INSERT INTO route_stock VALUES (?,?,?,?)').run(routeId,group,qty,qty);db.prepare('INSERT INTO stock_movements VALUES (?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),routeId,group,productId,null,qty,'assign',db.prepare('SELECT user_id FROM seller_routes WHERE route_id=?').get(routeId).user_id,'Carga de prueba',new Date().toISOString());}

// Upgrade legacy test requests to the explicit route/draft/reference protocol.
export function prepareRequest(db,token,path,body){
 if(!body)return body;const user=db.prepare('SELECT u.* FROM users u JOIN auth_sessions a ON a.user_id=u.id WHERE a.token_hash=?').get(digest(token));if(!user)return body;
 if(path==='/customers'&&body.name&&!body.route_id)body.route_id=db.prepare('SELECT route_id FROM seller_routes WHERE user_id=?').get(user.id)?.route_id||db.prepare('SELECT id FROM routes ORDER BY rowid LIMIT 1').get()?.id;
 if((path==='/sales'||path==='/collections')&&body.method==='electronic'){body.platform_id=body.platform_id||'nequi';body.reference=body.reference||'fixture-'+body.request_key;}
 if(path==='/sales'&&body.agent_id&&body.customer_id&&!body.draft_id){try{startSale(db,user,{customer_id:body.customer_id,agent_id:body.agent_id,request_key:body.request_key});body.draft_id=body.request_key;}catch{}}
 return body;
}
