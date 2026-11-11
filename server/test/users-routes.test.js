import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../src/db.js';
import {createUser,login} from '../src/auth.js';
import {createApp} from '../src/app.js';

test('Usuarios: alta con ruta atómica, edición, caja abierta y vendedores asociados',async()=>{
 const db=openDatabase(':memory:');
 const admin=await createUser(db,{name:'Admin',username:'admin',password:'test-password-123',role:'admin'});
 const token=(await login(db,'admin','test-password-123')).token;
 const server=createApp(db).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base=`http://127.0.0.1:${server.address().port}/api`;
 async function req(path,body,method=body?'POST':'GET',expected=200,auth=token){
  const r=await fetch(base+path,{method,headers:{Authorization:`Bearer ${auth}`,'Content-Type':'application/json'},body:body&&JSON.stringify(body)});
  const value=await r.json();assert.equal(r.status,expected,JSON.stringify(value));return value;
 }
 try{
  const route=await req('/routes',{name:'Ruta primera'}),other=await req('/routes',{name:'Ruta segunda'});
  const data={name:'Operador',username:'operador',password:'test-password-123',role:'seller',route_id:route.id};
  const user=await req('/users',data,'POST',201);
  assert.equal(user.route_id,route.id);
  assert.equal((await req('/users')).find(u=>u.id===user.id).route_id,route.id);
  assert.equal((await req(`/routes/${route.id}/users`))[0].id,user.id);
  const count=db.prepare('SELECT COUNT(*) n FROM users').get().n;
  await req('/users',{...data,username:'invalido',route_id:randomUUID()},'POST',400);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n,count);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM audit WHERE action='user.create'").get().n,2);
  db.prepare('UPDATE routes SET active=0 WHERE id=?').run(other.id);
  await req('/users',{...data,username:'inactivo',route_id:other.id},'POST',400);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n,count);
  db.prepare('UPDATE routes SET active=1 WHERE id=?').run(other.id);
  await req(`/users/${user.id}`,{...data,route_id:other.id},'PUT');
  assert.equal((await req('/users')).find(u=>u.id===user.id).route_id,other.id);
  await req(`/users/${user.id}`,{...data,username:'admin',route_id:route.id},'PUT',409);
  assert.equal((await req('/users')).find(u=>u.id===user.id).route_id,other.id);
  const sellerToken=(await login(db,'operador','test-password-123')).token;
  await req('/cash-sessions',{opening:'0'},'POST',201,sellerToken);
  await req(`/users/${user.id}`,{...data,name:'Nombre conservado',route_id:other.id},'PUT');
  const error=await req(`/users/${user.id}`,{...data,name:'No guardar',route_id:route.id},'PUT',409);
  assert.match(error.error,/cajas/);
  const saved=(await req('/users')).find(u=>u.id===user.id);
  assert.equal(saved.route_id,other.id);assert.equal(saved.name,'Nombre conservado');
  const agent=await req('/agents',{user_id:user.id,name:'Vendedor de prueba'});
  assert.equal((await req('/agents?user_id='+user.id))[0].id,agent.id);
  await req(`/users/${user.id}`,{...data,route_id:other.id},'PUT',403,sellerToken);
 }finally{await new Promise(r=>server.close(r));db.close();}
});
