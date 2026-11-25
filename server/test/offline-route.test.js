import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openDatabase} from '../src/db.js';
import {createUser,login} from '../src/auth.js';
import {createApp} from '../src/app.js';
import {routeUser,stockProduct} from './business-fixtures.js';
import {registerDevice} from '../src/sync.js';
import {LocalStore} from '../../mobile/src/offline/store.js';

async function fixture(){
 const db=openDatabase(':memory:'),user=await createUser(db,{name:'Ana',username:'offline-route',role:'admin',password:'offline-testing-password'}),other=await createUser(db,{name:'Otro',username:'other-route',role:'seller',password:'offline-testing-password'});
 const {routeId,agentId}=routeUser(db,user.id);db.prepare('INSERT INTO seller_routes VALUES(?,?)').run(other.id,routeId);
 const at=new Date().toISOString(),product=randomUUID(),cut=randomUUID(),customer=randomUUID(),normal=randomUUID(),session=randomUUID();
 for(const [id,name] of [[product,'Pollo'],[cut,'Alas']]){db.prepare('INSERT INTO products VALUES(?,?,?,?,?,?,?,?)').run(id,name,1200000,'kg',1,null,at,at);db.prepare('INSERT INTO product_pricing VALUES(?,?)').run(id,1000000);}
 stockProduct(db,routeId,product,10000);const group=db.prepare('SELECT group_id FROM product_groups WHERE product_id=?').get(product).group_id;db.prepare('INSERT INTO product_groups VALUES(?,?)').run(cut,group);
 for(const [id,name,type] of [[customer,'Mayorista','wholesale'],[normal,'Normal','normal']]){db.prepare('INSERT INTO customers VALUES(?,?,?,?,?,?)').run(id,name,'Bogotá',1,at,at);db.prepare('INSERT INTO customer_profiles VALUES(?,?)').run(id,type);db.prepare('INSERT INTO customer_routes(customer_id,route_id) VALUES(?,?)').run(id,routeId);}
 db.prepare('INSERT INTO cash_sessions(id,opened_by,opened_at,opening_cents,state) VALUES(?,?,?,?,?)').run(session,user.id,at,100000,'open');
 const dir=mkdtempSync(join(tmpdir(),'pos-route-offline-')),path=join(dir,'local.sqlite');let sqlite;
 const reopen=()=>{sqlite?.close();sqlite=new DatabaseSync(path);return new LocalStore({exec:s=>sqlite.exec(s),run:(s,...a)=>sqlite.prepare(s).run(...a),get:(s,...a)=>sqlite.prepare(s).get(...a),all:(s,...a)=>sqlite.prepare(s).all(...a)},randomUUID);};
 let store=reopen();store.profile(user);
 const grant=registerDevice(db,user,{device_id:store.deviceId,name:'Neotek',generation:'initial'}),second=registerDevice(db,other,{device_id:randomUUID(),name:'Segundo',generation:'initial'});
 const token=(await login(db,user.username,'offline-testing-password')).token;
 const server=createApp(db).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}/api`;
 const request=async(path,body,bearer=grant.token,status=200,method=body?'POST':'GET')=>{const response=await fetch(base+path,{method,headers:{Authorization:'Bearer '+bearer,'Content-Type':'application/json'},body:body&&JSON.stringify(body)});const data=await response.json();assert.equal(response.status,status,JSON.stringify(data));return data;};
 const prepare=async()=>{const c=await request('/sync/route/prepare',{session_id:session});store.applyCatalog(c);return c;};
 const sell=(which=customer,quantity='1',method='cash',extra={})=>{const draft=store.request(user,'/sale-drafts','POST',{customer_id:which,agent_id:agentId,request_key:randomUUID()});const body={draft_id:draft.id,request_key:draft.id,customer_id:which,agent_id:agentId,session_id:session,items:[{product_id:product,quantity,expected_price_cents:draft.prices[product].price_cents}],method,...extra};return {body,sale:store.request(user,'/sales','POST',body)};};
 return {db,user,other,routeId,agentId,product,cut,customer,normal,session,group,grant,second,token,request,prepare,sell,get store(){return store;},reopen(){store=reopen();return store;},async close(){await new Promise(r=>server.close(r));sqlite.close();db.close();rmSync(dir,{recursive:true,force:true});}};
}
test('Ruta offline real: reserva exclusiva, persistencia, crédito, stock compartido, reintentos y liberación sin perder datos',async()=>{
 const f=await fixture();try{
 const c=await f.prepare();assert.ok(c.receipt_ranges.length);assert.equal(c.agents[0].id,f.agentId);assert.equal((await f.prepare()).reservation_id,c.reservation_id);
 const otherSession=randomUUID();f.db.prepare("INSERT INTO cash_sessions(id,opened_by,opened_at,opening_cents,state) VALUES(?,?,?,0,'open')").run(otherSession,f.other.id,new Date().toISOString());await f.request('/sync/route/prepare',{session_id:otherSession},f.second.token,409);
 const first=f.sell();assert.equal(first.sale.total_cents,1000000);assert.equal(first.sale.snapshot.receipt_number,'P-01');assert.equal(f.store.request(f.user,'/sales','POST',first.body).id,first.sale.id);assert.equal(f.store.pending().length,1);
 const second=f.sell(f.normal,'2','credit',{initial_payment:'5000',initial_method:'cash'});assert.equal(second.sale.total_cents,2400000);assert.equal(second.sale.balance_cents,1900000);assert.equal(second.sale.payments[0].amount_cents,500000);
 const third=f.sell(f.customer,'0.5','credit');assert.equal(third.sale.payments.length,0);assert.equal(third.sale.balance_cents,500000);
 assert.equal(f.store.request(f.user,'/cash-sessions','GET')[0].cash_cents,1500000);assert.equal(f.store.request(f.user,'/cash-sessions','GET')[0].total_cents,3900000);
 f.reopen();assert.equal(f.store.pending().length,3);assert.equal(f.store.request(f.user,'/agents')[0].id,f.agentId);assert.equal(f.store.request(f.user,'/products').find(p=>p.id===f.cut).stock_milli,6500);
 const d=f.store.request(f.user,'/sale-drafts','POST',{customer_id:f.customer,agent_id:f.agentId,request_key:randomUUID()});assert.throws(()=>f.store.request(f.user,'/sales','POST',{...first.body,draft_id:d.id,request_key:d.id,items:[{product_id:f.product,quantity:'4',expected_price_cents:1000000},{product_id:f.cut,quantity:'3',expected_price_cents:1000000}]}),/suficiente/);
 assert.throws(()=>f.sell(f.customer,'1','electronic',{platform_id:'nequi',reference:'ABC'}),/electrónicos/);
 await f.request('/route/close',{},f.token,409);await f.request('/deliveries',{route_id:f.routeId,request_key:randomUUID(),items:[{product_id:f.product,quantity:'1'}],note:''},f.token,409);
 await f.request('/cash-sessions/'+f.session+'/close',{declared_cash:'0',declared_electronic:'0'},f.token,409);
 await f.request('/sales',first.body,f.token,409);
 // Prices may change: reserved normal/wholesale prices remain original.
 f.db.prepare('UPDATE products SET price_cents=9999999 WHERE id=?').run(f.product);f.db.prepare('UPDATE product_pricing SET wholesale_price_cents=8888888 WHERE product_id=?').run(f.product);
 const events=f.store.pending().map(x=>x.event);const push=()=>f.request('/sync/events',{events});
 const a=await push();assert.equal(a.rejected,undefined);assert.equal(a.accepted.length,3);const again=await push();assert.deepEqual(again,a);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM sales').get().n,3);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM payments').get().n,2);assert.equal(f.db.prepare('SELECT available_milli n FROM route_stock WHERE route_id=?').get(f.routeId).n,6500);
 // Lost acknowledgement cannot release a device whose local sequence disagrees.
 await f.request('/sync/route/release',{sequence:0},f.grant.token,409);
 for(const ack of a.accepted)f.store.acknowledge(ack.event_id,ack);f.store.applyCatalog(await f.request('/sync/catalog'));
 assert.equal(f.store.request(f.user,'/products')[0].stock_milli,6500);assert.equal(f.store.pending().length,0);assert.equal(f.store.get('sale',first.sale.id).snapshot.receipt_number,'P-01');
 await f.request('/sync/route/release',{sequence:3});await f.request('/sync/route/release',{sequence:3});
 assert.equal((await f.request('/sync/catalog')).reservation_id,undefined);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM products').get().n,2);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM customers').get().n,2);assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(f.db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
 }finally{await f.close();}
});

test('Ruta offline: fallo durante descuento revierte venta, pagos, stock, estado y secuencia; la cola puede reintentarse',async()=>{
 const f=await fixture();try{
 await f.prepare();f.sell();const event=f.store.pending()[0].event;
 f.db.exec("CREATE TRIGGER fail_sync BEFORE INSERT ON payments BEGIN SELECT RAISE(ABORT,'test rollback'); END");
 await f.request('/sync/events',{events:[event]},f.grant.token,500);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM sales').get().n,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM receipt_numbers').get().n,0);assert.equal(f.db.prepare('SELECT available_milli n FROM route_stock').get().n,10000);assert.equal(f.db.prepare('SELECT state FROM offline_route_reservations').get().state,'active');assert.equal(f.db.prepare('SELECT last_sequence FROM sync_devices WHERE id=?').get(f.store.deviceId).last_sequence,0);
 f.db.exec('DROP TRIGGER fail_sync');const done=await f.request('/sync/events',{events:[event]});assert.equal(done.accepted.length,1);assert.equal(f.store.pending().length,1);
 }finally{await f.close();}
});

test('Ruta offline: permisos, manipulación, límites de jornada y reservas concurrentes',async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-11-23T18:00:00Z')});
 const f=await fixture();try{
 const foreignRoute=randomUUID(),foreignCustomer=randomUUID();f.db.prepare('INSERT INTO routes(id,name) VALUES(?,?)').run(foreignRoute,'Ajena');f.db.prepare('INSERT INTO customers VALUES(?,?,?,?,?,?)').run(foreignCustomer,'Ajeno','Bogotá',1,new Date().toISOString(),new Date().toISOString());f.db.prepare('INSERT INTO customer_routes(customer_id,route_id) VALUES(?,?)').run(foreignCustomer,foreignRoute);
 const reserve=await Promise.all([f.request('/sync/route/prepare',{session_id:f.session}),f.request('/sync/route/prepare',{session_id:f.session})]);assert.equal(reserve[0].reservation_id,reserve[1].reservation_id);f.store.applyCatalog(reserve[0]);assert.equal(reserve[0].customers.some(c=>c.id===foreignCustomer),false);
 const {sale}=f.sell();const event=f.store.pending()[0].event;
 const altered=structuredClone(event);altered.data.input.items[0].expected_price_cents=1;const rejection=await f.request('/sync/events',{events:[altered]});assert.equal(rejection.rejected.status,409);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM sales').get().n,0);
 const stranger=await f.request('/sync/events',{events:[event]},f.second.token);assert.equal(stranger.rejected.status,409);
 await f.request('/customers/'+f.customer,undefined,f.token,409,'DELETE');await f.request('/products/'+f.product,undefined,f.token,409,'DELETE');await f.request('/products/'+f.product+'/group',undefined,f.token,409,'DELETE');
 assert.throws(()=>f.store.request(f.user,'/sales','POST',{...JSON.parse(sale.local_request),customer_id:f.normal}),/Referencia/);
 t.mock.timers.tick(86400000);
 assert.throws(()=>f.sell(),/jornada/);
 // Yesterday's recorded sale can upload today, retaining its original sale date.
 const accepted=await f.request('/sync/events',{events:[event]});assert.equal(accepted.accepted.length,1);assert.equal(f.db.prepare('SELECT created_at FROM sales').get().created_at,event.created_at);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM customers').get().n,3);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM products').get().n,2);
 }finally{await f.close();t.mock.timers.reset();}
});

test('Crédito offline con varias líneas en efectivo sincroniza el abono una sola vez',async()=>{
 const f=await fixture();try{await f.prepare();
 assert.throws(()=>f.sell(f.normal,'1','credit',{payments:[{method:'cash',amount:'0'}]}),/mayor a cero/);
 assert.throws(()=>f.sell(f.normal,'1','credit',{payments:[{method:'cash',amount:'12001'}]}),/supera/);
 assert.throws(()=>f.sell(f.normal,'1','credit',{payments:[{method:'electronic',platform_id:'bold',amount:'10',reference:'X'}]}),/conexión/);
 const x=f.sell(f.normal,'1','credit',{payments:[{method:'cash',amount:'2000'},{method:'cash',amount:'3000'}],initial_payment:'5000'});
 assert.equal(x.sale.balance_cents,700000);assert.equal(x.sale.payments.length,2);f.reopen();assert.equal(f.store.pending().length,1);
 const events=f.store.pending().map(e=>e.event);
 const first=await f.request('/sync/events',{events});const again=await f.request('/sync/events',{events});assert.equal(first.accepted.length,1);assert.equal(again.accepted.length,1);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM sales').get().n,1);assert.equal(f.db.prepare('SELECT SUM(amount_cents) n FROM payments WHERE sale_id=?').get(x.sale.id).n,500000);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM payments WHERE sale_id=?').get(x.sale.id).n,2);
 }finally{await f.close();}
});
