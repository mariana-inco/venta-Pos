import {backup,DatabaseSync} from 'node:sqlite';
import {mkdirSync,existsSync,chmodSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {dataGeneration} from './data-generation.js';
const tables=['route_reopenings','cash_expenses','payment_references','documents','closure_notes','closures','collection_allocations','collection_reversals','collections','sale_agents','sale_terms','sale_voids','sale_stock_effects','stock_movements','offline_sales','sync_issues','sale_items','payments','receipt_numbers','receipt_ranges','sales','sale_drafts','daily_closures','delivery_items','delivery_batches','cash_sessions','stock_debts','sync_events','device_catalogs','catalog_versions','device_access','sync_devices','auth_sessions'];
const quote=s=>'"'+s.replaceAll('"','""')+'"';
export function resetOperations(db,{backupPath,expectedGeneration}){
 if(!backupPath)throw new Error('Se requiere una copia de seguridad verificada.');
 if(dataGeneration(db)!==expectedGeneration)throw new Error('La base cambió desde la revisión; no se repite el reinicio.');
 const generation=randomUUID(),counts={};
 db.exec('PRAGMA foreign_keys=OFF; BEGIN EXCLUSIVE');
 try{
  if(dataGeneration(db)!==expectedGeneration)throw new Error('El reinicio ya fue ejecutado.');
  const triggers=db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND tbl_name IN ("+tables.map(()=>'?').join(',')+")").all(...tables);
  for(const t of triggers)db.exec('DROP TRIGGER '+quote(t.name));
  for(const table of tables){counts[table]=db.prepare('SELECT COUNT(*) n FROM '+quote(table)).get().n;db.exec('DELETE FROM '+quote(table));}
  db.exec('UPDATE route_stock SET initial_milli=0,available_milli=0; UPDATE products SET stock_milli=0 WHERE stock_milli IS NOT NULL; UPDATE receipt_counter SET next_number=1 WHERE id=1;');
  db.prepare('UPDATE data_generation SET generation=? WHERE id=1').run(generation);
  for(const t of triggers)db.exec(t.sql);
  if(db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('Relaciones inválidas: reinicio cancelado.');
  db.prepare('INSERT INTO audit VALUES (?,?,?,?,?,?)').run(randomUUID(),null,'operations.reset',generation,JSON.stringify({backup:backupPath,deleted:counts,previous_generation:expectedGeneration}),new Date().toISOString());
  db.exec('COMMIT');return {generation,deleted:counts,backup:backupPath};
 }catch(e){db.exec('ROLLBACK');throw e;}finally{db.exec('PRAGMA foreign_keys=ON');}
}
export async function backedUpReset(db,backupPath,expectedGeneration){
 mkdirSync(dirname(resolve(backupPath)),{recursive:true});
 if(existsSync(backupPath))throw new Error('El respaldo ya existe; no se sobrescribe.');
 // Run only in maintenance mode with all service writers stopped.
 await backup(db,backupPath);chmodSync(backupPath,0o600);
 const copy=new DatabaseSync(backupPath,{readOnly:true});
 try{if(copy.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('Respaldo inválido.');}finally{copy.close();}
 return resetOperations(db,{backupPath,expectedGeneration});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const {openDatabase}=await import('./db.js');
 const dbPath=process.env.DATABASE_PATH;
 if(!dbPath||!existsSync(dbPath))throw new Error('Define DATABASE_PATH de una base existente.');
 const db=openDatabase(dbPath);
 try{
  const generation=dataGeneration(db);
  if(process.argv[2]!=='--execute')console.log(JSON.stringify({generation,instructions:'Con el servicio detenido, ejecutar --execute <generation>. Conserva catálogos; borra movimientos e inventarios.',counts:Object.fromEntries(tables.map(t=>[t,db.prepare('SELECT COUNT(*) n FROM '+quote(t)).get().n]))}));
  else{
   if(process.argv[3]!==generation)throw new Error('La generación debe coincidir exactamente con la revisión.');
   const path=resolve(process.env.BACKUP_DIR||dirname(dbPath)+'/backups','before-reset-'+new Date().toISOString().replaceAll(':','-')+'.sqlite');
   console.log(JSON.stringify(await backedUpReset(db,path,generation)));
  }
 }finally{db.close();}
}
