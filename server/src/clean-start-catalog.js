import {randomUUID} from 'node:crypto';
// One-time maintenance after the operational reset. Never exposed through HTTP.
export function cleanStartCatalog(db,{adminId,sellerId,expectedGeneration}){
 db.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE');
 try{
  const admin=db.prepare('SELECT * FROM users WHERE id=? AND role=?').get(adminId,'admin');
  const seller=db.prepare('SELECT * FROM users WHERE id=? AND role=?').get(sellerId,'seller');
  if(!admin||!seller||adminId===sellerId)throw new Error('Se requieren el administrador principal y el vendedor verificados.');
  if(db.prepare('SELECT generation FROM data_generation WHERE id=1').get().generation!==expectedGeneration)throw new Error('La generación cambió: no repetir la limpieza.');
  for(const table of ['sales','cash_sessions','payments','collections','closures','daily_closures','delivery_batches','sale_drafts','sync_events','stock_movements'])if(db.prepare('SELECT COUNT(*) n FROM '+table).get().n)throw new Error('Hay movimientos nuevos: limpieza cancelada.');
  if(db.prepare('SELECT 1 FROM route_stock WHERE available_milli<>0 OR initial_milli<>0').get())throw new Error('El inventario no está vacío.');
  const removed=db.prepare('SELECT id,username,name FROM users WHERE id NOT IN (?,?)').all(adminId,sellerId);
  const products=db.prepare('SELECT COUNT(*) n FROM products').get().n;
  const trigger=db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='audit_no_UPDATE'").get();
  if(trigger)db.exec('DROP TRIGGER audit_no_UPDATE');
  for(const user of removed){
   db.prepare("UPDATE audit SET actor_id=NULL,detail=json_set(detail,'$.removed_actor_name',?,'$.removed_actor_username',?) WHERE actor_id=?").run(user.name,user.username,user.id);
   db.prepare('DELETE FROM seller_routes WHERE user_id=?').run(user.id);
   db.prepare('DELETE FROM sales_agents WHERE user_id=?').run(user.id);
  }
  db.exec('DELETE FROM auth_sessions; DELETE FROM device_access; DELETE FROM product_codes; DELETE FROM product_pricing; DELETE FROM product_groups; DELETE FROM stock_debts; DELETE FROM products;');
  db.prepare('DELETE FROM users WHERE id NOT IN (?,?)').run(adminId,sellerId);
  db.prepare('UPDATE users SET active=1 WHERE id IN (?,?)').run(adminId,sellerId);
  const generation=randomUUID();db.prepare('UPDATE data_generation SET generation=? WHERE id=1').run(generation);
  if(trigger)db.exec(trigger.sql);
  db.prepare('INSERT INTO audit VALUES(?,?,?,?,?,?)').run(randomUUID(),adminId,'operations.catalog_reset',generation,JSON.stringify({removed_users:removed,removed_products:products}),new Date().toISOString());
  if(db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('Relaciones inválidas.');
  db.exec('COMMIT');return {removed_products:products,removed_users:removed.map(u=>u.username),kept_users:[admin.username,seller.username],generation};
 }catch(error){db.exec('ROLLBACK');throw error;}
}
