import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,transaction} from '../src/db.js';
import {reserveReceipts,claimReceipt,publicNumber} from '../src/receipt-numbers.js';
import {saleNumber} from '../../mobile/src/printing/number.js';
import {ticketLines} from '../../mobile/src/printing/receipt.js';
test('Serie global: reservas disjuntas, ventas online, duplicados, aislamiento y rollback',()=>{
 const db=openDatabase(':memory:');
 try{
  for(const id of ['a','b'])db.prepare('INSERT INTO sync_devices(id,name,created_at) VALUES (?,?,?)').run(id,id,new Date().toISOString());
  const a=transaction(db,()=>reserveReceipts(db,'a')),b=transaction(db,()=>reserveReceipts(db,'b'));
  assert.deepEqual(a,[{start_number:1,end_number:100}]);assert.equal(b[0].start_number,101);
  assert.deepEqual(transaction(db,()=>reserveReceipts(db,'a')),a);
  assert.equal(transaction(db,()=>claimReceipt(db,'online')),'P-201');
  assert.equal(transaction(db,()=>claimReceipt(db,'offline','a',1)),'P-01');
  assert.throws(()=>transaction(db,()=>claimReceipt(db,'duplicate','a',1)),/utilizado/);
  assert.throws(()=>transaction(db,()=>claimReceipt(db,'stolen','b',2)),/no reservado/);
  assert.throws(()=>transaction(db,()=>{claimReceipt(db,'rolled-back');throw new Error('Rollback');}),/Rollback/);
  assert.equal(transaction(db,()=>claimReceipt(db,'next')),'P-202');
  assert.equal(publicNumber(1001),'P-1001');
 }finally{db.close();}
});
test('Ticket: no expone UUID, conserva P-01, formato compacto y columnas de 58 mm',()=>{
 const sale={id:'internal-sale-id',number:9,created_at:'2026-11-10T18:00:00Z',total_cents:400000,snapshot:{business_name:"DISTRIBUIDORA & SALSAMENTARIA DANNY'S",receipt_number:'P-01',ticket_number:'internal-device-id/3',seller_name:'Ana',customer_name:'Mariana'},items:[{name:'Muslo de pollo',unit:'kg',quantity_milli:500,price_cents:800000,subtotal_cents:400000}],payments:[{method:'electronic',platform_name:'Nequi'}]};
 const text=ticketLines(sale).join('\n');
 assert.ok(text.includes('Dok Pollo MC'));assert.ok(text.includes('P-01'));assert.ok(text.includes('0,5 KG x $ 8.000'));
 assert.ok(!text.includes('internal-'));assert.ok(!text.includes('ID venta'));assert.ok(!text.includes('DANNY'));
 assert.ok(ticketLines(sale).every(l=>l.length<=32));
 assert.equal(saleNumber({...sale,snapshot:{ticket_number:'legacy-device-id/42'}}),'P-09');
});
