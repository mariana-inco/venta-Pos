import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {openDatabase} from '../src/db.js';
import {createUser,login} from '../src/auth.js';
import {createApp} from '../src/app.js';
import {routeUser,stockProduct,prepareRequest} from './business-fixtures.js';
import {closurePdf} from '../src/pdf.js';
import {ticketHtml} from '../../mobile/src/printing/receipt.js';

test('Migración de cierres: conserva fotografías y permite ciclos auditados; es repetible',()=>{
 const dir=mkdtempSync(join(tmpdir(),'pos-closure-migrate-')),path=join(dir,'pos.sqlite');let d=new DatabaseSync(path);
 try{
  for(const file of ['schema.sql','commerce-schema.sql','business-schema.sql']){let sql=readFileSync(new URL('../src/'+file,import.meta.url),'utf8');if(file==='business-schema.sql')sql=sql.replace('snapshot TEXT NOT NULL);','snapshot TEXT NOT NULL,UNIQUE(route_id,day));');d.exec(sql);}
  const u=randomUUID(),r=randomUUID(),c=randomUUID(),snapshot=JSON.stringify({original:'Conservado',inventory:{groups:[]}});
  d.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?)').run(u,'admin','Admin','x','admin',1,'2026-01-01');d.prepare('INSERT INTO routes VALUES(?,?,?)').run(r,'Ruta',1);d.prepare('INSERT INTO daily_closures VALUES(?,?,?,?,?,?)').run(c,r,'2026-01-01',u,'2026-01-01',snapshot);d.close();
  for(let i=0;i<2;i++){d=openDatabase(path);assert.equal(d.prepare('SELECT snapshot FROM daily_closures WHERE id=?').get(c).snapshot,snapshot);assert.throws(()=>d.prepare('DELETE FROM daily_closures WHERE id=?').run(c),/inmutable/);assert.deepEqual(d.prepare('PRAGMA foreign_key_check').all(),[]);d.close();}
 }finally{try{d.close();}catch{}rmSync(dir,{recursive:true,force:true});}
});

test('Reabrir ruta: permisos, concurrencia, ciclos, restauración exacta, fallos atómicos y bloqueo ante ajustes posteriores',async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-11-17T15:00:00Z')});
 const d=openDatabase(':memory:'),users={},tokens={};for(const role of ['admin','seller']){users[role]=await createUser(d,{name:role,username:role,role,password:'password-testing-123'});tokens[role]=(await login(d,role,'password-testing-123')).token;}
 const {routeId}=routeUser(d,users.admin.id);d.prepare('INSERT INTO seller_routes VALUES(?,?)').run(users.seller.id,routeId);
 const p=randomUUID();d.prepare('INSERT INTO products VALUES(?,?,?,?,?,?,?,?)').run(p,'Pollo',1000000,'kg',1,null,new Date().toISOString(),new Date().toISOString());const g=stockProduct(d,routeId,p,1000000);
 const server=createApp(d).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}/api`;
 const req=async(path,body,role='admin',status=200)=>{const r=await fetch(base+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+tokens[role],'Content-Type':'application/json'},body:body&&JSON.stringify(body)});const v=await r.json();assert.equal(r.status,status,JSON.stringify(v));return v;};
 try{
  const c=await req('/route/close',{}),original=d.prepare('SELECT snapshot FROM daily_closures WHERE id=?').get(c.id).snapshot;
  assert.equal(d.prepare('SELECT available_milli FROM route_stock WHERE route_id=?').get(routeId).available_milli,0);
  const body={closure_id:c.id,request_key:randomUUID()};await req('/route/open',body,'seller',403);
  d.exec("CREATE TRIGGER test_reopen_failure BEFORE UPDATE ON route_stock WHEN NEW.available_milli>0 BEGIN SELECT RAISE(ABORT,'simulated failure'); END");await req('/route/open',body,'admin',500);assert.equal(d.prepare('SELECT count(*) n FROM route_reopenings').get().n,0);assert.equal(d.prepare('SELECT available_milli FROM route_stock').get().available_milli,0);d.exec('DROP TRIGGER test_reopen_failure');
  const contenders=await Promise.all([0,1].map(()=>fetch(base+'/route/open',{method:'POST',headers:{Authorization:'Bearer '+tokens.admin,'Content-Type':'application/json'},body:JSON.stringify({closure_id:c.id,request_key:randomUUID()})})));assert.deepEqual(contenders.map(r=>r.status).sort(),[200,409]);
  assert.equal((await req('/route/closure')).closure,null);assert.equal(d.prepare('SELECT available_milli FROM route_stock').get().available_milli,1000000);assert.equal(d.prepare('SELECT initial_milli FROM route_stock').get().initial_milli,1000000);assert.equal(d.prepare('SELECT snapshot FROM daily_closures WHERE id=?').get(c.id).snapshot,original);
  const second=await req('/route/close',{},'seller');assert.notEqual(second.id,c.id);assert.equal((await req('/daily-closures')).length,2);assert.ok((await req('/daily-closures')).find(x=>x.id===c.id).reopened_at);
  const secondBody={closure_id:second.id,request_key:randomUUID()};const opened=await req('/route/open',secondBody);assert.equal((await req('/route/open',secondBody)).id,opened.id);assert.equal(d.prepare('SELECT available_milli FROM route_stock').get().available_milli,1000000);
  const third=await req('/route/close',{});d.prepare('INSERT INTO stock_movements VALUES(?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),routeId,d.prepare('SELECT group_id FROM route_stock').get().group_id,null,null,1000,'adjust',users.admin.id,'Ajuste posterior',new Date().toISOString());await req('/route/open',{closure_id:third.id,request_key:randomUUID()},'admin',409);assert.equal(d.prepare('SELECT available_milli FROM route_stock').get().available_milli,0);
  t.mock.timers.tick(86400000);tokens.admin=(await login(d,'admin','password-testing-123')).token;await req('/route/open',{closure_id:third.id,request_key:randomUUID()},'admin',409);assert.equal((await req('/route/closure')).closure,null);
 }finally{await new Promise(r=>server.close(r));d.close();}
});

test('Gastos y abonos por cliente: efectivo neto, reintentos, permisos, concurrencia, cierre/PDF inmutables',async()=>{
 const db=openDatabase(':memory:'),users={},tokens={};for(const role of ['admin','seller','other']){users[role]=await createUser(db,{name:role,username:role,role:role==='admin'?'admin':'seller',password:'password-testing-123'});tokens[role]=(await login(db,role,'password-testing-123')).token;}
 const {routeId,agentId}=routeUser(db,users.seller.id);const product=randomUUID(),customer=randomUUID();
 db.prepare('INSERT INTO products VALUES(?,?,?,?,?,?,?,?)').run(product,'Pollo',1000000,'kg',1,null,new Date().toISOString(),new Date().toISOString());stockProduct(db,routeId,product,100000);
 db.prepare('INSERT INTO customers VALUES(?,?,?,?,?,?)').run(customer,'Cliente abono','Bogotá',1,new Date().toISOString(),new Date().toISOString());db.prepare('INSERT INTO customer_routes(customer_id,route_id) VALUES(?,?)').run(customer,routeId);
 const server=createApp(db).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}/api`;
 const req=async(path,body,role='seller',status=200)=>{if(body)body=prepareRequest(db,tokens[role],path,body);const r=await fetch(base+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+tokens[role],'Content-Type':'application/json'},body:body&&JSON.stringify(body)});const v=await r.json();assert.equal(r.status,status,JSON.stringify(v));return v;};
 try{
  const s=await req('/cash-sessions',{opening:'1000'},'seller',201);
  const expense=(amount='200')=>({session_id:s.id,description:'Transporte',amount,request_key:randomUUID()});const body=expense();const e=await req('/expenses',body,'seller',201);assert.equal((await req('/expenses',body,'seller',201)).id,e.id);await req('/expenses',{...body,amount:'201'},'seller',409);
  await req('/expenses',expense(),'other',403);await req('/expenses',expense(),'admin',403);await req('/cash-sessions/'+s.id+'/expenses',undefined,'other',403);await req('/expenses',expense('0'),'seller',400);await req('/expenses',expense('801'),'seller',409);
  const sale=method=>req('/sales',{customer_id:customer,session_id:s.id,agent_id:agentId,method,items:[{product_id:product,quantity:'1'}],request_key:randomUUID()},'seller',201);
  await sale('cash');await sale('credit');await req('/collections',{customer_id:customer,session_id:s.id,amount:'3000',method:'cash',request_key:randomUUID()});await req('/collections',{customer_id:customer,session_id:s.id,amount:'1000',method:'electronic',platform_id:'nequi',reference:'AB-1',request_key:randomUUID()});
  const reviewed=await req('/cash-sessions/'+s.id);assert.equal(reviewed.cash_cents,1300000);assert.equal(reviewed.expense_cents,20000);assert.equal(reviewed.expected_cash_cents,1380000);assert.equal(reviewed.total_cents,2000000);assert.equal(reviewed.collection_details[0].customer_name,'Cliente abono');assert.equal(reviewed.collection_details[0].user_name,'seller');
  const race=await Promise.all([0,1].map(()=>fetch(base+'/expenses',{method:'POST',headers:{Authorization:'Bearer '+tokens.seller,'Content-Type':'application/json'},body:JSON.stringify(expense('8000'))})));assert.deepEqual(race.map(r=>r.status).sort(),[201,409]);
  const close=(key)=>({declared_cash:'5800',declared_electronic:'1000',reviewed_movement_key:key,reviewed_sale_count:2});await req('/cash-sessions/'+s.id+'/close',close(reviewed.movement_key),'admin',409);
  const latest=await req('/cash-sessions/'+s.id);assert.equal(latest.expected_cash_cents,580000);const c=await req('/cash-sessions/'+s.id+'/close',close(latest.movement_key),'admin',201);assert.equal(c.snapshot.expected_cash_cents,580000);assert.equal(c.snapshot.expense_cents,820000);assert.equal(c.snapshot.cash_difference_cents,0);assert.equal(c.snapshot.collection_details.length,2);
  await req('/expenses',expense(),'seller',409);assert.equal((await req('/expenses',body,'seller',201)).id,e.id);
  db.prepare('UPDATE customers SET name=? WHERE id=?').run('Nombre cambiado',customer);assert.equal((await req('/closures/'+c.id,undefined,'admin')).snapshot.collection_details[0].customer_name,'Cliente abono');
  const pdf=await closurePdf(c,58),text=execFileSync('pdftotext',['-','-'],{input:pdf}).toString();assert.match(text,/Cliente abono/);assert.match(text,/Transporte/);assert.match(text,/GASTOS EN EFECTIVO/);assert.match(text,/8\.200/);assert.match(ticketHtml(c,'closure'),/CLIENTES QUE ABONARON/);
  if(process.env.CLOSURE_EXAMPLE)writeFileSync(process.env.CLOSURE_EXAMPLE,pdf);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{await new Promise(r=>server.close(r));db.close();}
});
