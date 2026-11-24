import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../src/db.js';
import {createUser,login} from '../src/auth.js';
import {createApp} from '../src/app.js';
import {dayOf} from '../src/business.js';

test('Cliente fijo, referencias históricas y parciales, VARIOS, reemplazo de stock y cierre de ruta atómico',async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-11-11T15:00:00Z')});
 const db=openDatabase(':memory:'),users={},tokens={};for(const role of ['admin','seller','other']){users[role]=await createUser(db,{name:role,username:role,role:role==='admin'?'admin':'seller',password:'password-testing-123'});tokens[role]=(await login(db,role,'password-testing-123')).token;}
 const server=createApp(db).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}/api`;
 const request=async(path,body,role='admin',method=body?'POST':'GET',status=(path==='/customers'&&method==='POST'?201:200))=>{const r=await fetch(base+path,{method,headers:{Authorization:`Bearer ${tokens[role]}`,'Content-Type':'application/json'},body:body&&JSON.stringify(body)});const result=await r.json();assert.equal(r.status,status,JSON.stringify(result));return result;};
 try{
 const route=await request('/routes',{name:'Ruta A'}),other=await request('/routes',{name:'Ruta B'});for(const role of ['admin','seller','other'])await request('/users/'+users[role].id,{name:role,username:role,role:role==='admin'?'admin':'seller',route_id:role==='other'?other.id:route.id},'admin','PUT');
 for(const r of [route,other])await request('/route-cycles/open',{route_id:r.id,request_key:randomUUID()});
 const agent=await request('/agents',{user_id:users.seller.id,name:'Ana'}),foreign=await request('/agents',{user_id:users.other.id,name:'Otro'});
 await request('/customers',{name:'Sin ruta',city:'Bogotá'},'admin','POST',400);
 const normal=await request('/customers',{name:'Normal',city:'Bogotá',route_id:route.id}),wholesale=await request('/customers',{name:'Mayorista',city:'Bogotá',customer_type:'wholesale',route_id:route.id}),alien=await request('/customers',{name:'Otra ruta',city:'Bogotá',route_id:other.id});
 assert.equal((await request('/customers',undefined,'seller')).length,2);await request('/customers',{name:'Manipulado',city:'Bogotá',route_id:other.id},'seller','POST',403);
 const p=await request('/products',{name:'Pollo',code:'0001',unit:'kg',price:'10000',wholesale_price:'8000'}),cut=await request('/products',{name:'Pechuga',code:'0002',unit:'kg',price:'15000',wholesale_price:'12000'}),soda=await request('/products',{name:'Gaseosa',code:'0003',unit:'unit',price:'3000',wholesale_price:'2500'});
 const group=await request('/inventory-groups',{name:'POLLO',unit:'kg'});await request('/products/'+p.id+'/group',{group_id:group.id},'admin','PUT');await request('/products/'+cut.id+'/group',{group_id:group.id},'admin','PUT');await request('/products/'+p.id+'/group',{group_id:group.id},'admin','PUT',409);
 const delivery=items=>({route_id:route.id,items,note:'Nueva entrega',request_key:randomUUID()});const firstDelivery=delivery([{product_id:p.id,quantity:'10'},{product_id:soda.id,quantity:'5'}]);await request('/deliveries',firstDelivery);await request('/deliveries',firstDelivery);
 let inventory=await request('/inventory',undefined,'seller');assert.equal(inventory.stock.find(g=>g.group_id===group.id).available_milli,10000);
 const session=await request('/cash-sessions',{opening:'0'},'seller','POST',201),adminSession=await request('/cash-sessions',{opening:'0'},'admin','POST',201);
 async function draft(client=normal){return request('/sale-drafts',{customer_id:client.id,agent_id:agent.id,request_key:randomUUID()},'seller');}
 const sale=(d,extra={})=>({draft_id:d.id,request_key:d.id,agent_id:agent.id,customer_id:d.customer_id,session_id:session.id,items:[{product_id:p.id,quantity:'1'}],method:'cash',...extra});
 await request('/sale-drafts',{customer_id:alien.id,agent_id:agent.id,request_key:randomUUID()},'seller','POST',403);
 const locked=await draft(wholesale);await request('/sales',sale(locked,{customer_id:normal.id}),'seller','POST',409);
 await request('/products/'+p.id,{name:'Pollo',code:'0001',unit:'kg',price:'11000',wholesale_price:'9000'},'admin','PUT');
 const credit=await request('/sales',sale(locked,{method:'credit',initial_payment:'2000',initial_method:'electronic',initial_platform_id:'nequi',reference:' REF-01 '}),'seller','POST',201);assert.equal(credit.total_cents,800000);assert.equal(credit.balance_cents,600000);assert.equal(credit.payments[0].reference,'REF-01');assert.equal((await request('/sales',sale(locked,{method:'credit',initial_payment:'2000',initial_method:'electronic',initial_platform_id:'nequi',reference:' REF-01 '}),'seller','POST',201)).id,credit.id);
 const unpaid=await request('/sales',sale(await draft(),{method:'credit'}),'seller','POST',201);assert.equal(unpaid.payments.length,0);assert.equal(unpaid.balance_cents,1100000);
 await request('/sales',sale(await draft(),{method:'electronic',platform_id:'nequi'}),'seller','POST',400);
 await request('/sales',sale(await draft(),{method:'electronic',platform_id:'nequi',reference:'ref-01'}),'seller','POST',409);
 await request('/sales',sale(await draft(),{method:'electronic',platform_id:'daviplata',reference:'REF-01'}),'seller','POST',201);
 const mixedDraft=await draft(),mixedBody=sale(mixedDraft,{method:'mixed',payments:[{method:'cash',amount:'4000'},{method:'electronic',platform_id:'bold',amount:'7000',reference:'BOLD-1'}]});
 await request('/sales',{...mixedBody,payments:[{method:'cash',amount:'10999'}]},'seller','POST',400);await request('/sales',{...mixedBody,payments:[{method:'cash',amount:'11001'}]},'seller','POST',400);
 const mixed=await request('/sales',mixedBody,'seller','POST',201);assert.equal(mixed.payments.length,2);assert.equal(mixed.balance_cents,0);
 const all=await request('/sales',undefined,'admin');assert.equal(all.count,4);assert.equal(all.sales.length,4);assert.equal(all.sales.find(s=>s.id===mixed.id).method,'mixed');assert.equal(all.groups.method.find(g=>g.key==='mixed').total_cents,1100000);
 const collect={customer_id:wholesale.id,session_id:adminSession.id,amount:'1000',method:'electronic',platform_id:'nequi',reference:'ref-01',request_key:randomUUID()};await request('/collections',collect,'admin','POST',409);await request('/collections',{...collect,reference:'COLLECT-1'},'admin');
 await request('/sales',sale(await draft(),{method:'electronic',platform_id:'nequi',reference:'COLLECT-1'}),'seller','POST',409);
 const statement=await request('/accounts/'+wholesale.id+'/statement',undefined,'seller');assert.equal(statement.movements.filter(m=>m.kind==='initial_payment').length,1);assert.equal(statement.balance_cents,500000);assert.equal(statement.movements.find(m=>m.kind==='initial_payment').reference,'REF-01');
 const contenders=[sale(await draft(),{method:'electronic',platform_id:'nequi',reference:'RACE-REF'}),sale(await draft(),{method:'electronic',platform_id:'nequi',reference:'RACE-REF'})];const responses=await Promise.all(contenders.map(body=>fetch(base+'/sales',{method:'POST',headers:{Authorization:`Bearer ${tokens.seller}`,'Content-Type':'application/json'},body:JSON.stringify(body)})));assert.deepEqual(responses.map(r=>r.status).sort(),[201,409]);
 const before=await request('/inventory',undefined,'seller');assert.equal(before.stock.find(g=>g.group_id===group.id).available_milli,5000);
 await request('/deliveries',delivery([{product_id:p.id,quantity:'3'}]),'admin','POST',409);await request('/inventory',{route_id:route.id,group_id:group.id,quantity:'3',kind:'adjust',note:'Corrección autorizada',expected_available_milli:5000});inventory=await request('/inventory',undefined,'seller');assert.equal(inventory.stock.find(g=>g.group_id===group.id).available_milli,3000);assert.equal(inventory.stock.find(g=>g.unit==='unit').available_milli,5000);
 await request('/products/'+cut.id,undefined,'admin','DELETE');assert.equal((await request('/inventory-groups')).find(g=>g.id===group.id).products.includes(cut.id),false);await request('/products/'+cut.id+'/group',{group_id:group.id},'admin','PUT',400);await request('/deliveries',delivery([{product_id:cut.id,quantity:'2'}]),'admin','POST',400);
 const moves=db.prepare('SELECT COUNT(*) n FROM stock_movements').get().n;await request('/products/'+p.id+'/group',undefined,'admin','DELETE');assert.equal(db.prepare('SELECT COUNT(*) n FROM stock_movements').get().n,moves);assert.equal(db.prepare('SELECT COUNT(*) n FROM sale_items WHERE product_id=?').get(p.id).n,5);await request('/products/'+p.id+'/group',{group_id:group.id},'admin','PUT');
 // Moving the customer changes the only active relation and invalidates unconfirmed drafts.
 const old=await draft();await request('/customers/'+normal.id,{name:'Normal',city:'Bogotá',customer_type:'normal',route_id:other.id},'admin','PUT');await request('/sales',sale(old),'seller','POST',403);assert.equal((await request('/customers',undefined,'seller')).some(c=>c.id===normal.id),false);await request('/customers/'+normal.id,{name:'Normal',city:'Bogotá',customer_type:'normal',route_id:route.id},'admin','PUT');
 await request('/route/close',{route_id:other.id},'seller','POST',403);
 // A failure during zeroing rolls back both the immutable snapshot and stock movements.
 const priorClosures=db.prepare('SELECT COUNT(*) n FROM daily_closures').get().n;db.exec(`CREATE TRIGGER simulate_reset_failure BEFORE UPDATE OF available_milli ON route_stock WHEN NEW.available_milli=0 BEGIN SELECT RAISE(ABORT,'reset failed'); END;`);
 await request('/route/close',{},'seller','POST',500);assert.equal(db.prepare('SELECT COUNT(*) n FROM daily_closures').get().n,priorClosures);assert.equal(db.prepare('SELECT available_milli n FROM route_stock WHERE route_id=? AND group_id=?').get(route.id,group.id).n,3000);db.exec('DROP TRIGGER simulate_reset_failure');
 const closingRace=await Promise.all([0,1].map(()=>fetch(base+'/route/close',{method:'POST',headers:{Authorization:`Bearer ${tokens.seller}`,'Content-Type':'application/json'},body:'{}'})));assert.deepEqual(closingRace.map(r=>r.status).sort(),[200,409]);const closure=await closingRace.find(r=>r.status===200).json();assert.equal(closure.snapshot.total_cents,5200000);assert.equal(closure.snapshot.inventory.groups.find(g=>g.group_id===group.id).final_milli,3000);assert.equal(db.prepare('SELECT SUM(available_milli) n FROM route_stock WHERE route_id=?').get(route.id).n,0);
 const saved=JSON.stringify(closure.snapshot);await request('/route/close',{},'seller','POST',409);await request('/sales',sale(await request('/sale-drafts',{customer_id:normal.id,agent_id:agent.id,request_key:randomUUID()},'seller','POST',409)),'seller','POST',400);
 await request('/deliveries',delivery([{product_id:p.id,quantity:'2'}]),'admin','POST',409);
 const cashClosure=await request('/cash-sessions/'+session.id+'/close',{declared_cash:'4000',declared_electronic:'31000'},'admin','POST',201);assert.equal(cashClosure.snapshot.inventory,undefined);
 t.mock.timers.tick(86400000);tokens.admin=(await login(db,'admin','password-testing-123')).token;await request('/route-cycles/open',{route_id:route.id,request_key:randomUUID()});await request('/deliveries',delivery([{product_id:p.id,quantity:'7'}]));assert.equal(db.prepare('SELECT available_milli n FROM route_stock WHERE route_id=? AND group_id=?').get(route.id,group.id).n,7000);assert.equal(JSON.stringify((await request('/daily-closures')).find(c=>c.id===closure.id).snapshot),saved);
 }finally{await new Promise(r=>server.close(r));db.close();t.mock.timers.reset();}
});
