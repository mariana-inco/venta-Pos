import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {openDatabase} from '../src/db.js';
import {backedUpReset,resetOperations} from '../src/reset-operations.js';
import {registerDevice,authenticateDevice} from '../src/sync.js';
import {dataGeneration} from '../src/data-generation.js';
import {LocalStore} from '../../mobile/src/offline/store.js';
test('reinicio respaldado conserva catálogos, borra cajas e inventario y bloquea terminales anteriores',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'pos-reset-')),db=openDatabase(join(dir,'pos.sqlite'));
 try{
  const user={id:randomUUID(),role:'admin',name:'Admin'};
  db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?)').run(user.id,'admin','Admin','hash','admin',1,new Date().toISOString());
  const product=randomUUID();db.prepare('INSERT INTO products VALUES(?,?,?,?,?,?,?,?)').run(product,'Pollo',1000,'kg',1,1000,'now','now');
  const customer=randomUUID();db.prepare('INSERT INTO customers VALUES(?,?,?,?,?,?)').run(customer,'Cliente','Bogotá',1,'now','now');
  const session=randomUUID();db.prepare('INSERT INTO cash_sessions VALUES(?,?,?,?,?,?,?)').run(session,user.id,'now',0,'open',null,null);
  const device=randomUUID(),grant=registerDevice(db,user,{device_id:device,name:'Terminal'});
  assert.throws(()=>resetOperations(db,{expectedGeneration:'initial'}),/seguridad/);
  db.exec("CREATE TRIGGER fail_reset BEFORE UPDATE OF stock_milli ON products BEGIN SELECT RAISE(ABORT,'reset blocked'); END;");
  await assert.rejects(()=>backedUpReset(db,join(dir,'failed-backup.sqlite'),'initial'),/reset blocked/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM cash_sessions').get().n,1);
  assert.equal(dataGeneration(db),'initial');
  assert.throws(()=>db.prepare('DELETE FROM cash_sessions').run(),/Historial permanente/);
  db.exec('DROP TRIGGER fail_reset');
  const result=await backedUpReset(db,join(dir,'backup.sqlite'),'initial');
  assert.equal(result.deleted.cash_sessions,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM cash_sessions').get().n,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM customers').get().n,1);
  assert.equal(db.prepare('SELECT stock_milli FROM products').get().stock_milli,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n,1);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  const copy=new DatabaseSync(join(dir,'backup.sqlite'));assert.equal(copy.prepare('SELECT COUNT(*) n FROM cash_sessions').get().n,1);copy.close();
  assert.throws(()=>registerDevice(db,user,{device_id:device,name:'Antigua'}),/Actualiza/);
  let status;authenticateDevice(db)({headers:{authorization:'Bearer '+grant.token}},{status(s){status=s;return this;},json(){}},()=>assert.fail('Token antiguo autorizado'));
  assert.equal(status,401);
  registerDevice(db,user,{device_id:device,name:'Nueva',generation:result.generation});
  assert.throws(()=>resetOperations(db,{backupPath:result.backup,expectedGeneration:'initial'}),/cambió/);
  const newSession=randomUUID();db.prepare('INSERT INTO cash_sessions VALUES(?,?,?,?,?,?,?)').run(newSession,user.id,'now',0,'open',null,null);
  assert.throws(()=>db.prepare('DELETE FROM cash_sessions').run(),/Historial permanente/);
  assert.equal(dataGeneration(db),result.generation);
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
test('Android descarta cola, borradores e historial anteriores una sola vez y conserva identidad del equipo',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  const store=new LocalStore({exec:s=>db.exec(s),run:(s,...a)=>db.prepare(s).run(...a),get:(s,...a)=>db.prepare(s).get(...a),all:(s,...a)=>db.prepare(s).all(...a)},randomUUID);
  const device=store.deviceId;store.put('session',{id:'old'});store.setMeta('pending-user',{session_id:'old'});store.enqueue({id:'user'},'cash.open',{opening_cents:0});
  assert.equal(store.reconcileGeneration('initial'),false);assert.equal(store.pending().length,1);
  assert.equal(store.reconcileGeneration('new-generation'),true);assert.equal(store.pending().length,0);assert.equal(store.get('session','old'),null);assert.equal(store.meta('pending-user'),null);assert.equal(store.deviceId,device);
  store.put('session',{id:'new'});assert.equal(store.reconcileGeneration('new-generation'),false);assert.ok(store.get('session','new'));
 }finally{db.close();}
});
