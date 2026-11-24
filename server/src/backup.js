import {dirname,join,resolve} from 'node:path';
import { backup } from 'node:sqlite';
import { mkdirSync,cpSync,existsSync,chmodSync } from 'node:fs';
import { openDatabase, now } from './db.js';
// En hosting con disco montado, BACKUP_DIR debe apuntar al volumen persistente (p. ej. /data/backups).
const dir=process.env.BACKUP_DIR||'./backups';
const db=openDatabase(); mkdirSync(dir,{recursive:true});
const path=`${dir}/pos-${now().replaceAll(':','-')}.sqlite`;
try {await backup(db,path);chmodSync(path,0o600);const evidence=process.env.EXPENSE_FILES_DIR||join(dirname(db.prepare('PRAGMA database_list').get().file),'expense-evidence');if(existsSync(evidence)){cpSync(evidence,path+'.files',{recursive:true});chmodSync(path+'.files',0o700);}console.log(`Copia consistente creada: ${path}`);} finally {db.close();}
