// Public receipt series. Call only inside BEGIN IMMEDIATE (including catalog reservations).
export const publicNumber=n=>`P-${String(n).padStart(2,'0')}`;
export function migrateReceiptNumbers(db){
 db.exec(`CREATE TABLE IF NOT EXISTS receipt_counter(id INTEGER PRIMARY KEY CHECK(id=1),next_number INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS receipt_ranges(start_number INTEGER PRIMARY KEY,end_number INTEGER NOT NULL,device_id TEXT NOT NULL REFERENCES sync_devices(id));
 CREATE TABLE IF NOT EXISTS receipt_numbers(number INTEGER PRIMARY KEY,sale_id TEXT NOT NULL UNIQUE,device_id TEXT,created_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS receipt_ranges_device ON receipt_ranges(device_id);`);
 db.prepare('INSERT OR IGNORE INTO receipt_counter SELECT 1,COALESCE(MAX(number),0)+1 FROM sales').run();
}
function take(db,count){
 const n=db.prepare('SELECT next_number n FROM receipt_counter WHERE id=1').get().n;
 if(!Number.isSafeInteger(n+count)||n+count>1_000_000_000)throw new Error('Se agotó la serie de comprobantes.');
 db.prepare('UPDATE receipt_counter SET next_number=next_number+? WHERE id=1').run(count);return n;
}
export function reserveReceipts(db,deviceId){
 const ranges=db.prepare('SELECT start_number,end_number FROM receipt_ranges WHERE device_id=? ORDER BY start_number').all(deviceId).map(r=>({...r}));
 const used=db.prepare('SELECT COALESCE(MAX(number),0) n FROM receipt_numbers WHERE device_id=?').get(deviceId).n;
 const available=ranges.reduce((sum,r)=>sum+Math.max(0,r.end_number-Math.max(used,r.start_number-1)),0);
 if(available<20){const start=take(db,100);db.prepare('INSERT INTO receipt_ranges VALUES (?,?,?)').run(start,start+99,deviceId);ranges.push({start_number:start,end_number:start+99});}
 return ranges;
}
export function claimReceipt(db,saleId,deviceId=null,requested=null){
 let n=requested;
 if(n!==null){
  if(!Number.isSafeInteger(n)||!db.prepare('SELECT 1 FROM receipt_ranges WHERE device_id=? AND ? BETWEEN start_number AND end_number').get(deviceId,n))throw Object.assign(new Error('Consecutivo no reservado para esta terminal.'),{status:409});
 }else n=take(db,1);
 if(db.prepare('SELECT 1 FROM receipt_numbers WHERE number=?').get(n))throw Object.assign(new Error('Este consecutivo ya fue utilizado.'),{status:409});
 db.prepare('INSERT INTO receipt_numbers VALUES (?,?,?,?)').run(n,saleId,deviceId,new Date().toISOString());return publicNumber(n);
}
