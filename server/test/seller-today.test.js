import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {openDatabase} from '../src/db.js';
import {digest} from '../src/auth.js';
import {createApp} from '../src/app.js';
import {LocalStore} from '../../mobile/src/offline/store.js';

test('Ventas del vendedor: solo hoy Colombia, incluso con filtros manipulados, ID/PDF, caché local y cambio de jornada; admin conserva históricos',async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-11-20T05:00:00.000Z')});
 const d=openDatabase(':memory:'),users={},tokens={};
 for(const role of ['admin','seller','other']){const id=randomUUID(),token=randomBytes(32).toString('hex');users[role]={id,role:role==='admin'?'admin':'seller'};tokens[role]=token;d.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?)').run(id,role,role,'fixture',users[role].role,1,new Date().toISOString());d.prepare('INSERT INTO auth_sessions VALUES(?,?,?)').run(digest(token),id,'2099-01-01T00:00:00.000Z');}
 const customer=randomUUID();d.prepare('INSERT INTO customers VALUES(?,?,?,?,?,?)').run(customer,'Cliente','Bogotá',1,new Date().toISOString(),new Date().toISOString());
 const records=[];
 for(const [i,date] of ['2026-11-20T04:59:59.999Z','2026-11-20T05:00:00.000Z','2026-11-21T05:00:00.000Z','2026-11-20T06:00:00.000Z'].entries()){
  const user=i===3?users.other:users.seller,session=randomUUID(),id=randomUUID(),snapshot={business_name:'Dok Pollo MC',seller_name:'Vendedor',customer_name:'Cliente',customer_city:'Bogotá'};
  d.prepare('INSERT INTO cash_sessions VALUES(?,?,?,?,?,?,?)').run(session,user.id,date,0,'open',null,'device-'+i);
  d.prepare('INSERT INTO sales VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,i+1,session,user.id,customer,date,10000,JSON.stringify(snapshot),randomUUID(),'fixture');records.push({id,number:i+1,session_id:session,seller_id:user.id,customer_id:customer,created_at:date,total_cents:10000,snapshot});
 }
 const localDb=new DatabaseSync(':memory:');const local=new LocalStore({exec:s=>localDb.exec(s),run:(s,...a)=>localDb.prepare(s).run(...a),get:(s,...a)=>localDb.prepare(s).get(...a),all:(s,...a)=>localDb.prepare(s).all(...a)},randomUUID);for(const s of records)local.put('sale',s);
 const server=createApp(d).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}/api`;
 const req=async(path,role='seller',status=200)=>{const r=await fetch(base+path,{headers:{Authorization:'Bearer '+tokens[role]}});assert.equal(r.status,status,path);return r.headers.get('content-type')?.includes('application/json')?r.json():r.arrayBuffer();};
 try{
  for(const q of ['', '?from=2026-11-19&to=2026-11-19','?from=2000-01-01&to=2099-12-31','?from=2026-11-21&to=2026-11-21']){const p=await req('/sales'+q);assert.equal(p.count,1);assert.deepEqual(p.sales.map(s=>s.id),[records[1].id]);assert.equal(p.groups.date[0].key,'2026-11-20');assert.equal(p.groups.date[0].total_cents,10000);}
  assert.equal((await req('/sales?session_id='+records[0].session_id)).count,0);assert.equal((await req('/sales?seller_id='+users.other.id)).count,0);
  for(const i of [0,2,3]){await req('/sales/'+records[i].id,'seller',403);await req('/sales/'+records[i].id+'/pdf','seller',403);}
  await req('/sales/'+records[1].id);await req('/sales/'+records[1].id+'/pdf');
  assert.equal((await req('/sales','admin')).count,4);assert.equal((await req('/sales?from=2026-11-19&to=2026-11-19','admin')).count,1);await req('/sales/'+records[0].id,'admin');await req('/sales/'+records[0].id+'/pdf','admin');
  assert.deepEqual(local.sales(users.seller).map(s=>s.id),[records[1].id]);assert.equal(local.sales(users.admin).length,4);assert.throws(()=>local.request(users.seller,'/sales/'+records[0].id,'GET'),/Venta no encontrada/);
  assert.equal(local.salesPage(users.seller,new URLSearchParams('from=2000-01-01&to=2099-12-31')).count,1);
  t.mock.timers.tick(86400000);assert.deepEqual((await req('/sales')).sales.map(s=>s.id),[records[2].id]);await req('/sales/'+records[1].id,'seller',403);assert.deepEqual(local.sales(users.seller).map(s=>s.id),[records[2].id]);assert.equal(d.prepare('SELECT count(*) n FROM sales').get().n,4);
 }finally{await new Promise(r=>server.close(r));d.close();localDb.close();}
});
