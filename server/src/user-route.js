/** Must run inside the caller's transaction so profile and route commit together. */
export function assignUserRoute(db,userId,routeId){
 const current=db.prepare('SELECT route_id FROM seller_routes WHERE user_id=?').get(userId)?.route_id||null;
 if(current===routeId)return;
 if(routeId&&!db.prepare('SELECT 1 FROM routes WHERE id=? AND active=1').get(routeId))throw Object.assign(new Error('Selecciona una ruta activa.'),{status:400});
 if(db.prepare("SELECT 1 FROM cash_sessions WHERE opened_by=? AND state='open'").get(userId))throw Object.assign(new Error('Cierra y sincroniza todas las cajas de este usuario antes de cambiar su ruta.'),{status:409});
 db.prepare('DELETE FROM seller_routes WHERE user_id=?').run(userId);
 if(routeId)db.prepare('INSERT INTO seller_routes VALUES (?,?)').run(userId,routeId);
}
