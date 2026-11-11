import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../src/db.js';
import {createApp} from '../src/app.js';
import {createUser,login} from '../src/auth.js';

test('Rutas, códigos, inventario compartido, crédito, abonos, reversión y anulación integrados',async()=>{
 const db=openDatabase(':memory:');const tokens={};
 for(const role of ['admin','seller','other']){await createUser(db,{username:role,name:role,role:role==='admin'?'admin':'seller',password:'password-12345678'});tokens[role]=(await login(db,role,'password-12345678')).token;}
 const server=createApp(db).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const request=async(path,body,role='admin',method=body?'POST':'GET',status=200)=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/api${path}`,{method,headers:{Authorization:`Bearer ${tokens[role]}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const result=await r.json();assert.equal(r.status,status,JSON.stringify(result));return result;};
 try{
 const users=await request('/users');const seller=users.find(u=>u.username==='seller'),other=users.find(u=>u.username==='other');
 const r1=await request('/routes',{name:'Ruta 1'}),r2=await request('/routes',{name:'Ruta 2'});
 await request(`/routes/${r1.id}/sellers/${seller.id}`,{},'admin','PUT');await request(`/routes/${r2.id}/sellers/${other.id}`,{},'admin','PUT');
 const agent=await request('/agents',{user_id:seller.id,name:'Vendedor asociado'});
 const customer=await request('/customers',{name:'Manuel',city:'Bogotá'},'seller','POST',201);
 assert.equal((await request('/customers',undefined,'other')).length,0);
 const whole=await request('/products',{name:'Pollo',unit:'kg',price:'12000',codes:[{code:'001',kind:'internal'},{code:'ABC-01',kind:'barcode'}]});
 const breast=await request('/products',{name:'Pechuga',unit:'kg',price:'16000',codes:[{code:'2',kind:'internal'}]});
 const soda=await request('/products',{name:'Gaseosa',unit:'unit',price:'3000',codes:[{code:'1001',kind:'barcode'}]});
 await request('/products',{name:'Duplicado',unit:'kg',price:'100',codes:[{code:'abc-01',kind:'barcode'}]},'admin','POST',409);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM products').get().n,3);
 const group=await request('/inventory-groups',{name:'POLLO',unit:'kg'}),units=await request('/inventory-groups',{name:'GASEOSA',unit:'unit'});
 for(const p of [whole,breast])await request(`/products/${p.id}/group`,{group_id:group.id},'admin','PUT');
 await request(`/products/${soda.id}/group`,{group_id:group.id},'admin','PUT',400);await request(`/products/${soda.id}/group`,{group_id:units.id},'admin','PUT');
 for(const r of [r1,r2])for(const g of [group,units])await request('/inventory',{route_id:r.id,group_id:g.id,quantity:g.id===group.id?'1000':'100',kind:'assign',note:'Carga inicial',expected_available_milli:0});
 const session=await request('/cash-sessions',{opening:'0'},'seller','POST',201);
 const sell=(items,extra={})=>({agent_id:agent.id,session_id:session.id,customer_id:customer.id,items,method:'cash',request_key:randomUUID(),...extra});
 const first=await request('/sales',sell([{product_id:whole.id,quantity:'300'},{product_id:breast.id,quantity:'200'}],{credit:true,initial_payment:'150000'}),'seller','POST',201);
 assert.equal(first.balance_cents,665000000);assert.equal(first.state,'PAGO PARCIAL');
 let inv=await request('/inventory',undefined,'seller');assert.equal(inv.stock.find(s=>s.group_id===group.id).available_milli,500000);
 inv=await request('/inventory',undefined,'other');assert.equal(inv.stock.find(s=>s.group_id===group.id).available_milli,1000000);
 await request('/sales',sell([{product_id:whole.id,quantity:'300'},{product_id:breast.id,quantity:'201'}]),'seller','POST',409);
 inv=await request('/inventory',undefined,'seller');assert.equal(inv.stock.find(s=>s.group_id===group.id).available_milli,500000);
 const body=sell([{product_id:whole.id,quantity:'400'}]);const results=await Promise.all([request('/sales',body,'seller','POST',201),request('/sales',body,'seller','POST',201)]);assert.equal(results[0].id,results[1].id);
 await request('/sales',sell([{product_id:breast.id,quantity:'101'}]),'seller','POST',409);
 const collect={customer_id:customer.id,session_id:session.id,amount:'150000',method:'cash',note:'Recorrido',request_key:randomUUID()};
 const c=await request('/collections',collect,'seller');assert.equal((await request('/collections',collect,'seller')).id,c.id);
 let account=await request(`/accounts/${customer.id}`,undefined,'seller');assert.equal(account.balance_cents,650000000);
 await request('/collections',{...collect,amount:'9999999',request_key:randomUUID()},'seller','POST',400);
 await request(`/accounts/${customer.id}`,undefined,'other','GET',403);
 await request(`/sales/${first.id}/void`,{reason:'Prueba'},'admin','POST',409);
 await request(`/collections/${c.id}/reverse`,{reason:'Corrección'});await request(`/sales/${first.id}/void`,{reason:'Devolución'});await request(`/sales/${first.id}/void`,{reason:'Reintento'});
 account=await request(`/accounts/${customer.id}`,undefined,'seller');assert.equal(account.balance_cents,0);assert.equal(account.invoices.find(s=>s.id===first.id).state,'ANULADA');
 inv=await request('/inventory',undefined,'seller');assert.equal(inv.stock.find(s=>s.group_id===group.id).available_milli,600000);
 // Decimal KG, integer UND, partial and final collection, explicit allocation.
 const credit=await request('/sales',sell([{product_id:breast.id,quantity:'2.5'},{product_id:soda.id,quantity:'5'}],{credit:true}),'seller','POST',201);assert.equal(credit.total_cents,5500000);
 const creditHistory=await request('/sales?method=credit',undefined,'seller');assert.ok(creditHistory.sales.some(s=>s.id===credit.id));assert.equal(creditHistory.groups.method[0].total_cents,5500000);
 await request('/collections',{...collect,amount:'15000',request_key:randomUUID(),allocations:[{sale_id:credit.id,amount:'15000'}]},'seller');
 await request('/collections',{...collect,amount:'40000',request_key:randomUUID()},'seller');
 account=await request(`/accounts/${customer.id}`,undefined,'seller');assert.equal(account.invoices.find(s=>s.id===credit.id).state,'PAGADA');
 await request('/inventory',{route_id:r1.id,group_id:group.id,quantity:'1',kind:'adjust',note:'Ajuste',expected_available_milli:600000},'admin','POST',409);
 const summary=await request(`/cash-sessions/${session.id}`,undefined,'seller');assert.equal(summary.cash_cents,485500000);
 assert.equal((await request('/collections?method=cash')).length,3);assert.ok(db.prepare("SELECT COUNT(*) n FROM audit WHERE action='collection.reverse'").get().n);
 // Two distinct concurrent invoices compete for the same shared balance.
 const race=await Promise.all([fetch(`http://127.0.0.1:${server.address().port}/api/sales`,{method:'POST',headers:{Authorization:`Bearer ${tokens.seller}`,'Content-Type':'application/json'},body:JSON.stringify(sell([{product_id:whole.id,quantity:'400'}]))}),fetch(`http://127.0.0.1:${server.address().port}/api/sales`,{method:'POST',headers:{Authorization:`Bearer ${tokens.seller}`,'Content-Type':'application/json'},body:JSON.stringify(sell([{product_id:breast.id,quantity:'400'}]))})]);
 assert.deepEqual(race.map(r=>r.status).sort(),[201,409]);
 const available=(await request('/inventory',undefined,'seller')).stock.find(s=>s.group_id===group.id).available_milli;
 assert.equal(available,197500);
 await request('/inventory',{route_id:r1.id,group_id:group.id,quantity:'20',kind:'adjust',note:'Conteo físico',expected_available_milli:available});
 await request('/sales',sell([{product_id:breast.id,quantity:'25'}]),'seller','POST',409);
 assert.throws(()=>db.prepare('DELETE FROM collections').run(),/inmutable/);
 }finally{await new Promise(r=>server.close(r));db.close();}
});
