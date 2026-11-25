import express from 'express';
import sharp from 'sharp';
import {mkdirSync,mkdtempSync,writeFileSync,unlinkSync,statSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {z} from 'zod';
import {id,now,transaction,audit} from './db.js';
import {digest} from './auth.js';
import {fail,sessionFor} from './service.js';
const roots=new WeakMap();
function root(db){if(!roots.has(db)){const path=db.prepare('PRAGMA database_list').get().file;roots.set(db,process.env.EXPENSE_FILES_DIR?resolve(process.env.EXPENSE_FILES_DIR):path?join(dirname(path),'expense-evidence'):mkdtempSync(join(tmpdir(),'pos-evidence-')));}const value=roots.get(db);mkdirSync(value,{recursive:true,mode:0o700});return value;}
export function linkEvidence(db,user,expenseId,evidenceId,sessionId){if(!evidenceId)fail(400,'La fotografía del gasto es obligatoria.');const e=db.prepare('SELECT * FROM expense_evidence WHERE id=?').get(evidenceId);if(!e||e.actor_id!==user.id||e.session_id!==sessionId)fail(403,'La evidencia no pertenece a esta caja y usuario.');try{if(!statSync(join(root(db),e.storage_key)).isFile()||!statSync(join(root(db),e.thumbnail_key)).isFile())throw new Error();}catch{fail(409,'La fotografía no está disponible. Vuelve a cargarla antes de guardar el gasto.');}if(db.prepare('SELECT 1 FROM expense_evidence_links WHERE evidence_id=?').get(e.id))fail(409,'Esta evidencia ya está asociada a otro gasto.');db.prepare('INSERT INTO expense_evidence_links VALUES(?,?)').run(expenseId,e.id);}
export function mountEvidence(app,db){
 app.post('/api/expenses/evidence',express.raw({type:['image/jpeg','image/png','image/webp'],limit:'5mb',inflate:false}),async(req,res)=>{
 const input=z.object({session_id:z.string().uuid(),request_key:z.string().uuid()}).parse(req.query),s=sessionFor(db,req.user,input.session_id);if(s.opened_by!==req.user.id||s.state!=='open')fail(403,'Adjunta evidencia a tu propia caja abierta.');
 if(!Buffer.isBuffer(req.body)||!req.body.length)fail(400,'Adjunta una imagen JPEG, PNG o WebP de máximo 5 MB.');
 const hash=digest(req.body),old=db.prepare('SELECT id,content_hash FROM expense_evidence WHERE actor_id=? AND request_key=?').get(req.user.id,input.request_key);if(old){if(old.content_hash!==hash)fail(409,'La referencia corresponde a otra imagen.');return res.json({id:old.id});}
 if(db.prepare("SELECT COUNT(*) n FROM expense_evidence WHERE actor_id=? AND created_at>?").get(req.user.id,new Date(Date.now()-900000).toISOString()).n>=30)fail(429,'Espera unos minutos antes de cargar más fotografías.');
 let image,thumb;try{const source=sharp(req.body,{limitInputPixels:20000000,failOn:'warning'}),meta=await source.metadata();if(!['jpeg','png','webp'].includes(meta.format)||(meta.pages||1)!==1)fail(400,'Formato de imagen no admitido.');image=await source.rotate().resize(1600,1600,{fit:'inside',withoutEnlargement:true}).jpeg({quality:85}).toBuffer();thumb=await sharp(image).resize(320,320,{fit:'inside',withoutEnlargement:true}).jpeg({quality:75}).toBuffer();}catch(e){if(e.status)throw e;fail(400,'La imagen no es válida o supera el tamaño permitido.');}
 const key=id(),full=key+'.jpg',mini=key+'-thumb.jpg',dir=root(db);writeFileSync(join(dir,full),image,{mode:0o600,flag:'wx'});writeFileSync(join(dir,mini),thumb,{mode:0o600,flag:'wx'});
 try{const result=transaction(db,()=>{const prior=db.prepare('SELECT id,content_hash FROM expense_evidence WHERE actor_id=? AND request_key=?').get(req.user.id,input.request_key);if(prior){if(prior.content_hash!==hash)fail(409,'Referencia usada en otra imagen.');return prior.id;}const current=sessionFor(db,req.user,input.session_id);if(current.state!=='open')fail(409,'La caja se cerró durante la carga.');db.prepare('INSERT INTO expense_evidence VALUES(?,?,?,?,?,?,?,?,?,?)').run(key,req.user.id,s.id,now(),full,mini,image.length,hash,input.request_key,'image/jpeg');audit(db,req.user.id,'expense.evidence.upload',key,{session_id:s.id,bytes:image.length});return key;});if(result!==key){unlinkSync(join(dir,full));unlinkSync(join(dir,mini));}res.json({id:result});}catch(e){unlinkSync(join(dir,full));unlinkSync(join(dir,mini));throw e;}
 });
 app.get('/api/expenses/evidence/:id/:size',(req,res)=>{const row=db.prepare('SELECT * FROM expense_evidence WHERE id=?').get(req.params.id);if(!row)fail(404,'Evidencia no encontrada.');if(req.user.role!=='admin'&&row.actor_id!==req.user.id)fail(403,'No puedes consultar una evidencia ajena.');if(!['thumbnail','image'].includes(req.params.size))fail(404,'Formato no encontrado.');res.set('Content-Type','image/jpeg').set('X-Content-Type-Options','nosniff').sendFile(join(root(db),req.params.size==='thumbnail'?row.thumbnail_key:row.storage_key));});
}
