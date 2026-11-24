import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {openDatabase} from '../src/db.js';
import {createUser,login} from '../src/auth.js';
import {createApp} from '../src/app.js';
import {routeUser,stockProduct,prepareRequest} from './business-fixtures.js';
import {customerBalance} from '../src/commerce.js';
import {receiptPdf} from '../src/pdf.js';
import {ticketLines,ticketHtml} from '../../mobile/src/printing/receipt.js';

test('Ticket: deuda anterior más venta/abono, contado con deuda, cero oculto y reimpresión inmutable',async()=>{
 const db=openDatabase(':memory:');
 const user=await createUser(db,{name:'Administrador',username:'ticket-admin',password:'test-password-123',role:'admin'});
 const {routeId,agentId}=routeUser(db,user.id),product=randomUUID(),customer=randomUUID(),session=randomUUID();
 db.prepare('INSERT INTO products VALUES(?,?,?,?,?,?,?,?)').run(product,'Pollo entero',1000000,'kg',1,null,new Date().toISOString(),new Date().toISOString());
 stockProduct(db,routeId,product,100000);
 db.prepare('INSERT INTO customers VALUES(?,?,?,?,?,?)').run(customer,'Cliente prueba','Bogotá',1,new Date().toISOString(),new Date().toISOString());
 db.prepare('INSERT INTO customer_routes(customer_id,route_id) VALUES(?,?)').run(customer,routeId);
 db.prepare('INSERT INTO cash_sessions VALUES(?,?,?,?,?,?,?)').run(session,user.id,new Date().toISOString(),0,'open',null,null);
 const token=(await login(db,'ticket-admin','test-password-123')).token;
 const server=createApp(db).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 async function req(path,body,status=200){body=prepareRequest(db,token,path,body);const r=await fetch(`http://127.0.0.1:${server.address().port}/api${path}`,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body&&JSON.stringify(body)});const value=await r.json();assert.equal(r.status,status,JSON.stringify(value));return value;}
 const input=(method,extra={})=>({customer_id:customer,session_id:session,agent_id:agentId,method,items:[{product_id:product,quantity:'1'}],request_key:randomUUID(),...extra});
 const collect=amount=>req('/collections',{customer_id:customer,session_id:session,amount,method:'cash',note:'Abono de prueba',request_key:randomUUID()});
 try{
  const credit=await req('/sales',input('credit'),201);assert.equal(credit.snapshot.customer_balance_cents,1000000);
  const cash=await req('/sales',input('cash'),201);assert.equal(cash.snapshot.initial_balance_cents,0);assert.equal(cash.snapshot.customer_balance_cents,1000000);
  await collect('5000');assert.equal(customerBalance(db,customer),500000);
  const partialInput=input('credit',{initial_payment:'2000',initial_method:'cash'});
  const partial=await req('/sales',partialInput,201);assert.equal(partial.snapshot.customer_balance_cents,1300000);
  const line=ticketLines(partial).join('\n');assert.match(line,/Total adeudado/);assert.match(line,/13\.000/);assert.doesNotMatch(line,/Saldo al emitir/);
  await collect('13000');assert.equal(customerBalance(db,customer),0);
  const retry=await req('/sales',partialInput,201);assert.equal(retry.snapshot.customer_balance_cents,1300000);
  const paid=await req('/sales',input('cash'),201);assert.equal(paid.snapshot.customer_balance_cents,0);assert.doesNotMatch(ticketLines(paid).join('\n'),/saldo/i);
  assert.equal((await req('/sales/'+credit.id)).snapshot.customer_balance_cents,1000000);
  assert.equal(paid.snapshot.business_whatsapp,'3225268837');
  const html=ticketHtml(paid);assert.match(html,/<svg[^>]+aria-label="WhatsApp"/);assert.match(html,/3225268837/);assert.doesNotMatch(html,/Solo mensajes|Solo WhatsApp|\[\[WHATSAPP/);
  for(const [sale,hasDebt] of [[paid,false],[cash,true],[partial,true]]){
   const pdf=await receiptPdf(sale,58),text=execFileSync('pdftotext',['-','-'],{input:pdf}).toString();
   assert.match(text,/3225268837/);assert.equal(/Total adeudado/.test(text),hasDebt);assert.doesNotMatch(text,/Solo mensajes|Solo WhatsApp|Saldo al emitir/);
   assert.equal((pdf.toString('latin1').match(/\/Type \/Page\b/g)||[]).length,1);
  }
 }finally{await new Promise(r=>server.close(r));db.close();}
});
