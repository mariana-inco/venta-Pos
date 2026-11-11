import React,{useEffect,useRef,useState} from 'react';
import {Text,View} from 'react-native';
import * as Crypto from 'expo-crypto';
import {api,readPending,savePending,ApiError} from './api';
import {Banner,Button,Card,Choice,Sheet,Field,Header,Page,SearchBar,styles,cop,quantityLabel,moneyToCents,normalizeMoney,saleNumber} from './ui';
import type {User,Product,Customer,CashSession} from './types';
import type {Run} from '../App';
type Route={id:string;name:string};
type Group={id:string;name:string;unit:'kg'|'unit';products:string[]};
type Stock={group_id:string;name:string;unit:'kg'|'unit';initial_milli:number;available_milli:number;sold_milli:number};
type Collection={id:string;amount_cents:number;method:string;note:string;created_at:string;seller_name:string;route_name?:string;customer_name?:string;reversed_at?:string};
type Invoice={id:string;number:number;total_cents:number;balance_cents:number;state:string;created_at:string};
type Account={balance_cents:number;invoices:Invoice[];collections:Collection[]};
export function OperationsScreen({user,products,customers,session,run,busy,refresh}:{user:User;products:Product[];customers:Customer[];session?:CashSession;run:Run;busy:boolean;refresh:()=>Promise<void>}){
 const admin=user.role==='admin';
 const [tab,setTab]=useState('accounts'),[routes,setRoutes]=useState<Route[]>([]),[route,setRoute]=useState(''),[users,setUsers]=useState<User[]>([]),[groups,setGroups]=useState<Group[]>([]);
 const [inventory,setInventory]=useState<{stock:Stock[];movements:any[];consumption?:{product_id:string;group_id:string;name:string;unit:string;quantity_milli:number}[]}>({stock:[],movements:[]});
 const [group,setGroup]=useState(''),[product,setProduct]=useState(''),[seller,setSeller]=useState(''),[routeName,setRouteName]=useState(''),[groupName,setGroupName]=useState(''),[unit,setUnit]=useState('kg');
 const [qty,setQty]=useState(''),[kind,setKind]=useState('assign'),[note,setNote]=useState(''),[query,setQuery]=useState(''),[customer,setCustomer]=useState(''),[identification,setIdentification]=useState('');
 const [account,setAccount]=useState<Account|null>(null),[amount,setAmount]=useState(''),[method,setMethod]=useState('cash'),[invoice,setInvoice]=useState(''),[pending,setPending]=useState<Record<string,unknown>|null>(null);
 const [history,setHistory]=useState<Collection[]>([]),[from,setFrom]=useState(''),[to,setTo]=useState(''),[filterMethod,setFilterMethod]=useState(''),[filterSeller,setFilterSeller]=useState('');
 const [action,setAction]=useState<{path:string;title:string}|null>(null),[reason,setReason]=useState('');const lock=useRef(false);
 async function load(){const [r,g]=await Promise.all([api<Route[]>('/routes'),api<Group[]>('/inventory-groups')]);setRoutes(r);setGroups(g);if(!route&&r.length)setRoute(r[0].id);if(admin)setUsers(await api<User[]>('/users'));setPending(await readPending(user.id+'-collection'));}
 async function loadStock(){if(route)setInventory(await api(`/inventory?route_id=${route}`));}
 async function loadAccount(id=customer){if(id)setAccount(await api(`/accounts/${id}`));}
 useEffect(()=>{run(load);},[]);
 useEffect(()=>{if(route)run(loadStock);},[route]);
 useEffect(()=>{setAccount(null);setInvoice('');if(customer)run(()=>loadAccount(customer));},[customer]);
 async function mutate(path:string,body:unknown,verb='POST'){await api(path,verb,body);await load();await loadStock();await refresh();}
 async function collect(){if(lock.current)return;lock.current=true;try{
  const cents=moneyToCents(amount);if(!pending&&(!cents||!session||!account||cents>account.balance_cents))throw new Error('Revisa el abono, el saldo y tu caja.');
  const body=pending||{customer_id:customer,session_id:session!.id,amount:normalizeMoney(amount),method,note,request_key:Crypto.randomUUID(),...(invoice?{allocations:[{sale_id:invoice,amount:normalizeMoney(amount)}]}:{})};
  await savePending(user.id+'-collection',body);setPending(body);
  try{await api('/collections','POST',body);}catch(e){if(e instanceof ApiError&&[400,404,409].includes(e.status)){await savePending(user.id+'-collection',null);setPending(null);}throw e;}
  await savePending(user.id+'-collection',null);setPending(null);setAmount('');setNote('');await loadAccount(String(body.customer_id));await refresh();
 }finally{lock.current=false;}}
 async function loadHistory(){const q=new URLSearchParams();if(from)q.set('from',from);if(to)q.set('to',to);if(filterMethod)q.set('method',filterMethod);if(filterSeller)q.set('seller_id',filterSeller);if(admin&&route)q.set('route_id',route);if(customer)q.set('customer_id',customer);setHistory(await api('/collections?'+q));}
 const selected=inventory.stock.find(s=>s.group_id===group);
 const matches=customers.filter(c=>!query||`${c.name} ${c.city} ${(c as any).identification||''}`.toLowerCase().includes(query.toLowerCase()));
 return <Page onRefresh={()=>run(async()=>{await load();await loadStock();await loadAccount();})}>
  <Header title="Rutas y abonos" subtitle="Inventario y cartera conectados al servidor"/>
  <Choice items={[{id:'accounts',name:'ABONOS'},{id:'stock',name:'Inventario'},...(admin?[{id:'setup',name:'Configurar'}]:[]),{id:'history',name:'Recaudos'}]} value={tab} onChange={setTab}/>
  {tab!=='accounts'&&<Choice items={routes} value={route} onChange={setRoute}/>}
  {tab==='setup'&&admin&&<>
   <Card><Text style={styles.h2}>Rutas</Text><Field label="Nombre de ruta" value={routeName} onChange={setRouteName}/><Button title="Crear ruta" disabled={busy||!routeName.trim()} onPress={()=>run(async()=>{await mutate('/routes',{name:routeName});setRouteName('');})}/>
    <Text style={styles.label}>Usuario asignado</Text><Choice items={users} value={seller} onChange={setSeller}/><Button title="Asignar usuario a la ruta" disabled={busy||!route||!seller} onPress={()=>run(()=>mutate(`/routes/${route}/sellers/${seller}`,{},'PUT'))}/><Text style={styles.hint}>Cierra y sincroniza las cajas antes de asignar o cambiar una ruta.</Text>
    <Text style={styles.label}>Cliente de la ruta</Text><Choice items={customers} value={customer} onChange={setCustomer}/><Field label="Identificación del cliente" value={identification} onChange={setIdentification}/><Button title="Asociar cliente" disabled={busy||!route||!customer} onPress={()=>run(()=>mutate(`/routes/${route}/customers/${customer}`,{identification},'PUT'))}/>
   </Card>
   <Card><Text style={styles.h2}>Inventarios compartidos</Text><Field label="Nombre del inventario principal" value={groupName} onChange={setGroupName}/><Choice items={[{id:'kg',name:'KG'},{id:'unit',name:'UND'}]} value={unit} onChange={setUnit}/><Button title="Crear inventario" disabled={busy||!groupName.trim()} onPress={()=>run(async()=>{await mutate('/inventory-groups',{name:groupName,unit});setGroupName('');})}/>
    <Text style={styles.label}>Grupo</Text><Choice items={groups} value={group} onChange={setGroup}/><Text style={styles.label}>Producto</Text><Choice items={products} value={product} onChange={setProduct}/><Button title="Asociar producto al grupo" disabled={busy||!group||!product} onPress={()=>run(()=>mutate(`/products/${product}/group`,{group_id:group},'PUT'))}/>
    {groups.map(g=><Text key={g.id} style={styles.small}>{g.name} ({g.unit==='kg'?'KG':'UND'}): {products.filter(p=>g.products.includes(p.id)).map(p=>p.name).join(', ')||'Sin productos'}</Text>)}
   </Card>
  </>}
  {tab==='stock'&&<>
   {inventory.stock.map(s=><Card key={s.group_id}><Text style={styles.h2}>{s.name}</Text><Text>Inicial: {quantityLabel(s.initial_milli,s.unit)}</Text><Text>Vendido neto: {quantityLabel(s.sold_milli,s.unit)}</Text><Text style={styles.h2}>Disponible: {quantityLabel(s.available_milli,s.unit)}</Text></Card>)}
   {!inventory.stock.length&&<Text style={styles.muted}>No hay inventario asignado a esta ruta.</Text>}
   {admin&&<Card><Text style={styles.h2}>Asignación o ajuste autorizado</Text><Choice items={groups} value={group} onChange={setGroup}/><Choice items={[{id:'assign',name:'Agregar carga'},{id:'adjust',name:'Fijar disponible'}]} value={kind} onChange={setKind}/><Field label="Cantidad en KG o UND del grupo" kind="decimal" value={qty} onChange={setQty}/><Field label="Motivo obligatorio" value={note} onChange={setNote}/><Button title="Registrar movimiento" disabled={busy||!route||!group||!qty||!note.trim()} onPress={()=>run(async()=>{await mutate('/inventory',{route_id:route,group_id:group,quantity:qty,kind,note,expected_available_milli:selected?.available_milli||0});setQty('');setNote('');})}/></Card>}
   <Text style={styles.h2}>Consumo neto por producto</Text>{inventory.consumption?.map(c=><Text key={c.group_id+c.product_id}>{c.name}: {quantityLabel(c.quantity_milli,c.unit)}</Text>)}<Text style={styles.h2}>Movimientos</Text>{inventory.movements.map(m=><Card key={m.id}><Text>{m.group_name} · {m.product_name||m.kind}</Text><Text>{m.quantity_milli/1000} · {m.actor_name} · {new Date(m.created_at).toLocaleString('es-CO')}</Text><Text style={styles.small}>{m.note}</Text></Card>)}
  </>}
  {tab==='accounts'&&<>
   {pending?<Card><Banner text="Hay un abono pendiente de confirmar. Reintenta con la misma referencia para evitar duplicados."/><Text>{String(pending.request_key)}</Text><Button title="Reintentar abono" disabled={busy} onPress={()=>run(collect)}/></Card>:<>
    <SearchBar value={query} onChange={setQuery} placeholder="Buscar cliente por nombre o identificación"/><Choice items={matches} value={customer} onChange={setCustomer}/>
    {account&&<><Card><Text style={styles.h2}>Saldo pendiente: {cop(account.balance_cents)}</Text>{account.invoices.map(s=><View key={s.id} style={{gap:6}}><Text>Factura {saleNumber(s)} · {s.state}</Text><Text>Total: {cop(s.total_cents)} · Saldo: {cop(s.balance_cents)}</Text>{admin&&s.state!=='ANULADA'&&<Button title="Anular factura" variant="ghost" disabled={busy} onPress={()=>{setReason('');setAction({path:`/sales/${s.id}/void`,title:`Anular factura ${saleNumber(s)}`});}}/>}</View>)}</Card>
     <Card><Text style={styles.h2}>REGISTRAR ABONO</Text><Choice items={[{id:'',name:'Distribuir entre facturas más antiguas'},...account.invoices.filter(s=>s.balance_cents>0).map(s=>({id:s.id,name:`Factura ${saleNumber(s)} · ${cop(s.balance_cents)}`}))]} value={invoice} onChange={setInvoice}/><Field label="Valor del abono" kind="decimal" value={amount} onChange={setAmount}/><Choice items={[{id:'cash',name:'Efectivo'},{id:'electronic',name:'Transferencia / electrónico'}]} value={method} onChange={setMethod}/><Field label="Observaciones (opcional)" value={note} onChange={setNote}/>{!session&&<Text style={styles.fieldError}>Abre tu caja para registrar el recaudo.</Text>}<Button title="REGISTRAR ABONO" disabled={busy||!session||!amount||account.balance_cents===0} onPress={()=>run(collect,'Abono registrado')}/></Card>
     <Text style={styles.h2}>Abonos anteriores</Text>{account.collections.map(c=><Card key={c.id}><Text>{cop(c.amount_cents)} · {c.method==='cash'?'Efectivo':'Electrónico'} {c.reversed_at?'· REVERTIDO':''}</Text><Text>{c.seller_name} · {new Date(c.created_at).toLocaleString('es-CO')}</Text><Text>{c.note}</Text>{admin&&!c.reversed_at&&<Button title="Revertir abono" variant="ghost" onPress={()=>{setReason('');setAction({path:`/collections/${c.id}/reverse`,title:'Revertir abono'});}}/>}</Card>)}</>}
   </>}
  </>}
  {tab==='history'&&<>
   <Field label="Fecha inicial (AAAA-MM-DD)" value={from} onChange={setFrom}/><Field label="Fecha final (AAAA-MM-DD)" value={to} onChange={setTo}/><Choice items={[{id:'',name:'Todos los medios'},{id:'cash',name:'Efectivo'},{id:'electronic',name:'Electrónico'}]} value={filterMethod} onChange={setFilterMethod}/>{admin&&<Choice items={[{id:'',name:'Todos los vendedores'},...users]} value={filterSeller} onChange={setFilterSeller}/>}
   <Choice items={[{id:'',name:'Todos los clientes'},...customers]} value={customer} onChange={setCustomer}/><Button title="Consultar recaudos" disabled={busy} onPress={()=>run(loadHistory)}/><Text style={styles.h2}>Recaudo neto: {cop(history.filter(c=>!c.reversed_at).reduce((n,c)=>n+c.amount_cents,0))}</Text>
   {history.map(c=><Card key={c.id}><Text style={styles.h2}>{cop(c.amount_cents)} {c.reversed_at?'· REVERTIDO':''}</Text><Text>{c.customer_name} · {c.seller_name} · {c.route_name}</Text><Text>{new Date(c.created_at).toLocaleString('es-CO')} · {c.method==='cash'?'Efectivo':'Electrónico'}</Text><Text>{c.note}</Text></Card>)}
  </>}
  <Sheet visible={!!action} title={action?.title||''} onClose={()=>setAction(null)} footer={<Button title="Confirmar" disabled={busy||!reason.trim()} onPress={()=>run(async()=>{await api(action!.path,'POST',{reason});setAction(null);await loadAccount();await loadStock();await refresh();})}/>}><Text>Esta operación quedará registrada en el historial.</Text><Field label="Motivo obligatorio" value={reason} onChange={setReason}/></Sheet>
 </Page>;
}
