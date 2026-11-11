import express from 'express';
import {chromium,expect} from '@playwright/test';
import {randomBytes,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {openDatabase} from '../server/src/db.js';
import {createApp} from '../server/src/app.js';
import {createUser,login} from '../server/src/auth.js';
const root=fileURLToPath(new URL('../',import.meta.url)),dir=mkdtempSync(join(root,'tmp','business-e2e-')),db=openDatabase(join(dir,'test.sqlite')),password=randomBytes(24).toString('hex');
const admin=await createUser(db,{name:'Admin prueba',username:'admin-test',password,role:'admin'}),seller=await createUser(db,{name:'Operador prueba',username:'seller-test',password,role:'seller'});
const app=express(),server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const origin=`http://127.0.0.1:${server.address().port}`;process.env.CORS_ORIGINS=origin;app.use(express.static(join(dir,'web')));app.use(createApp(db));
const token=(await login(db,admin.username,password)).token;
async function call(path,body,method=body?'POST':'GET'){const r=await fetch(origin+'/api'+path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body&&JSON.stringify(body)});if(!r.ok)throw new Error(await r.text());return r.json();}
let browser,page;const shots=join(root,'output','screenshots','business');mkdirSync(shots,{recursive:true});
try{
 const route=await call('/routes',{name:'Ruta 1'});for(const u of [admin,seller])await call(`/users/${u.id}`,{name:u.name,username:u.username,role:u.role,route_id:route.id},'PUT');
 await call('/agents',{user_id:seller.id,name:'Ana'});await call('/agents',{user_id:seller.id,name:'Luis'});await call('/agents',{user_id:admin.id,name:'Vendedor admin'});
 const p=await call('/products',{code:'00001',name:'Pollo',price:'12000',wholesale_price:'10000',unit:'kg'});
 const normal=await call('/customers',{name:'Normal',city:'Bogotá',customer_type:'normal'}),wholesale=await call('/customers',{name:'Mayorista',city:'Bogotá',customer_type:'wholesale'});
 execFileSync('npm',['exec','-w','mobile','--','expo','export','--clear','--platform','web','--output-dir',join(dir,'web')],{cwd:root,env:{...process.env,EXPO_PUBLIC_API_URL:origin},stdio:'pipe'});
 browser=await chromium.launch({headless:true});page=await browser.newPage({viewport:{width:390,height:844},acceptDownloads:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));const id=s=>page.getByTestId(s);
 async function login(user){await page.getByLabel('Usuario',{exact:true}).fill(user);await page.getByLabel('Contraseña',{exact:true}).fill(password);await page.getByRole('button',{name:'Entrar',exact:true}).click();await expect(id('tab-sale')).toBeVisible();}
 async function logout(){await id('profile-button').click();await page.getByTestId('logout').click();await page.getByRole('button',{name:'Cerrar sesión',exact:true}).last().click();await expect(page.getByRole('button',{name:'Entrar',exact:true})).toBeVisible();}
 async function capture(name){for(const width of [320,390,768,1280]){await page.setViewportSize({width,height:844});await page.waitForTimeout(100);expect(await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth)).toBeLessThanOrEqual(1);await page.screenshot({path:join(shots,`${name}-${width}.png`)});}await page.setViewportSize({width:390,height:844});}
 await page.goto(origin);await login('admin-test');
 await page.getByRole('button',{name:'Rutas e inventario',exact:true}).first().click();await expect(page.getByText('Entrega diaria de productos')).toBeVisible();
 await page.getByPlaceholder('Buscar producto por nombre o código').fill('00001');await page.getByRole('button',{name:'Agregar',exact:true}).click();await page.getByLabel('Pollo · KG',{exact:true}).fill('20');await page.getByRole('button',{name:'Confirmar entrega',exact:true}).click();await expect(page.getByText('Disponible: 20 kg')).toBeVisible();await capture('rutas-entrega');
 await id('profile-button').click();await page.getByRole('button',{name:'Usuarios y accesos',exact:true}).click();await expect(page.getByText('@seller-test')).toBeVisible();await logout();
 await login('seller-test');await id('open-cash-home').click();await id('opening-amount').fill('0');await id('open-cash').click();await id('tab-sale').click();
 await expect(id('add-Pollo')).toHaveCount(0);await page.getByRole('button',{name:'Seleccionar',exact:true}).click();await page.getByRole('button',{name:'Ana',exact:true}).click();
 await id('customer-picker').click();await page.getByRole('button',{name:'Normal, Bogotá',exact:true}).click();
 await id('product-search').fill('00001');await expect(id('add-Pollo')).toBeVisible();await id('add-Pollo').click();await expect(id('quantity-input')).toBeVisible();await id('quantity-input').fill('2');await id('quantity-save').click();await expect(id('sale-total')).toContainText('24.000');
 await id('customer-picker').click();await page.getByRole('button',{name:'Mayorista, Bogotá',exact:true}).click();await expect(id('sale-total')).toContainText('20.000');await capture('precio-mayorista');
 await id('checkout').click();await page.getByRole('radio',{name:'Crédito',exact:true}).click();await id('confirm-sale').dblclick();await expect(id('sale-done')).toBeVisible();await expect(id('done-total')).toContainText('20.000');
 expect((await call('/sales')).count).toBe(1);expect((await call('/accounts/'+wholesale.id)).balance_cents).toBe(2000000);
 await page.getByRole('button',{name:'Cuentas por cobrar',exact:true}).first().click();await page.getByRole('button',{name:'Registrar abono',exact:true}).click();await page.getByRole('button',{name:'Seleccionar',exact:true}).click();await page.getByRole('button',{name:/Mayorista ·/}).click();await page.getByLabel('Valor del abono',{exact:true}).fill('5000');await page.getByRole('button',{name:'REGISTRAR ABONO',exact:true}).click();await expect(page.getByText('Saldo pendiente: $ 15.000').first()).toBeVisible();
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Descargar estado de cuenta PDF'}).click();await(await download).saveAs(join(root,'output','estado-cuenta-ejemplo.pdf'));await capture('cartera');
 await id('tab-sale').click();await id('sale-new').click();await page.getByRole('button',{name:'Ana',exact:true}).click();await page.getByRole('button',{name:'Luis',exact:true}).click();await id('customer-picker').click();await page.getByRole('button',{name:'Normal, Bogotá',exact:true}).click();await id('product-search').fill('00001');await expect(id('add-Pollo')).toBeVisible();await page.waitForTimeout(450);await id('product-search').focus();await id('product-search').press('Enter');await expect(id('quantity-input')).toBeVisible();await id('quantity-input').fill('1');await id('quantity-save').click();await id('checkout').click();await page.getByRole('radio',{name:'Nequi',exact:true}).click();await id('confirm-sale').click();await expect(id('sale-done')).toBeVisible();
 await logout();await login('admin-test');await page.getByRole('button',{name:'Resultados y cierres',exact:true}).click();await page.getByRole('button',{name:'Todas las rutas',exact:true}).click();await page.getByRole('button',{name:'Ruta 1',exact:true}).click();await page.getByRole('button',{name:'Consultar resultados',exact:true}).click();await expect(page.getByText('Ana · Operador prueba')).toBeVisible();await expect(page.getByText('Luis · Operador prueba')).toBeVisible();await capture('resultados');await page.getByRole('button',{name:'Cerrar jornada de la ruta'}).click();await expect(page.getByText('Cierre histórico inmutable')).toBeVisible();
 expect(errors).toEqual([]);console.log('E2E negocio: entrega por ruta, usuarios, dos vendedores, escáner teclado, cambio de cliente y precio, crédito, electrónico, abono vendedor, PDF, resultados y cierre; 320/390/768/1280 px verificados.');
}catch(error){if(page){await page.screenshot({path:join(shots,'failure.png')});console.error((await page.locator('body').innerText()).slice(-6000));}throw error;}finally{await browser?.close();await new Promise(r=>server.close(r));db.close();rmSync(dir,{recursive:true,force:true});}
