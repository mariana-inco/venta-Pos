import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,audit} from '../src/db.js';
import {cleanStartCatalog} from '../src/clean-start-catalog.js';
test('limpieza de catálogo conserva admin y Robinson, elimina otros usuarios/productos y conserva relaciones/auditoría',()=>{
 const db=openDatabase(':memory:');
 try{
  for(const [key,role] of [['admin','admin'],['robin','seller'],['other','admin']])db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?)').run(key,key,key,'unchanged-password',role,1,'now');
  db.prepare('INSERT INTO sales_agents VALUES(?,?,?,?)').run('agent','other','Vendedor',1);
  audit(db,'other','user.create','other',{});
  db.prepare('INSERT INTO products VALUES(?,?,?,?,?,?,?,?)').run('product','Pollo',1000,'kg',1,null,'now','now');
  db.prepare('INSERT INTO product_codes VALUES(?,?,?)').run('001','product','internal');
  db.prepare('INSERT INTO product_pricing VALUES(?,?)').run('product',900);
  db.prepare('INSERT INTO cash_sessions VALUES(?,?,?,?,?,?,?)').run('cash','admin','now',0,'open',null,null);
  assert.throws(()=>cleanStartCatalog(db,{adminId:'admin',sellerId:'robin',expectedGeneration:'initial'}),/movimientos nuevos/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM products').get().n,1);
  db.exec('DROP TRIGGER session_no_delete; DELETE FROM cash_sessions;');
  const result=cleanStartCatalog(db,{adminId:'admin',sellerId:'robin',expectedGeneration:'initial'});
  assert.deepEqual(result.removed_users,['other']);assert.equal(result.removed_products,1);
  assert.deepEqual(db.prepare('SELECT username,role,active,password_hash FROM users ORDER BY username').all().map(u=>({...u})),[{username:'admin',role:'admin',active:1,password_hash:'unchanged-password'},{username:'robin',role:'seller',active:1,password_hash:'unchanged-password'}]);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM products').get().n,0);
  assert.equal(db.prepare('SELECT actor_id FROM audit WHERE action=?').get('user.create').actor_id,null);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.throws(()=>db.exec("UPDATE audit SET action='changed'"),/inmutable/);
 }finally{db.close();}
});
