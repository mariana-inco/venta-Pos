import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../src/db.js';
import {createUser} from '../src/auth.js';
import {closeReviewedSessions} from '../src/admin-close.js';
import {closeSession,sessionFor,totals} from '../src/service.js';

test('Cierre administrativo: revisión atómica, confirmación, permisos, auditoría y reintento',async()=>{
 const db=openDatabase(':memory:');
 const admin=await createUser(db,{name:'Admin',username:'admin-close',password:'test-password-123',role:'admin'});
 const seller=await createUser(db,{name:'Vendedor',username:'seller-close',password:'test-password-123',role:'seller'});
 try{
  const ids=[randomUUID(),randomUUID(),randomUUID()],at=new Date().toISOString();
  for(let i=0;i<ids.length;i++)db.prepare("INSERT INTO cash_sessions(id,opened_by,opened_at,opening_cents,state,device_id) VALUES (?,?,?,?,'open',?)").run(ids[i],i===2?seller.id:admin.id,at,(i+1)*10000,i===2?null:randomUUID());
  const customer=randomUUID(),sale=randomUUID();
  db.prepare('INSERT INTO customers VALUES (?,?,?,?,?,?)').run(customer,'Cliente','Bogotá',1,at,at);
  db.prepare('INSERT INTO sales VALUES (?,?,?,?,?,?,?,?,?,?)').run(sale,1,ids[0],admin.id,customer,at,10000,'{}',randomUUID(),'test');
  db.prepare('INSERT INTO payments VALUES (?,?,?,?,?,?)').run(randomUUID(),sale,'cash',null,null,4000);
  db.prepare('INSERT INTO payments VALUES (?,?,?,?,?,?)').run(randomUUID(),sale,'electronic','nequi','Nequi',6000);
  const review=ids.map(id=>{const s=sessionFor(db,admin,id),t=totals(db,id);return {id,sale_count:t.sale_count,expected_cash_cents:s.opening_cents+t.cash_cents,electronic_cents:t.electronic_cents};});
  const confirmation={devices_synced:true,amounts:'recorded',reason:'El usuario confirmó cero pendientes y autorizó usar saldos registrados. Sin conteo físico informado.',request_key:randomUUID()};
  assert.throws(()=>closeSession(db,admin,ids[0],{declared_cash:'140',declared_electronic:'60',notes:''}),/dispositivo de origen/);
  assert.throws(()=>closeReviewedSessions(db,seller.id,review,confirmation),/administrador/);
  assert.throws(()=>closeReviewedSessions(db,admin.id,review,{...confirmation,devices_synced:false}),/confirmación/);
  assert.throws(()=>closeReviewedSessions(db,admin.id,review.map((r,i)=>i===2?{...r,expected_cash_cents:r.expected_cash_cents+1}:r),confirmation),/cambió/);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM cash_sessions WHERE state='open'").get().n,3);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM closures').get().n,0);
  const closed=closeReviewedSessions(db,admin.id,review,confirmation);
  assert.equal(closed.length,3);assert.equal(db.prepare("SELECT COUNT(*) n FROM cash_sessions WHERE state='open'").get().n,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM sales').get().n,1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM payments').get().n,2);
  for(let i=0;i<closed.length;i++){
   const snap=closed[i].snapshot;assert.equal(snap.close_mode,'administrative_recorded_totals');assert.equal(snap.physical_count_reported,false);assert.equal(snap.declared_cash_cents,review[i].expected_cash_cents);assert.equal(snap.declared_electronic_cents,review[i].electronic_cents);assert.equal(snap.devices_synced_confirmed_by,admin.id);assert.equal(snap.total_difference_cents,0);
  }
  assert.deepEqual(closeReviewedSessions(db,admin.id,review,confirmation).map(c=>c.id),closed.map(c=>c.id));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM closures').get().n,3);
  assert.throws(()=>closeReviewedSessions(db,admin.id,review,{...confirmation,reason:'Otro motivo'}),/referencia/);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM audit WHERE action='cash.close'").get().n,3);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM audit WHERE action='cash.admin_close_batch'").get().n,1);
 }finally{db.close();}
});
