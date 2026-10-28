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
 for (const table of ['sales','sale_items','payments','closures','closure_notes','audit','documents','sync_events','offline_sales','catalog_versions','sync_issues']) {
  for (const operation of ['UPDATE','DELETE']) db.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_no_${operation} BEFORE ${operation} ON ${table} BEGIN SELECT RAISE(ABORT,'Registro inmutable'); END;`);
 }
 return db;
}
export const DEFAULT_BUSINESS_NAME = "DISTRIBUIDORA & SALSAMENTARIA DANNY'S";
// Datos opcionales del comprobante. Se agregan sin tocar filas existentes; vacío = no se imprime.
export const BUSINESS_FIELDS = ['business_nit','business_address','business_phone','business_city'];
function migrate(db) {
 const cashColumns = new Set(db.prepare('PRAGMA table_info(cash_sessions)').all().map(c => c.name));
 if (!cashColumns.has('device_id')) db.exec('ALTER TABLE cash_sessions ADD COLUMN device_id TEXT');
 db.exec('DROP INDEX IF EXISTS one_open_session');
 db.exec("CREATE UNIQUE INDEX IF NOT EXISTS one_open_session_per_device ON cash_sessions(opened_by,COALESCE(device_id,'web')) WHERE state='open'");
 db.exec(readFileSync(new URL('./sync-schema.sql', import.meta.url), 'utf8'));

 const columns = new Set(db.prepare('PRAGMA table_info(settings)').all().map(c => c.name));
 for (const field of BUSINESS_FIELDS) if (!columns.has(field)) db.exec(`ALTER TABLE settings ADD COLUMN ${field} TEXT NOT NULL DEFAULT ''`);
 // Solo reemplaza el nombre genérico inicial; un nombre configurado por el administrador se respeta.
 db.prepare("UPDATE settings SET business_name=? WHERE id=1 AND business_name='Mi negocio'").run(DEFAULT_BUSINESS_NAME);
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
