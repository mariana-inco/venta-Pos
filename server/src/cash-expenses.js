import {linkEvidence,mountEvidence} from './expense-evidence.js';
import {z} from 'zod';
import {id,now,transaction,audit} from './db.js';
import {sessionFor,totals,fail} from './service.js';
import {routeFor} from './commerce.js';
import {money} from './money.js';
import {digest} from './auth.js';
import {validate} from './validation.js';
export const expenseDetails=(db,sessionId)=>db.prepare('SELECT e.id,e.session_id,e.description,e.amount_cents,e.created_at,e.actor_id,u.name user_name FROM cash_expenses e JOIN users u ON u.id=e.actor_id WHERE e.session_id=? ORDER BY e.rowid').all(sessionId);
export const collectionDetails=(db,sessionId)=>db.prepare(`SELECT c.id,c.customer_id,cu.name customer_name,c.seller_id,u.name user_name,c.amount_cents,c.method,c.created_at,c.note,pr.reference FROM collections c JOIN customers cu ON cu.id=c.customer_id JOIN users u ON u.id=c.seller_id LEFT JOIN payment_references pr ON pr.collection_id=c.id WHERE c.session_id=? AND NOT EXISTS(SELECT 1 FROM collection_reversals r WHERE r.collection_id=c.id) ORDER BY c.rowid`).all(sessionId);
export function createExpense(db,user,input){return transaction(db,()=>{
 const hash=digest(JSON.stringify(input));
 const old=db.prepare('SELECT * FROM cash_expenses WHERE actor_id=? AND request_key=?').get(user.id,input.request_key);
 if(old){if(old.request_hash!==hash)fail(409,'La referencia ya corresponde a otro gasto.');return old;}
 const session=sessionFor(db,user,input.session_id);
 if(session.opened_by!==user.id)fail(403,'Solo puedes registrar gastos en tu propia caja.');
 if(session.state!=='open')fail(409,'La caja está cerrada. No puedes agregar gastos.');
 const amount=money(input.amount);if(amount<=0)fail(400,'El gasto debe ser mayor que cero.');
 const t=totals(db,session.id),available=session.opening_cents+t.cash_cents-t.expense_cents;
 if(amount>available)fail(409,'El gasto supera el efectivo disponible en la caja.');
 if(!input.evidence_id)fail(400,'Adjunta y carga la fotografía obligatoria del gasto antes de guardarlo.');
 const key=id(),at=now();
 db.prepare('INSERT INTO cash_expenses VALUES (?,?,?,?,?,?,?,?,?)').run(key,session.id,user.id,routeFor(db,user)?.id||null,input.description,amount,at,input.request_key,hash);
 linkEvidence(db,user,key,input.evidence_id,session.id);
 audit(db,user.id,'cash.expense',key,{session_id:session.id,description:input.description,amount_cents:amount});return db.prepare('SELECT * FROM cash_expenses WHERE id=?').get(key);
 });}
export function mountExpenses(app,db){
 mountEvidence(app,db);
 app.get('/api/expenses',(req,res)=>{
 const f=z.object({session_id:z.string().uuid().optional(),from:z.iso.date().optional(),to:z.iso.date().optional(),page:z.coerce.number().int().min(1).default(1)}).parse(req.query),today=new Date(Date.now()-18000000).toISOString().slice(0,10),from=f.from||today,to=f.to||today;if(from>to)fail(400,'Revisa las fechas.');
 const where=["date(e.created_at,'-5 hours') BETWEEN ? AND ?"],args=[from,to];if(req.user.role!=='admin'){where.push('e.actor_id=?');args.push(req.user.id);}if(f.session_id){sessionFor(db,req.user,f.session_id);where.push('e.session_id=?');args.push(f.session_id);}
 const filter=where.join(' AND '),count=db.prepare('SELECT COUNT(*) n FROM cash_expenses e WHERE '+filter).get(...args).n,expenses=db.prepare('SELECT e.id,e.session_id,e.description,e.amount_cents,e.created_at,u.name user_name,l.evidence_id FROM cash_expenses e JOIN users u ON u.id=e.actor_id LEFT JOIN expense_evidence_links l ON l.expense_id=e.id WHERE '+filter+' ORDER BY e.created_at DESC,e.id LIMIT 30 OFFSET ?').all(...args,(f.page-1)*30);res.json({expenses,count,page:f.page});
 });
 app.get('/api/cash-sessions/:id/expenses',(req,res)=>{const s=sessionFor(db,req.user,req.params.id);const expenses=expenseDetails(db,s.id),t=totals(db,s.id);res.json({session_id:s.id,state:s.state,expenses,total_cents:t.expense_cents,available_cash_cents:s.opening_cents+t.cash_cents-t.expense_cents});});
 app.post('/api/expenses',validate(z.object({evidence_id:z.string().uuid().optional(),session_id:z.string().uuid(),description:z.string().trim().min(1).max(240),amount:z.string().regex(/^\d{1,10}([.,]\d{1,2})?$/),request_key:z.string().uuid()}).strict()),(req,res)=>res.status(201).json(createExpense(db,req.user,req.input)));
}
