import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase} from '../src/db.js';
import {createUser,login} from '../src/auth.js';
import {createApp} from '../src/app.js';
import {registerDevice,catalogFor,ingestEvent} from '../src/sync.js';
import {recordSale,closeSession} from '../src/service.js';
import {LocalStore} from '../../mobile/src/offline/store.js';
import {ticketLines,ticketHtml} from '../../mobile/src/printing/receipt.js';

const local=(path=':memory:')=>{
 const db=new DatabaseSync(path);
 return {db,store:new LocalStore({exec:s=>db.exec(s),run:(s,...a)=>db.prepare(s).run(...a),get:(s,...a)=>db.prepare(s).get(...a),all:(s,...a)=>db.prepare(s).all(...a)},randomUUID)};
};
async function fixture(){
 const db=openDatabase(':memory:');
 const seller=await createUser(db,{name:'Vendedora',username:'seller-offline',password:'seller-offline-password',role:'seller'});
 const admin=await createUser(db,{name:'Administrador',username:'admin-offline',password:'admin-offline-password',role:'admin'});
 const product={id:randomUUID(),name:'Queso',price_cents:2400000,unit:'kg',stock_milli:1000};
 db.prepare('INSERT INTO products VALUES (?,?,?,?,?,?,?,?)').run(product.id,product.name,product.price_cents,product.unit,1,product.stock_milli,new Date().toISOString(),new Date().toISOString());
 const prepare=store=>{const grant=registerDevice(db,seller,{device_id:store.deviceId,name:'Prueba'});store.profile(seller);store.applyCatalog(catalogFor(db,seller,store.deviceId));return grant;};
 return {db,seller,admin,product,prepare};
}
function sell(store,user,product,qty='1'){
 const customer=store.request(user,'/customers','POST',{name:'Cliente offline',city:'Bogotá'});
 const session=store.request(user,'/cash-sessions','POST',{opening:'50000'});
 const input={session_id:session.id,customer_id:customer.id,items:[{product_id:product.id,quantity:qty,expected_price_cents:product.price_cents}],method:'cash',platform_id:null,request_key:randomUUID()};
 const sale=store.request(user,'/sales','POST',input);return {sale,input,session};
}
test('Offline real: persistencia SQLite, dos dispositivos, reintentos concurrentes, precio histórico y sobreventa conciliable',async()=>{
 const f=await fixture(),dir=mkdtempSync(join(tmpdir(),'pos-offline-'));let one=local(join(dir,'one.sqlite'));const two=local(join(dir,'two.sqlite'));
 let server;
 try{
  const grants=[f.prepare(one.store),f.prepare(two.store)];
  const first=sell(one.store,f.seller,f.product),second=sell(two.store,f.seller,f.product);
  const receipt=ticketHtml(first.sale,'sale',58);
  assert.notEqual(first.sale.snapshot.ticket_number,second.sale.snapshot.ticket_number);
  assert.equal(one.store.request(f.seller,'/sales','POST',first.input).id,first.sale.id);
  assert.equal(one.store.pending().length,3);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM sales').get().n,0);
  assert.equal(one.store.products(f.seller)[0].stock_milli,0);
  const deviceId=one.store.deviceId;one.db.close();one=local(join(dir,'one.sqlite'));
  assert.equal(one.store.deviceId,deviceId);assert.equal(one.store.pending().length,3);
  assert.equal(ticketHtml(one.store.get('sale',first.sale.id),'sale',58),receipt);
  // The price and active flag can change while both phones remain offline.
  f.db.prepare('UPDATE products SET price_cents=3000000,active=0 WHERE id=?').run(f.product.id);
  server=createApp(f.db).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const url=`http://127.0.0.1:${server.address().port}/api/sync/events`;
  const push=async(store,token)=>{const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({events:store.pending().map(r=>r.event)})});assert.equal(response.status,200);return response.json();};
  const [a,b]=await Promise.all([push(one.store,grants[0].token),push(two.store,grants[1].token)]);
  assert.equal(a.accepted.length,3);assert.equal(b.accepted.length,3);
  // Simulate response lost before acknowledging locally: all operations replay safely.
  const replay=await push(one.store,grants[0].token);assert.deepEqual(replay,a);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM sales').get().n,2);
  assert.equal(f.db.prepare('SELECT SUM(total_cents) total FROM sales').get().total,4800000);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM cash_sessions WHERE state=\'open\'').get().n,2);
  assert.equal(f.db.prepare('SELECT quantity_milli FROM stock_debts').get().quantity_milli,1000);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM sync_issues').get().n,3); // 2 old-price notices + 1 shortage
  for(const ack of a.accepted)one.store.acknowledge(ack.event_id,ack);
  assert.equal(one.store.products(f.seller)[0].stock_milli,0); // don't undo local stock before pulling an acknowledged baseline
  one.store.applyCatalog(catalogFor(f.db,f.seller,one.store.deviceId));
  assert.equal(one.store.pending().length,0);assert.equal(one.store.products({...f.seller,role:'admin'})[0].stock_milli,-1000);
  assert.equal(ticketHtml(one.store.get('sale',first.sale.id),'sale',58),receipt);
  const altered={...one.store.db.get('SELECT payload FROM local_events WHERE id=?',first.sale.id)};
  const event=JSON.parse(altered.payload);event.data.items[0].quantity_milli=500;
  assert.throws(()=>ingestEvent(f.db,f.seller,one.store.deviceId,event),{status:409});
 }finally{if(server)await new Promise(r=>server.close(r));one.db.close();two.db.close();f.db.close();rmSync(dir,{recursive:true,force:true});}
});
test('Caja offline: cierre local ordenado, vendedor sin permiso y rechazo de cierre/venta remotos prematuros',async()=>{
 const f=await fixture(),l=local();
 try{
  f.prepare(l.store);const {sale,session}=sell(l.store,f.seller,f.product,'0.5');
  const close={declared_cash:'62000',declared_electronic:'0',reviewed_sale_count:1,notes:'Cierre sin conexión'};
  assert.throws(()=>l.store.request(f.seller,`/cash-sessions/${session.id}/close`,'POST',close),/administrador/);
  assert.throws(()=>l.store.request(f.admin,`/cash-sessions/${session.id}/close`,'POST',{...close,reviewed_sale_count:0}),/ventas nuevas/);
  const closure=l.store.request(f.admin,`/cash-sessions/${session.id}/close`,'POST',close);
  assert.equal(closure.snapshot.cash_difference_cents,0);
  assert.equal(l.store.session(f.seller,session.id).state,'closed');
  const events=l.store.pending();
  for(const row of events.slice(0,2))ingestEvent(f.db,f.seller,l.store.deviceId,row.event);
  assert.throws(()=>closeSession(f.db,f.admin,session.id,close),/dispositivo de origen/);
  assert.throws(()=>recordSale(f.db,f.seller,{session_id:session.id,request_key:randomUUID()}),/dispositivo de origen/);
  assert.throws(()=>ingestEvent(f.db,f.admin,l.store.deviceId,events[3].event),/operación anterior/);
  ingestEvent(f.db,f.seller,l.store.deviceId,events[2].event);
  const accepted=ingestEvent(f.db,f.admin,l.store.deviceId,events[3].event);
  assert.equal(accepted.id,closure.id);
  const stored=JSON.parse(f.db.prepare('SELECT snapshot FROM closures').get().snapshot);
  assert.equal(stored.sale_count,1);assert.equal(stored.cash_difference_cents,0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM sale_items WHERE sale_id=?').get(sale.id).n,1);
  assert.deepEqual(ingestEvent(f.db,f.admin,l.store.deviceId,events[3].event),accepted);
 }finally{l.db.close();f.db.close();}
});
test('Cola y venta se guardan atómicamente; catálogo viejo no restaura existencias ya vendidas',async()=>{
 const f=await fixture(),l=local();
 try{
  f.prepare(l.store);const customer=l.store.request(f.seller,'/customers','POST',{name:'C',city:'Bogotá'});const session=l.store.request(f.seller,'/cash-sessions','POST',{opening:'0'});
  const input={session_id:session.id,customer_id:customer.id,items:[{product_id:f.product.id,quantity:'0.25'}],method:'cash',platform_id:null,request_key:randomUUID()};
  l.db.exec("CREATE TRIGGER simulated_disk_failure BEFORE INSERT ON local_records WHEN NEW.kind='sale' BEGIN SELECT RAISE(ABORT,'disk failure'); END;");
  assert.throws(()=>l.store.request(f.seller,'/sales','POST',input),/disk failure/);
  assert.equal(l.store.pending().length,2);assert.equal(l.store.meta('sequence'),2);assert.equal(l.store.products(f.seller)[0].stock_milli,1000);
  l.db.exec('DROP TRIGGER simulated_disk_failure');
  l.store.request(f.seller,'/sales','POST',input);assert.equal(l.store.products(f.seller)[0].stock_milli,750);
  l.store.applyCatalog(catalogFor(f.db,f.seller,l.store.deviceId));assert.equal(l.store.products(f.seller)[0].stock_milli,750);
  assert.throws(()=>l.store.request(f.seller,'/sales','POST',{...input,items:[{product_id:f.product.id,quantity:'0.5'}]}),/otra venta/);
  assert.equal(l.store.pending().length,3);
 }finally{l.db.close();f.db.close();}
});
test('Autorización de sincronización: catálogo emitido, permiso de dispositivo y revocación sin pérdida local',async()=>{
 const f=await fixture(),l=local(),other=local();let server;
 try{
  const grant=f.prepare(l.store);f.prepare(other.store);sell(l.store,f.seller,f.product);
  const rows=l.store.pending();for(const row of rows.slice(0,2))ingestEvent(f.db,f.seller,l.store.deviceId,row.event);
  const forged=structuredClone(rows[2].event);forged.data.catalog_version='a'.repeat(64);
  assert.throws(()=>ingestEvent(f.db,f.seller,l.store.deviceId,forged),/catálogo de origen/);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM sales').get().n,0);
  server=createApp(f.db).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}/api`;
  const session=await login(f.db,f.admin.username,'admin-offline-password');
  const revoked=await fetch(`${base}/devices/${l.store.deviceId}/revoke`,{method:'POST',headers:{Authorization:`Bearer ${session.token}`}});assert.equal(revoked.status,200);
  const response=await fetch(base+'/sync/events',{method:'POST',headers:{Authorization:`Bearer ${grant.token}`,'Content-Type':'application/json'},body:JSON.stringify({events:[rows[2].event]})});assert.equal(response.status,401);
  assert.equal(l.store.pending().length,3);assert.equal(l.store.sales(f.seller).length,1);
  assert.equal((await fetch(base+'/sync/catalog',{headers:{Authorization:`Bearer ${session.token}`}})).status,401); // cloud token is not a device grant
 }finally{if(server)await new Promise(r=>server.close(r));l.db.close();other.db.close();f.db.close();}
});
test('Ticket local estable y seguro para HTML/ESC-POS; 58/80 mm y nombre largo',()=>{
 const sale={id:randomUUID(),number:1,created_at:'2026-10-28T15:00:00.000Z',total_cents:3600000,snapshot:{business_name:'DANNY\'S <script>\x1b@',seller_name:'Ana',customer_name:'Ñandú',customer_city:'Bogotá',ticket_number:`${randomUUID()}/1`},items:[{name:'Queso campesino de nombre muy largo',quantity_milli:1500,price_cents:2400000,subtotal_cents:3600000,unit:'kg'}],payments:[{method:'cash'}]};
 for(const width of [58,80]){const lines=ticketLines(sale,'sale',width);assert.ok(lines.every(l=>l.length<=(width===58?32:48)));assert.ok(!lines.join('').includes('\x1b'));const html=ticketHtml(sale,'sale',width);assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));assert.ok(lines.join('\n').includes('36.000'));}
});
