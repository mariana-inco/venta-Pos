import {audit,transaction} from './db.js';
import {digest} from './auth.js';
import {sessionFor,totals,closeSession,closureDetail,fail} from './service.js';

/** Internal administrative workflow; ordinary HTTP/device closures keep their origin-device check. */
export function closeReviewedSessions(db,actorId,review,confirmation){
 const actor=db.prepare('SELECT id,name,role,active FROM users WHERE id=?').get(actorId);
 if(!actor?.active||actor.role!=='admin')fail(403,'Solo un administrador activo puede realizar este cierre.');
 if(confirmation?.devices_synced!==true||confirmation?.amounts!=='recorded'||typeof confirmation.reason!=='string'||!confirmation.reason.trim()||!/^[0-9a-f-]{36}$/i.test(confirmation.request_key||''))fail(400,'Indica la confirmación de sincronización, el motivo y una referencia de cierre.');
 if(!Array.isArray(review)||!review.length||review.length>100||new Set(review.map(r=>r.id)).size!==review.length)fail(400,'Revisa la lista de cajas a cerrar.');
 const fingerprint=digest(JSON.stringify({review,reason:confirmation.reason,devices_synced:true,amounts:'recorded'}));
 return transaction(db,()=>{
  const previous=db.prepare("SELECT actor_id,detail FROM audit WHERE action='cash.admin_close_batch' AND entity_id=?").get(confirmation.request_key);
  if(previous){const saved=JSON.parse(previous.detail);if(previous.actor_id!==actor.id||saved.fingerprint!==fingerprint)fail(409,'La referencia ya fue usada para otro cierre.');return saved.closure_ids.map(id=>closureDetail(db,id));}
  // Check the complete review before touching any session; a changed amount aborts the entire batch.
  for(const r of review){
   const s=sessionFor(db,actor,r.id),t=totals(db,r.id);
   if(s.state!=='open'||r.sale_count!==t.sale_count||r.expected_cash_cents!==s.opening_cents+t.cash_cents||r.electronic_cents!==t.electronic_cents)fail(409,'Una caja cambió desde la revisión. Consulta los saldos nuevamente antes de cerrar.');
  }
  const closures=review.map(r=>closeSession(db,actor,r.id,{reviewed_sale_count:r.sale_count,declared_cash:(r.expected_cash_cents/100).toFixed(2),declared_electronic:(r.electronic_cents/100).toFixed(2),notes:confirmation.reason},null,confirmation));
  audit(db,actor.id,'cash.admin_close_batch',confirmation.request_key,{fingerprint,closure_ids:closures.map(c=>c.id),session_ids:review.map(r=>r.id),devices_synced_confirmed:true,physical_count_reported:false,reason:confirmation.reason});
  return closures;
 });
}
