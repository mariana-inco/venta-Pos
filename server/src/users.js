import {z} from 'zod';
import {admin} from './auth.js';
import {id,audit,transaction} from './db.js';
import {validate} from './validation.js';
import {assignUserRoute} from './user-route.js';
const uuid=z.string().uuid(),text=z.string().trim().min(1).max(120);
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};

/** Compatible user administration, independent of changes to the sales protocol. */
export function mountUsers(app,db){
 app.put('/api/users/:id',admin,validate(z.object({name:text,username:z.string().trim().regex(/^[a-zA-Z0-9_.-]{3,40}$/),role:z.enum(['admin','seller']),route_id:uuid.nullable()})),(req,res)=>res.json(transaction(db,()=>{
  const d=req.input,u=db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if(!u)fail(404,'Usuario no encontrado.');
  if(u.id===req.user.id&&d.role!=='admin')fail(409,'No puedes quitar tu propio acceso de administrador.');
  assignUserRoute(db,u.id,d.route_id);
  db.prepare('UPDATE users SET name=?,username=?,role=? WHERE id=?').run(d.name,d.username,d.role,u.id);
  audit(db,req.user.id,'user.update',u.id,d);
  return {...d,id:u.id,active:u.active};
 })));
 app.get('/api/agents',(req,res)=>res.json(req.user.role==='admin'&&req.query.user_id?db.prepare('SELECT * FROM sales_agents WHERE user_id=? ORDER BY name').all(String(req.query.user_id)):db.prepare('SELECT * FROM sales_agents WHERE user_id=? AND active=1 ORDER BY name').all(req.user.id)));
 const agent=z.object({user_id:uuid,name:text,active:z.boolean().default(true)});
 const saveAgent=(req,res)=>res.json(transaction(db,()=>{
  const d=req.input;if(!db.prepare('SELECT 1 FROM users WHERE id=? AND active=1').get(d.user_id))fail(400,'Usuario inválido.');
  const key=req.params.id||id(),old=db.prepare('SELECT * FROM sales_agents WHERE id=?').get(key);
  if(req.params.id&&!old)fail(404,'Vendedor no encontrado.');
  if(old&&old.user_id!==d.user_id)fail(409,'Conserva el usuario del vendedor; desactívalo y crea otro.');
  db.prepare('INSERT INTO sales_agents VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,active=excluded.active').run(key,d.user_id,d.name,Number(d.active));
  audit(db,req.user.id,old?'agent.update':'agent.create',key,d);return db.prepare('SELECT * FROM sales_agents WHERE id=?').get(key);
 }));
 app.post('/api/agents',admin,validate(agent),saveAgent);app.put('/api/agents/:id',admin,validate(agent),saveAgent);
 app.get('/api/routes/:id/users',admin,(req,res)=>res.json(db.prepare('SELECT u.id,u.name,u.username FROM users u JOIN seller_routes r ON r.user_id=u.id WHERE r.route_id=? ORDER BY u.name').all(req.params.id)));
}
