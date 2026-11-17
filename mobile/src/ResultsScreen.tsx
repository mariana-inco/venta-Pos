import React,{useEffect,useState} from 'react';
import {Text,View} from 'react-native';
import {api} from './api';
import {Banner,Button,Card,Chip,Empty,Field,Header,InfoRow,ListRow,Page,Section,Segmented,Stat,colors,cop,date,isIsoDate,styles,quantityLabel,bogotaDay} from './ui';
import {SearchSelect} from './SearchSelect';
import type {Run} from '../App';
/** Resumen financiero: lo vendido arriba, el detalle de cobros y abonos debajo y lo recibido al final. */
export function FinancialSummary({value}:{value:any}){
 const cash=value.cash_cents??((value.sale_cash_cents||0)+(value.collection_cash_cents||0)),electronic=value.electronic_cents??((value.sale_electronic_cents||0)+(value.collection_electronic_cents||0));
 const row=(label:string,n:any,strong?:boolean)=><InfoRow key={label} label={label} value={cop(Number(n)||0)} strong={strong}/>;
 return <View style={{gap:2}}>
  {row('Vendido',value.total_cents,true)}{row('Ventas a crédito',value.credit_cents)}
  {row('Cobros de ventas · efectivo',value.sale_cash_cents)}{row('Cobros de ventas · electrónico',value.sale_electronic_cents)}
  {row('Abonos · efectivo',value.collection_cash_cents)}{row('Abonos · electrónico',value.collection_electronic_cents)}
  <View style={[styles.divider,{marginVertical:4}]}/>
  {row('Total recibido · efectivo',cash,true)}{row('Total recibido · electrónico',electronic,true)}
 </View>;
}
export function InventorySummary({value}:{value:any}){
 if(!value?.groups?.length)return <Text style={styles.small}>Sin movimientos de inventario.</Text>;
 return <View style={{gap:12}}>{value.groups.map((g:any)=><View key={g.group_id} style={{gap:2}}>
  <Text style={[styles.h2,{fontSize:16}]}>{g.name}</Text>
  <InfoRow label="Saldo inicial" value={quantityLabel(g.opening_milli,g.unit)}/>
  <InfoRow label="Entregas" value={quantityLabel(g.assigned_milli,g.unit)}/>
  <InfoRow label="Vendido neto" value={quantityLabel(g.sold_milli,g.unit)}/>
  <InfoRow label="Ajustes" value={quantityLabel(g.adjusted_milli,g.unit)}/>
  <InfoRow label="Disponible final" value={quantityLabel(g.final_milli,g.unit)} strong/>
  {g.products.map((p:any)=><Text key={p.id} style={styles.small}>{p.name}: entregado {quantityLabel(p.assigned_milli,g.unit)} · vendido {quantityLabel(p.sold_milli,g.unit)}{' · Sobrante: '+quantityLabel(p.remaining_milli??g.final_milli,g.unit)}{g.products.length>1?' (saldo compartido; no sumar entre productos)':''}</Text>)}
 </View>)}</View>;
}
/** Cifras clave en mosaico para leer la jornada de un vistazo. */
function Highlights({value}:{value:any}){
 const cash=value.cash_cents??((value.sale_cash_cents||0)+(value.collection_cash_cents||0)),electronic=value.electronic_cents??((value.sale_electronic_cents||0)+(value.collection_electronic_cents||0));
 return <View style={styles.wrap}>
  <Stat label="Vendido" value={cop(value.total_cents||0)} icon="shopping-cart" tone="accent"/>
  <Stat label="A crédito" value={cop(value.credit_cents||0)} icon="clock" tone="orange"/>
  <Stat label="Recibido efectivo" value={cop(cash)} icon="dollar-sign" tone="green"/>
  <Stat label="Recibido electrónico" value={cop(electronic)} icon="smartphone" tone="accent"/>
 </View>;
}
function Report({r,i}:{r:any;i:any}){
 if(!r)return i?<Section title="Inventario de la ruta"><Card><InventorySummary value={i}/></Card></Section>:<Text style={styles.small}>Este cierre no tiene resumen financiero guardado.</Text>;
 const sellers=r.by_seller||[],users=r.by_user||[],collections=r.collections||[];
 return <>
  <Card><Text style={styles.h2}>Consolidado</Text><Highlights value={r}/><FinancialSummary value={r}/></Card>
  {!!sellers.length&&<Section title="Por vendedor">{sellers.map((s:any)=><Card key={s.user_id+'/'+s.agent_id}><Text style={styles.h2}>{s.seller_name} · {s.user_name}</Text><FinancialSummary value={s}/></Card>)}</Section>}
  {!!users.length&&<Section title="Por usuario">{users.map((u:any)=><Card key={u.user_id}><Text style={styles.h2}>Total del usuario: {u.name}</Text><FinancialSummary value={u}/></Card>)}</Section>}
  <Section title={`Abonos registrados (${collections.length})`}><Card style={{gap:0,paddingVertical:6}}>{collections.length?collections.map((c:any,n:number)=><View key={c.id} style={[{paddingVertical:8,gap:2},n>0&&{borderTopWidth:1,borderTopColor:colors.line}]}>
   <View style={styles.row}><Text style={[styles.body,{flex:1}]}>{c.user_name}</Text><Text style={styles.money}>{cop(c.amount_cents)}</Text></View>
   <Text style={styles.small}>{c.method==='cash'?'Efectivo':'Electrónico'} · {date(c.created_at)}</Text>
  </View>):<Text style={[styles.small,{paddingVertical:8}]}>Sin abonos en este período.</Text>}</Card></Section>
  {i&&<Section title="Inventario de la ruta"><Card><InventorySummary value={i}/></Card></Section>}
 </>;
}
export function ResultsScreen({run,busy,onBack}:{run:Run;busy:boolean;onBack?:()=>void}){
 const [tab,setTab]=useState('day'),[routes,setRoutes]=useState<any[]>([]),[users,setUsers]=useState<any[]>([]),[route,setRoute]=useState(''),[user,setUser]=useState(''),[day,setDay]=useState(bogotaDay()),[report,setReport]=useState<any>(null),[inventory,setInventory]=useState<any>(null),[closings,setClosings]=useState<any[]>([]),[selected,setSelected]=useState<any>(null);
 async function load(){setRoutes(await api('/routes'));setUsers(await api('/users'));setClosings(await api('/daily-closures'));}
 useEffect(()=>{run(load);},[]);
 async function consult(){const q=new URLSearchParams({from:day,to:day});if(route)q.set('route_id',route);if(user)q.set('user_id',user);setReport(await api('/results?'+q));setInventory(route?await api('/inventory/report?route_id='+route+'&from='+day+'&to='+day):null);setSelected(null);}
 const today=bogotaDay(),yesterday=bogotaDay(-1);
 return <Page onRefresh={()=>run(load)}>
  <Header title="Resultados y cierres" onBack={onBack} backLabel="Volver a Más"/>
  <Segmented testID="results-tabs" items={[{id:'day',name:'Jornada'},{id:'closures',name:`Cierres de ruta (${closings.length})`}]} value={tab} onChange={t=>{setTab(t);setSelected(null);}}/>

  {tab==='day'&&<>
   <Card>
    <SearchSelect label="Ruta" items={[{id:'',name:'Todas las rutas'},...routes]} value={route} onChange={setRoute}/>
    <SearchSelect label="Usuario" items={[{id:'',name:'Todos los usuarios'},...users]} value={user} onChange={setUser}/>
    <View style={styles.wrap}><Chip text="Hoy" on={day===today} onPress={()=>setDay(today)}/><Chip text="Ayer" on={day===yesterday} onPress={()=>setDay(yesterday)}/></View>
    <Field label="Día (AAAA-MM-DD)" kind="date" value={day} onChange={setDay} error={day&&!isIsoDate(day)?'Usa el formato AAAA-MM-DD':null}/>
    <Button title="Consultar resultados" icon="search" disabled={busy} onPress={()=>run(consult)}/>
   </Card>
   {report?<><Text style={styles.h2}>Resultados de la jornada</Text><Report r={report} i={inventory}/></>
    :<Empty icon="bar-chart-2" title="Elige ruta, usuario y día" text="Consulta para ver ventas, cobros, abonos e inventario de la jornada."/>}
  </>}

  {tab==='closures'&&(selected?<>
   <Button title="Volver a los cierres" icon="arrow-left" variant="ghost" style={{alignSelf:'flex-start'}} onPress={()=>setSelected(null)}/>
   <Banner tone="gray" title={`${selected.snapshot.route.name} · ${selected.day}`} text={`Cierre histórico inmutable. Responsable: ${selected.snapshot.responsible?.name||selected.actor_id} · ${date(selected.created_at)}`}/>
   <Report r={selected.snapshot.financial} i={selected.snapshot.inventory}/>
  </>:closings.length?<View style={{gap:8}}>{closings.map(c=><ListRow key={c.id} icon="check-square" title={c.day+' · '+c.snapshot.route.name} subtitle={c.snapshot.responsible?.name} value={cop(c.snapshot.total_cents??c.snapshot.financial?.total_cents??0)} onPress={()=>setSelected(c)}/>)}</View>
   :<Empty icon="check-square" title="Sin cierres de ruta" text="Cuando una ruta cierre su jornada, la fotografía quedará guardada aquí."/>)}
 </Page>;
}
