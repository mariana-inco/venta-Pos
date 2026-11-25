import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {openDatabase} from '../src/db.js';
import {createUser} from '../src/auth.js';
test('Corrección P-35 ensayada, acotada e irrepetible preserva saldo, fecha, referencia y tablas ajenas',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'pos-p35-')),path=join(dir,'test.sqlite'),db=openDatabase(path);
 try{
 const admin=await createUser(db,{username:'admin',name:'Admin',password:'testing-password123',role:'admin'}),at='2026-11-24T20:37:39.204Z',sid='23cb7521-111d-44e5-a8a2-7d4387a99364',sale='caef5d18-39cf-47a4-9011-4f52ab0a10b7',payment='c3f37915-8870-4e4d-a690-53ffa12f37bf',customer=randomUUID();
 db.prepare('INSERT INTO customers VALUES(?,?,?,?,?,?)').run(customer,'Camilo','Villeta',1,at,at);db.prepare('INSERT INTO cash_sessions(id,opened_by,opened_at,opening_cents,state) VALUES(?,?,?,?,?)').run(sid,admin.id,at,0,'open');
 db.prepare('INSERT INTO sales VALUES(?,?,?,?,?,?,?,?,?,?)').run(sale,27,sid,admin.id,customer,at,121575000,JSON.stringify({receipt_number:'P-35',customer_name:'Camilo',seller_name:'Robinson',credit:true,initial_paid_cents:101400000,initial_balance_cents:20175000}),randomUUID(),'original');
 db.prepare('INSERT INTO sale_terms VALUES(?,?,?,?)').run(sale,null,1,101400000);db.prepare('INSERT INTO payments VALUES(?,?,?,?,?,?)').run(payment,sale,'electronic','bold','Bold',101400000);db.prepare('INSERT INTO payment_references VALUES(?,?,?,?,?,?,?)').run(randomUUID(),'bold','ZGCYTS27I3','ZGCYTS27I3',payment,null,at);
 const script=fileURLToPath(new URL('../scripts/correct-p35-payments.mjs',import.meta.url)),env={...process.env,DATABASE_PATH:path};
 const run=mode=>JSON.parse(execFileSync(process.execPath,[script,mode],{env,encoding:'utf8'}));
 assert.equal(run('--check').executed,false);assert.equal(db.prepare('SELECT COUNT(*) n FROM payments').get().n,1);
 const result=run('--execute');assert.equal(result.rollback_verified,true);assert.equal(result.integrity,'ok');assert.equal(result.result.customer_balance_cents,20175000);assert.equal(result.result.created_at,at);assert.equal(db.prepare('SELECT total_cents FROM sales').get().total_cents,121575000);assert.equal(db.prepare('SELECT amount_cents FROM payments WHERE id=?').get(payment).amount_cents,95000000);assert.equal(db.prepare("SELECT amount_cents FROM payments WHERE method='cash'").get().amount_cents,6400000);assert.equal(db.prepare('SELECT created_at FROM payment_references').get().created_at,at);assert.equal(db.prepare('SELECT COUNT(*) n FROM collections').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM documents').get().n,2);
 assert.throws(()=>run('--execute'));assert.throws(()=>db.prepare('UPDATE payments SET amount_cents=1').run(),/inmutable/);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
