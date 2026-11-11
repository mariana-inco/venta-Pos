import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase} from '../src/db.js';
import {createUser,login} from '../src/auth.js';
import {createApp} from '../src/app.js';
import {dayOf,statement,inventoryReport} from '../src/business.js';

test('Operación por ruta: precios, varios vendedores, entregas, crédito, cartera, PDF, cierres y permisos',async()=>{
 const db=openDatabase(':memory:'),tokens={},users={};for(const role of ['admin','seller','other']){users[role]=await createUser(db,{username:role,name:role,role:role==='admin'?'admin':'seller',password:'test-password-123'});tokens[role]=(await login(db,role,'test-password-123')).token;}
 const server=createApp(db).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}/api`;
 async function req(path,body,role='admin',method=body?'POST':'GET',status=200){const r=await fetch(base+path,{method,headers:{Authorization:`Bearer ${tokens[role]}`,'Content-Type':'application/json'},body:body&&JSON.stringify(body)});const value=await r.json();assert.equal(r.status,status,JSON.stringify(value));return value;}
 try{
 const r1=await req('/routes',{name:'Ruta uno'}),r2=await req('/routes',{name:'Ruta dos'});
 await req(`/users/${users.seller.id}`,{name:'Operador',username:'seller',role:'seller',route_id:r1.id},'admin','PUT');await req(`/users/${users.other.id}`,{name:'Otro',username:'other',role:'seller',route_id:r2.id},'admin','PUT');
 const a=await req('/agents',{user_id:users.seller.id,name:'Ana'}),b=await req('/agents',{user_id:users.seller.id,name:'Luis'}),foreign=await req('/agents',{user_id:users.other.id,name:'Otra ruta'});
 assert.deepEqual((await req('/agents?user_id='+users.other.id,undefined,'seller')).map(a=>a.id).sort(),[a.id,b.id].sort());
 const normal=await req('/customers',{name:'Cliente normal',city:'Bogotá',customer_type:'normal'},'seller','POST',201),wholesale=await req('/customers',{name:'Cliente mayorista',city:'Bogotá',customer_type:'wholesale'},'seller','POST',201);
 const p=await req('/products',{code:'00001A',name:'Pollo',price:'12000',wholesale_price:'10000',unit:'kg'}),soda=await req('/products',{code:'00002',name:'Gaseosa',price:'3000',wholesale_price:'2500',unit:'unit'});
 await req('/products',{code:'00001a',name:'Duplicado',price:'1',unit:'kg'},'admin','POST',409);
 assert.equal((await req('/products',undefined,'seller')).length,0);
 const delivery={route_id:r1.id,items:[{product_id:p.id,quantity:'10'},{product_id:soda.id,quantity:'10'}],note:'Carga del día',request_key:randomUUID()};
 await req('/deliveries',delivery);await req('/deliveries',delivery);await req('/deliveries',{...delivery,request_key:randomUUID(),items:[{product_id:p.id,quantity:'5'}]});await req('/deliveries',{...delivery,route_id:r2.id,request_key:randomUUID()});
 assert.equal((await req('/deliveries?route_id='+r1.id)).length,2);
 const inv=await req('/inventory',undefined,'seller');assert.equal(inv.stock.find(g=>g.unit==='kg').available_milli,15000);
 const cash=await req('/cash-sessions',{opening:'0'},'seller','POST',201),otherCash=await req('/cash-sessions',{opening:'0'},'other','POST',201),adminCash=await req('/cash-sessions',{opening:'0'},'admin','POST',201);
 const body=(customer,agent,method='cash',quantity='1')=>({agent_id:agent.id,session_id:cash.id,customer_id:customer.id,items:[{product_id:p.id,quantity}],method,platform_id:method==='electronic'?'nequi':null,request_key:randomUUID()});
 await req('/sales',body(normal,foreign),'seller','POST',400);await req('/sales',{...body(normal,a),agent_id:undefined},'seller','POST',400);
 const sale=await req('/sales',body(normal,a),'seller','POST',201);assert.equal(sale.total_cents,1200000);assert.equal(sale.snapshot.seller_name,'Ana');assert.equal(sale.snapshot.user_name,'Operador');
 const electronic=await req('/sales',body(normal,b,'electronic'),'seller','POST',201);
 const creditBody=body(wholesale,b,'credit','2'),credit=await req('/sales',creditBody,'seller','POST',201);assert.equal(credit.total_cents,2000000);assert.equal(credit.paid_cents,0);assert.equal(credit.balance_cents,2000000);assert.equal((await req('/sales',creditBody,'seller','POST',201)).id,credit.id);
 assert.equal((await req('/inventory',undefined,'seller')).stock.find(g=>g.unit==='kg').available_milli,11000);assert.equal((await req('/inventory',undefined,'other')).stock.find(g=>g.unit==='kg').available_milli,10000);
 const add={customer_id:wholesale.id,session_id:cash.id,amount:'5000',method:'cash',note:'Primera cuota',request_key:randomUUID()};await req('/collections',add,'seller');await req('/collections',add,'seller');
 await req('/collections',{...add,session_id:adminCash.id,amount:'7000',method:'electronic',request_key:randomUUID()},'admin');
 const acc=await req('/accounts/'+wholesale.id,undefined,'seller');assert.equal(acc.balance_cents,800000);assert.equal(acc.collections.length,2);
 await req('/accounts/'+wholesale.id,undefined,'other','GET',403);await req('/collections',{...add,amount:'9000',request_key:randomUUID()},'seller','POST',400);
 const all=await req('/accounts/'+wholesale.id+'/statement',undefined,'seller');assert.equal(all.customer.customer_type,'wholesale');assert.equal(all.movements.length,3);assert.equal(all.movements.at(-1).balance_cents,800000);
 const tomorrow=new Date(Date.now()+86400000).toISOString().slice(0,10);const future=await req('/accounts/'+wholesale.id+'/statement?from='+tomorrow+'&to='+tomorrow,undefined,'seller');assert.equal(future.opening_cents,800000);assert.equal(future.movements.length,0);assert.equal(future.balance_cents,800000);
 for(const suffix of ['',`?from=${dayOf(new Date().toISOString())}&to=${dayOf(new Date().toISOString())}`]){const pdf=await fetch(base+'/accounts/'+wholesale.id+'/statement/pdf'+suffix,{headers:{Authorization:`Bearer ${tokens.admin}`}});assert.equal(pdf.status,200);assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0,4).toString(),'%PDF');}
 const report=await req('/results?route_id='+r1.id);assert.equal(report.total_cents,4400000);assert.equal(report.sale_cash_cents,1200000);assert.equal(report.sale_electronic_cents,1200000);assert.equal(report.credit_cents,2000000);assert.equal(report.collection_cents,1200000);assert.equal(report.cash_cents,1700000);assert.equal(report.electronic_cents,1900000);assert.equal(report.by_seller.length,2);
 const day=dayOf(new Date().toISOString()),invent=await req('/inventory/report?route_id='+r1.id+'&from='+day+'&to='+day);assert.equal(invent.groups.find(g=>g.unit==='kg').assigned_milli,15000);assert.equal(invent.groups.find(g=>g.unit==='kg').sold_milli,4000);assert.equal(invent.groups.find(g=>g.unit==='kg').final_milli,11000);
 await req('/products/'+p.id,{name:'Pollo nuevo',code:'00001A',unit:'kg',price:'14000',wholesale_price:'11000'},'admin','PUT');assert.equal((await req('/sales/'+credit.id,undefined,'seller')).items[0].price_cents,1000000);
 await req('/deliveries',{...delivery,request_key:randomUUID()},'seller','POST',403);await req('/results',undefined,'seller','GET',403);await req('/users/'+users.other.id,{name:'Intruso',username:'other',role:'admin',route_id:r1.id},'seller','PUT',403);
 await req('/users/'+users.seller.id,{name:'Operador',username:'seller',role:'seller',route_id:r2.id},'admin','PUT',409);
 const race=await Promise.all([fetch(base+'/sales',{method:'POST',headers:{Authorization:`Bearer ${tokens.seller}`,'Content-Type':'application/json'},body:JSON.stringify(body(normal,a,'cash','8'))}),fetch(base+'/sales',{method:'POST',headers:{Authorization:`Bearer ${tokens.seller}`,'Content-Type':'application/json'},body:JSON.stringify(body(normal,b,'cash','8'))})]);assert.deepEqual(race.map(r=>r.status).sort(),[201,409]);
 const closed=await req('/daily-closures',{route_id:r1.id,day});const serialized=JSON.stringify(closed.snapshot);await req('/sales',body(normal,a),'seller','POST',409);await req('/deliveries',{...delivery,request_key:randomUUID()},'admin','POST',409);assert.equal(JSON.stringify((await req('/daily-closures')).find(c=>c.id===closed.id).snapshot),serialized);
 assert.throws(()=>db.prepare('DELETE FROM daily_closures').run(),/inmutable/);assert.equal((await req('/daily-closures',{route_id:r1.id,day})).id,closed.id);
 }finally{await new Promise(r=>server.close(r));db.close();}
});

test('Migración aditiva: conserva precio, stock global, relaciones e históricos sin inventar mayoristas ni rutas',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'business-migration-')),path=join(directory,'pos.sqlite');let db=openDatabase(path);
 try{
 const u=await createUser(db,{username:'legacy',name:'Histórico',password:'legacy-password-123',role:'admin'}),p=randomUUID(),c=randomUUID(),session=randomUUID(),sale=randomUUID();
 db.prepare('INSERT INTO products VALUES (?,?,?,?,?,?,?,?)').run(p,'Anterior',123456,'kg',1,12345,'2020-01-01','2020-01-01');db.prepare('INSERT INTO customers VALUES (?,?,?,?,?,?)').run(c,'Cliente previo','Bogotá',1,'2020-01-01','2020-01-01');db.prepare('INSERT INTO cash_sessions(id,opened_by,opened_at,opening_cents,state,closed_at) VALUES (?,?,?,?,?,?)').run(session,u.id,'2020-01-01',0,'open',null);
 const snap=JSON.stringify({business_name:'Previo',customer_name:'Cliente previo',seller_name:'Histórico'});db.prepare('INSERT INTO sales VALUES (?,?,?,?,?,?,?,?,?,?)').run(sale,1,session,u.id,c,'2020-01-01',123456,snap,'legacy-key','hash');
 db.close();db=openDatabase(path);assert.equal(db.prepare('SELECT customer_type FROM customer_profiles WHERE customer_id=?').get(c).customer_type,'normal');assert.equal(db.prepare('SELECT price_cents FROM products WHERE id=?').get(p).price_cents,123456);assert.equal(db.prepare('SELECT stock_milli FROM products WHERE id=?').get(p).stock_milli,12345);assert.equal(db.prepare('SELECT COUNT(*) n FROM product_pricing').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM route_stock').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM sales_agents').get().n,0);assert.equal(db.prepare('SELECT snapshot FROM sales WHERE id=?').get(sale).snapshot,snap);assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
 }finally{db.close();rmSync(directory,{recursive:true,force:true});}
});
