import React,{useEffect,useState,useRef} from 'react';
import {Text,View} from 'react-native';
import * as Crypto from 'expo-crypto';
import {api,downloadPdf,readPending,savePending,ApiError} from './api';
import {Badge,Banner,Button,Card,Chip,Empty,Field,Header,InfoRow,ListRow,Page,SearchBar,Section,Segmented,Sheet,colors,cop,date,styles,saleNumber,normalizeSearch,normalizeMoney,moneyToCents,bogotaDay,isIsoDate} from './ui';
import {SearchSelect} from './SearchSelect';
import type {User,Customer,CashSession,Product} from './types';
import type {Run} from '../App';
const KIND:Record<string,string>={collection:'Abono',initial_payment:'Abono/pago inicial'};
const methodName=(m?:string)=>m==='cash'?'Efectivo':m==='electronic'?'Electrónico':'';
const query=(from:string,to:string)=>{const q=new URLSearchParams();if(from)q.set('from',from);if(to)q.set('to',to);return q.toString();};
/** Desde/Hasta con atajos. Las fechas siguen viajando como AAAA-MM-DD. */
function Range({from,to,setFrom,setTo}:{from:string;to:string;setFrom:(v:string)=>void;setTo:(v:string)=>void}){
 const today=bogotaDay(),month=today.slice(0,8)+'01',error=(v:string)=>v&&!isIsoDate(v)?'Usa el formato AAAA-MM-DD':null;
 return <View style={{gap:10}}>
  <View style={styles.wrap}><Chip text="Hoy" on={from===today&&to===today} onPress={()=>{setFrom(today);setTo(today);}}/><Chip text="Este mes" on={from===month&&to===today} onPress={()=>{setFrom(month);setTo(today);}}/><Chip text="Todo" on={!from&&!to} onPress={()=>{setFrom('');setTo('');}}/></View>
  <View style={[styles.row,{alignItems:'flex-start'}]}><View style={{flex:1}}><Field label="Desde" kind="date" value={from} onChange={setFrom} placeholder="AAAA-MM-DD" error={error(from)}/></View><View style={{flex:1}}><Field label="Hasta" kind="date" value={to} onChange={setTo} placeholder="AAAA-MM-DD" error={error(to)}/></View></View>
 </View>;
}
export function OperationsScreen({user,customers,session,run,busy,refresh,onBack}:{user:User;products:Product[];customers:Customer[];session?:CashSession;run:Run;busy:boolean;refresh:()=>Promise<void>;onBack?:()=>void}){
 const admin=user.role==='admin';
 const [tab,setTab]=useState('accounts'),[debtors,setDebtors]=useState<any[]>([]),[customer,setCustomer]=useState(''),[search,setSearch]=useState(''),[account,setAccount]=useState<any>(null),[statement,setStatement]=useState<any>(null),[platforms,setPlatforms]=useState<any[]>([]),[pending,setPending]=useState<any>(null),[action,setAction]=useState<any>(null),[reason,setReason]=useState('');const lock=useRef(false);
 // Abono
 const [amount,setAmount]=useState(''),[method,setMethod]=useState('cash'),[platform,setPlatform]=useState(''),[reference,setReference]=useState(''),[note,setNote]=useState('');
 // Estado de cuenta y recaudos: cada uno con sus propios filtros.
 const [from,setFrom]=useState(''),[to,setTo]=useState(''),[histFrom,setHistFrom]=useState(''),[histTo,setHistTo]=useState(''),[histMethod,setHistMethod]=useState(''),[history,setHistory]=useState<any[]|null>(null);
 async function load(){setDebtors(await api('/accounts'));setPlatforms(await api('/platforms'));setPending(await readPending(user.id+'-collection'));}
 async function detail(key=customer){if(!key)return;const [a,s]=await Promise.all([api('/accounts/'+key),api('/accounts/'+key+'/statement?'+query(from,to))]);setAccount(a);setStatement(s);}
 useEffect(()=>{run(load);},[]);useEffect(()=>{setAccount(null);setStatement(null);if(customer)run(()=>detail());},[customer]);
 async function collect(){if(lock.current)return;lock.current=true;try{const value=moneyToCents(amount);if(!pending&&(!value||!session||!account||value>account.balance_cents))throw new Error('Revisa el importe, la deuda y tu caja abierta.');const body=pending||{customer_id:customer,session_id:session!.id,amount:normalizeMoney(amount),method,platform_id:method==='electronic'?platform:null,reference:method==='electronic'?reference:undefined,note,request_key:Crypto.randomUUID()};await savePending(user.id+'-collection',body);setPending(body);try{await api('/collections','POST',body);}catch(e){if(e instanceof ApiError&&[400,403,404,409].includes(e.status)){await savePending(user.id+'-collection',null);setPending(null);}throw e;}await savePending(user.id+'-collection',null);setPending(null);setAmount('');setNote('');await load();await detail(body.customer_id);await refresh();}finally{lock.current=false;}}
 const q=normalizeSearch(search),matches=debtors.filter(c=>!q||normalizeSearch(c.name).includes(q)),total=debtors.reduce((n,c)=>n+(c.balance_cents||0),0);
 const value=moneyToCents(amount),tooMuch=!!value&&!!account&&value>account.balance_cents;
 const kind=(m:any)=>m.kind==='sale'?(m.credit?'Venta a crédito':'Venta de contado'):KIND[m.kind]||m.kind;
 return <Page onRefresh={()=>run(async()=>{await load();await detail();})}>
  <Header title="Cuentas por cobrar" subtitle="Ventas a crédito, abonos y estados de cuenta" onBack={onBack} backLabel="Volver a Más"/>
  <Segmented testID="accounts-tabs" items={[{id:'accounts',name:'Cartera'},{id:'collect',name:'Abonar'},{id:'history',name:'Recaudos'}]} value={tab} onChange={setTab}/>

  {tab==='accounts'&&!customer&&<>
   <Card tone="accent" style={{gap:4}}><Text style={styles.small}>Total por cobrar · {debtors.length} {debtors.length===1?'cliente':'clientes'}</Text><Text style={styles.metric}>{cop(total)}</Text></Card>
   <SearchBar value={search} onChange={setSearch} placeholder="Buscar clientes con deuda"/>
   {matches.length?<View style={{gap:8}}>{matches.map(c=><ListRow key={c.id} title={c.name} subtitle={c.customer_type==='wholesale'?'Mayorista':'Normal'} value={cop(c.balance_cents)} onPress={()=>setCustomer(c.id)}/>)}</View>
    :<Empty icon="check-circle" title={q?'Sin resultados':'Nadie debe por ahora'} text={q?'Prueba con otro nombre.':'Las ventas a crédito con saldo aparecerán aquí.'}/>}
   <SearchSelect label="Estado de cuenta de otro cliente" items={customers} value={customer} onChange={setCustomer}/>
  </>}

  {tab==='accounts'&&!!customer&&<>
   <Button title="Volver a la cartera" icon="arrow-left" variant="ghost" style={{alignSelf:'flex-start'}} onPress={()=>setCustomer('')}/>
   {account&&<>
    <Card style={{gap:8}}>
     <Text style={styles.h2}>{statement?.customer?.name||customers.find(c=>c.id===customer)?.name||debtors.find(c=>c.id===customer)?.name}</Text>
     {statement&&<Badge text={statement.customer.customer_type==='wholesale'?'Mayorista':'Normal'} tone="gray"/>}
     <Text style={styles.small}>Saldo pendiente</Text>
     <Text style={[styles.metric,{color:account.balance_cents>0?colors.ink:colors.greenDark}]}>{cop(account.balance_cents)}</Text>
     {account.balance_cents>0&&<Button title="Registrar abono" icon="plus" onPress={()=>setTab('collect')}/>}
    </Card>
    <Section title={`Facturas (${account.invoices.length})`}>
     {account.invoices.map((s:any)=><Card key={s.id} style={{gap:4}}>
      <View style={styles.row}><Text style={[styles.h2,{fontSize:16,flex:1}]}>Factura {saleNumber(s)}</Text><Badge text={s.state} tone={s.state==='ANULADA'?'red':s.balance_cents>0?'orange':'green'}/></View>
      <Text style={styles.small}>{s.snapshot.credit?'Crédito':'Contado'}</Text>
      <InfoRow label="Total" value={cop(s.total_cents)}/><InfoRow label="Saldo" value={cop(s.balance_cents)} strong/>
      {admin&&s.state!=='ANULADA'&&<Button title="Anular venta" size="sm" variant="ghost" style={{alignSelf:'flex-start'}} onPress={()=>{setAction({path:'/sales/'+s.id+'/void',title:'Anular venta '+saleNumber(s),text:'La venta queda anulada y su saldo deja de cobrarse. Esta acción queda registrada.'});setReason('');}}/>}
     </Card>)}
    </Section>
    <Section title="Estado de cuenta">
     <Card>
      <Range from={from} to={to} setFrom={setFrom} setTo={setTo}/>
      <View style={styles.wrap}><Button title="Consultar movimientos" variant="secondary" style={{flexGrow:1}} disabled={busy} onPress={()=>run(()=>detail())}/><Button title="Descargar estado de cuenta PDF" icon="download" variant="outline" style={{flexGrow:1}} disabled={busy} onPress={()=>run(()=>downloadPdf('/accounts/'+customer+'/statement/pdf?'+query(from,to)))}/></View>
      {statement&&<>
       <InfoRow label="Saldo anterior" value={cop(statement.opening_cents)}/>
       {statement.movements.map((m:any)=><View key={m.id} style={{gap:2,borderTopWidth:1,borderTopColor:colors.line,paddingTop:8}}>
        <View style={styles.row}><Text style={[styles.body,{flex:1,fontWeight:'600',color:colors.ink}]}>{kind(m)} · {m.number}</Text><Text style={styles.money}>{cop(m.amount_cents)}</Text></View>
        <Text style={styles.small}>{date(m.created_at)} · {m.user_name}{methodName(m.method)?' · '+methodName(m.method):''}{m.description?' · '+m.description:''}</Text>
        <Text style={styles.small}>Saldo: {cop(m.balance_cents)}</Text>
       </View>)}
       <View style={styles.divider}/>
       <InfoRow label="Ventas del período" value={cop(statement.total_sales_cents)}/>
       <InfoRow label="Abonos netos" value={cop(statement.total_collections_cents)}/>
       <InfoRow label="Saldo actual" value={cop(statement.balance_cents)} strong/>
      </>}
     </Card>
    </Section>
   </>}
  </>}

  {tab==='collect'&&<>
   {!session&&!pending&&<Banner tone="orange" text="Abre tu caja antes de registrar recaudos."/>}
   <SearchSelect label="Cliente con deuda" items={debtors.map(c=>({...c,name:c.name+' · '+cop(c.balance_cents)}))} value={customer} onChange={setCustomer}/>
   {pending?<><Banner text="Abono pendiente de confirmación. No lo registres de nuevo."/><Button title="Reintentar abono" disabled={busy} onPress={()=>run(collect)}/></>:<Card>
    {account&&<Text style={styles.h2}>Saldo pendiente: {cop(account.balance_cents)}</Text>}
    <Field label="Valor del abono" value={amount} onChange={setAmount} kind="decimal" prefix="$" error={tooMuch?'El abono no puede superar el saldo pendiente.':null}/>
    <Segmented items={[{id:'cash',name:'Efectivo'},{id:'electronic',name:'Electrónico'}]} value={method} onChange={setMethod}/>
    {method==='electronic'&&<><SearchSelect label="Medio electrónico" items={platforms.filter(p=>p.active)} value={platform} onChange={setPlatform}/><Field label="Referencia de pago" value={reference} onChange={setReference} required/></>}
    <Field label="Observaciones (opcional)" value={note} onChange={setNote}/>
    <Text style={styles.hint}>Se guardan automáticamente fecha, hora y usuario {user.name}.</Text>
    <Button title="Registrar abono" icon="check" size="lg" testID="register-collection" disabled={busy||(method==='electronic'&&(!platform||!reference.trim()))||!session||!customer||!moneyToCents(amount)||!account?.balance_cents} onPress={()=>run(collect,'Abono registrado')}/>
   </Card>}
  </>}

  {tab==='history'&&<>
   <Card>
    <Range from={histFrom} to={histTo} setFrom={setHistFrom} setTo={setHistTo}/>
    <Segmented items={[{id:'',name:'Todos'},{id:'cash',name:'Efectivo'},{id:'electronic',name:'Electrónico'}]} value={histMethod} onChange={setHistMethod}/>
    <Button title="Consultar recaudos" icon="search" disabled={busy} onPress={()=>run(async()=>{const p=new URLSearchParams(query(histFrom,histTo));p.set('include_initial','1');if(histMethod)p.set('method',histMethod);setHistory(await api('/collections?'+p));})}/>
   </Card>
   {history&&(history.length?<>
    <Text style={styles.small}>{history.length} {history.length===1?'recaudo':'recaudos'} · {cop(history.filter(c=>!c.reversed_at).reduce((n,c)=>n+c.amount_cents,0))} vigentes</Text>
    {history.map(c=><Card key={c.id} style={{gap:4}}>
     <View style={styles.row}><Text style={[styles.h2,{fontSize:16,flex:1}]}>{c.customer_name}</Text><Text style={[styles.money,{fontSize:16},c.reversed_at&&{textDecorationLine:'line-through',color:colors.muted}]}>{cop(c.amount_cents)}</Text></View>
     {c.reversed_at&&<Badge text="Revertido" tone="red"/>}
     <Text style={styles.small}>{date(c.created_at)} · {c.platform_name||methodName(c.method)}{c.reference?' · Ref: '+c.reference:''}</Text>
     <Text style={styles.small}>{c.seller_name} · {c.route_name}{c.note?' · '+c.note:''}</Text>
     {admin&&!c.reversed_at&&c.kind!=='initial_payment'&&<Button title="Revertir abono" size="sm" variant="ghost" style={{alignSelf:'flex-start'}} onPress={()=>{setAction({path:'/collections/'+c.id+'/reverse',title:'Revertir abono',text:`El abono de ${cop(c.amount_cents)} de ${c.customer_name} vuelve a sumarse a su deuda. Esta acción queda registrada.`});setReason('');}}/>}
    </Card>)}
   </>:<Empty icon="search" title="Sin recaudos" text="No hay abonos con estos filtros."/>)}
  </>}

  <Sheet visible={!!action} title={action?.title||'Confirmar corrección'} onClose={()=>setAction(null)} footer={<><Button title="Confirmar" variant="danger" disabled={busy||!reason.trim()} onPress={()=>run(async()=>{await api(action.path,'POST',{reason});setAction(null);await load();await detail();await refresh();})}/><Button title="Cancelar" variant="ghost" disabled={busy} onPress={()=>setAction(null)}/></>}>
   {!!action?.text&&<Text style={styles.body}>{action.text}</Text>}
   <Field label="Motivo obligatorio" value={reason} onChange={setReason}/>
  </Sheet>
 </Page>;
}
