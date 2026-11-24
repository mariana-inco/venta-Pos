import {migrateRouteCycles} from './route-cycles.js';
import {migrateReceiptNumbers} from './receipt-numbers.js';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
export const now = () => new Date().toISOString();
export const id = () => randomUUID();
export function openDatabase(path = process.env.DATABASE_PATH || './data/pos.sqlite') {
 if (path !== ':memory:') mkdirSync(dirname(resolve(path)), {recursive:true});
 const db = new DatabaseSync(path);
 db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
 migrate(db);
 for (const table of ['sales','sale_items','payments','closures','closure_notes','audit','documents','sync_events','offline_sales','catalog_versions','sync_issues','stock_movements','sale_terms','sale_voids','collections','collection_allocations','collection_reversals','sale_stock_effects','receipt_numbers','receipt_ranges','sale_agents','delivery_batches','delivery_items','daily_closures','sale_drafts','payment_references','route_reopenings','cash_expenses','route_openings','route_cycle_closures','route_operation_links','expense_evidence','expense_evidence_links']) {
  for (const operation of ['UPDATE','DELETE']) db.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_no_${operation} BEFORE ${operation} ON ${table} BEGIN SELECT RAISE(ABORT,'Registro inmutable'); END;`);
 }
 return db;
}
export const DEFAULT_BUSINESS_NAME = "Dok Pollo MC";
// Datos opcionales del comprobante. Se agregan sin tocar filas existentes; vacío = no se imprime.
export const BUSINESS_FIELDS = ['business_nit','business_address','business_phone','business_city'];
function migrate(db) {
 db.exec("CREATE TABLE IF NOT EXISTS data_generation(id INTEGER PRIMARY KEY CHECK(id=1),generation TEXT NOT NULL); INSERT OR IGNORE INTO data_generation VALUES(1,'initial');");
 db.exec(readFileSync(new URL('./commerce-schema.sql', import.meta.url), 'utf8'));
 db.exec(readFileSync(new URL('./users-schema.sql', import.meta.url), 'utf8'));
 const cashColumns = new Set(db.prepare('PRAGMA table_info(cash_sessions)').all().map(c => c.name));
 if (!cashColumns.has('device_id')) db.exec('ALTER TABLE cash_sessions ADD COLUMN device_id TEXT');
 db.exec('DROP INDEX IF EXISTS one_open_session');
 db.exec("CREATE UNIQUE INDEX IF NOT EXISTS one_open_session_per_device ON cash_sessions(opened_by,COALESCE(device_id,'web')) WHERE state='open'");
 db.exec(readFileSync(new URL('./sync-schema.sql', import.meta.url), 'utf8'));
 migrateReceiptNumbers(db);
 db.exec(readFileSync(new URL('./business-schema.sql', import.meta.url), 'utf8'));
 db.exec(readFileSync(new URL('./route-payments-schema.sql', import.meta.url), 'utf8'));
 // Remove only the old per-day uniqueness: multiple immutable close/reopen cycles are now allowed.
 const closureSql=db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='daily_closures'").get().sql;
 if(/UNIQUE\s*\(\s*route_id\s*,\s*day\s*\)/i.test(closureSql))transaction(db,()=>{
  const triggers=db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND tbl_name='daily_closures'").all();
  db.exec(`CREATE TABLE daily_closures_cycles(id TEXT PRIMARY KEY,route_id TEXT NOT NULL REFERENCES routes(id),day TEXT NOT NULL,actor_id TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,snapshot TEXT NOT NULL);
   INSERT INTO daily_closures_cycles SELECT * FROM daily_closures ORDER BY rowid;
   DROP TABLE daily_closures;
   ALTER TABLE daily_closures_cycles RENAME TO daily_closures;`);
  for(const t of triggers)db.exec(t.sql);
 });
 db.exec(readFileSync(new URL('./cash-route-schema.sql', import.meta.url), 'utf8'));
 db.exec(readFileSync(new URL('./offline-route-schema.sql', import.meta.url), 'utf8'));
 db.exec(readFileSync(new URL('./route-cycle-schema.sql', import.meta.url), 'utf8'));
 migrateRouteCycles(db);
 db.exec(readFileSync(new URL('./expense-evidence-schema.sql', import.meta.url), 'utf8'));

 // Import only real references already saved in legacy sale snapshots; never invent missing values.
 const legacyReferences=db.prepare("SELECT p.id payment_id,p.platform_id,json_extract(s.snapshot,'$.payment_reference') reference,s.created_at FROM payments p JOIN sales s ON s.id=p.sale_id WHERE p.method='electronic' AND p.platform_id IS NOT NULL AND length(trim(COALESCE(json_extract(s.snapshot,'$.payment_reference'),'')))>0").all();
 for(const r of legacyReferences)db.prepare('INSERT OR IGNORE INTO payment_references VALUES (?,?,?,?,?,?,?)').run('legacy-'+r.payment_id,r.platform_id,String(r.reference).trim(),String(r.reference).normalize('NFKC').replace(/\s/g,'').toUpperCase(),r.payment_id,null,r.created_at);


 const columns = new Set(db.prepare('PRAGMA table_info(settings)').all().map(c => c.name));
 for (const field of BUSINESS_FIELDS) if (!columns.has(field)) db.exec(`ALTER TABLE settings ADD COLUMN ${field} TEXT NOT NULL DEFAULT ''`);
 // Solo reemplaza el nombre genérico inicial; un nombre configurado por el administrador se respeta.
 db.prepare("UPDATE settings SET business_name=? WHERE id=1 AND business_name IN ('Mi negocio', 'DISTRIBUIDORA & SALSAMENTARIA DANNY''S')").run(DEFAULT_BUSINESS_NAME);
}
const depths = new WeakMap();
export function transaction(db, fn) {
 const depth = depths.get(db) || 0;
 const point = `nested_${depth}`;
 db.exec(depth ? `SAVEPOINT ${point}` : 'BEGIN IMMEDIATE');
 depths.set(db,depth+1);
 try {const result=fn(); db.exec(depth ? `RELEASE ${point}` : 'COMMIT'); return result;}
 catch(e) {db.exec(depth ? `ROLLBACK TO ${point}` : 'ROLLBACK'); if(depth)db.exec(`RELEASE ${point}`); throw e;}
 finally {depths.set(db,depth);}
}
export function audit(db, actor, action, entity, detail = {}) {
 db.prepare('INSERT INTO audit VALUES (?,?,?,?,?,?)').run(id(), actor, action, entity, JSON.stringify(detail), now());
}
