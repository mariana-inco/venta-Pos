// One-off authorized correction. Never run automatically at startup or during migration.
// --check creates a backup and rehearses; --execute repeats all guards before committing.
import assert from 'node:assert/strict';
import {DatabaseSync,backup} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import {chmodSync,copyFileSync,unlinkSync,mkdirSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {transaction,audit} from '../src/db.js';
import {totals,saleDetail} from '../src/service.js';
import {customerBalance} from '../src/commerce.js';
import {generateDocuments} from '../src/documents.js';
const SALE='caef5d18-39cf-47a4-9011-4f52ab0a10b7',PAYMENT='c3f37915-8870-4e4d-a690-53ffa12f37bf',SESSION='23cb7521-111d-44e5-a8a2-7d4387a99364';
const ACTION='sale.p35.initial_payment_split.authorized';
const quote=s=>'"'+s.replaceAll('"','""')+'"';
const hash=value=>createHash('sha256').update(JSON.stringify(value,(_,v)=>ArrayBuffer.isView(v)?{bytes:v.byteLength,sha256:createHash('sha256').update(v).digest('hex')}:v)).digest('hex');
const hashQuery=(db,sql,...args)=>{const h=createHash('sha256');for(const row of db.prepare(sql).iterate(...args))h.update(hash(row));return h.digest('hex');};
const fingerprint=db=>Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>[r.name,hashQuery(db,'SELECT * FROM '+quote(r.name)+' ORDER BY rowid')]));
function correct(db,backupPath,forceRollback=false){return transaction(db,()=>{
 assert(!db.prepare('SELECT 1 FROM audit WHERE action=? AND entity_id=?').get(ACTION,SALE),'La corrección P-35 ya fue aplicada.');
 const sale=db.prepare('SELECT * FROM sales WHERE id=?').get(SALE),terms=db.prepare('SELECT * FROM sale_terms WHERE sale_id=?').get(SALE);
 assert(sale?.session_id===SESSION&&sale.total_cents===121575000&&sale.created_at==='2026-11-24T20:37:39.204Z'&&JSON.parse(sale.snapshot).receipt_number==='P-35','P-35 no coincide con la revisión; no se modifica.');
 assert(terms?.credit===1&&terms.initial_paid_cents===101400000,'El abono inicial cambió.');
 const payments=db.prepare('SELECT * FROM payments WHERE sale_id=? ORDER BY rowid').all(SALE),original=payments[0];
 assert(payments.length===1&&original.id===PAYMENT&&original.method==='electronic'&&original.platform_id==='bold'&&original.amount_cents===101400000,'La distribución cambió.');
 const reference=db.prepare('SELECT * FROM payment_references WHERE payment_id=?').get(PAYMENT);assert(reference?.reference==='ZGCYTS27I3','La referencia Bold cambió.');
 assert(!db.prepare('SELECT 1 FROM sale_voids WHERE sale_id=?').get(SALE),'La factura está anulada.');
 assert(db.prepare('SELECT state FROM cash_sessions WHERE id=?').get(SESSION)?.state==='open'&&!db.prepare('SELECT 1 FROM closures WHERE session_id=?').get(SESSION),'La caja se cerró: revisar su cierre antes de corregir.');
 const actor=db.prepare("SELECT id,role FROM users WHERE role='admin' AND active=1 ORDER BY created_at LIMIT 1").get();assert(actor,'No hay administrador activo.');
 const before=fingerprint(db),debt=customerBalance(db,sale.customer_id),cashBefore=totals(db,SESSION);
 const otherPayments=hash(db.prepare('SELECT * FROM payments WHERE sale_id<>? ORDER BY rowid').all(SALE)),otherDocs=hashQuery(db,'SELECT * FROM documents WHERE sale_id IS NULL OR sale_id<>? ORDER BY rowid',SALE);
 const triggers=db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name IN ('payments_no_UPDATE','documents_no_DELETE')").all();assert.equal(triggers.length,2);
 for(const t of triggers)db.exec('DROP TRIGGER '+quote(t.name));
 assert.equal(db.prepare('UPDATE payments SET amount_cents=? WHERE id=? AND amount_cents=?').run(95000000,PAYMENT,101400000).changes,1);
 const cashId=randomUUID();db.prepare('INSERT INTO payments VALUES(?,?,?,?,?,?)').run(cashId,SALE,'cash',null,null,6400000);
 const invalidated=db.prepare('DELETE FROM documents WHERE sale_id=?').run(SALE).changes;
 for(const t of triggers)db.exec(t.sql);
 if(forceRollback)throw new Error('TEST_ROLLBACK');
 const after=totals(db,SESSION);assert.equal(after.cash_cents,cashBefore.cash_cents+6400000);assert.equal(after.electronic_cents,cashBefore.electronic_cents-6400000);assert.equal(after.cash_cents+after.electronic_cents,cashBefore.cash_cents+cashBefore.electronic_cents);assert.equal(after.total_cents,cashBefore.total_cents);
 assert.equal(customerBalance(db,sale.customer_id),debt);assert.equal(db.prepare('SELECT SUM(amount_cents) n FROM payments WHERE sale_id=?').get(SALE).n,101400000);
 assert.equal(otherPayments,hash(db.prepare('SELECT * FROM payments WHERE sale_id<>? ORDER BY rowid').all(SALE)));assert.equal(otherDocs,hashQuery(db,'SELECT * FROM documents WHERE sale_id IS NULL OR sale_id<>? ORDER BY rowid',SALE));
 const changed=fingerprint(db);for(const [table,value] of Object.entries(before))if(!['payments','documents','audit'].includes(table))assert.equal(changed[table],value,'Tabla ajena alterada: '+table);
 assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 const corrected=db.prepare('SELECT * FROM payments WHERE sale_id=? ORDER BY rowid').all(SALE);
 audit(db,actor.id,ACTION,SALE,{authorization:'Distribuir el abono inicial existente: Bold $950.000 y efectivo $64.000. Mantener compra, abono, saldo y fecha.',backup:backupPath,original_payments:payments,corrected_payments:corrected,original_reference:reference,original_sale_created_at:sale.created_at,total_cents:sale.total_cents,initial_paid_cents:101400000,customer_balance_cents:debt,cash_delta_cents:6400000,electronic_delta_cents:-6400000,invalidated_pdf_count:invalidated});
 return {sale:'P-35',total_cents:sale.total_cents,initial_paid_cents:101400000,customer_balance_cents:debt,created_at:sale.created_at,payments:corrected.map(p=>({method:p.method,platform:p.platform_name,amount_cents:p.amount_cents})),session_id:SESSION};
});}
const mode=process.argv[2]||'--check';assert(['--check','--execute'].includes(mode));
const dbPath=process.env.DATABASE_PATH||'/data/pos.sqlite',db=new DatabaseSync(dbPath);db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
const folder=join(dirname(dbPath),'backups');mkdirSync(folder,{recursive:true});const path=join(folder,'before-p35-payment-split-'+new Date().toISOString().replaceAll(':','-')+'.sqlite');await backup(db,path);chmodSync(path,0o600);
const rehearsal=path+'.rehearsal';copyFileSync(path,rehearsal);const copy=new DatabaseSync(rehearsal);copy.exec('PRAGMA foreign_keys=ON;');
try{const initial=fingerprint(copy);assert.throws(()=>correct(copy,path,true),/TEST_ROLLBACK/);assert.deepEqual(fingerprint(copy),initial);const checked=correct(copy,path);if(mode==='--check')console.log(JSON.stringify({executed:false,backup:path,rollback_verified:true,result:checked}));}finally{copy.close();unlinkSync(rehearsal);}
if(mode==='--execute'){const result=correct(db,path);const user=db.prepare("SELECT id,role FROM users WHERE role='admin' AND active=1 LIMIT 1").get();const documents=await generateDocuments(db,'sale',saleDetail(db,user,SALE));console.log(JSON.stringify({executed:true,backup:path,rollback_verified:true,result,documents,integrity:db.prepare('PRAGMA integrity_check').get().integrity_check}));}
db.close();
