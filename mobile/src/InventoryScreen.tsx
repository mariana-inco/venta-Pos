import React,{useEffect,useState,useRef} from 'react';
import {Text,View} from 'react-native';
import * as Crypto from 'expo-crypto';
import {api,readPending,savePending,ApiError} from './api';
import {Badge,Banner,Button,Card,Confirm,Empty,Field,Header,IconButton,InfoRow,Page,SearchBar,Section,Segmented,Choice,colors,date,styles,quantityLabel,parseQuantity,quantityForApi,normalizeSearch} from './ui';
import {SearchSelect} from './SearchSelect';
import type {User,Product,Customer} from './types';
import type {Run} from '../App';
type View_='stock'|'delivery'|'adjust'|'groups';
const KIND:Record<string,string>={assign:'Entrega',adjust:'Ajuste',sale:'Venta',void:'Anulación'};
const MOVES=40;
export function InventoryScreen({user,products,run,busy,refresh,onBack}:{user:User;products:Product[];customers:Customer[];run:Run;busy:boolean;refresh:()=>Promise<void>;onBack?:()=>void}){
 const admin=user.role==='admin';
 const [view,setView]=useState<View_>('stock'),[routes,setRoutes]=useState<any[]>([]),[route,setRoute]=useState(''),[inventory,setInventory]=useState<any>({stock:[],movements:[]}),[deliveries,setDeliveries]=useState<any[]>([]),[users,setUsers]=useState<any[]>([]),[groups,setGroups]=useState<any[]>([]);
 // Entrega
 const [query,setQuery]=useState(''),[cart,setCart]=useState<{product:Product;quantity:string}[]>([]),[note,setNote]=useState(''),[pending,setPending]=useState<any>(null),[review,setReview]=useState(false);const lock=useRef(false);
 // Ajuste (estado propio: el motivo no se mezcla con las observaciones de la entrega)
 const [group,setGroup]=useState(''),[qty,setQty]=useState(''),[reason,setReason]=useState('');
 // Grupos compartidos
 const [groupName,setGroupName]=useState(''),[unit,setUnit]=useState('kg'),[memberGroup,setMemberGroup]=useState(''),[product,setProduct]=useState('');
 const [history,setHistory]=useState(false),[moves,setMoves]=useState(MOVES);
 async function load(){const r=await api<any[]>('/routes');setRoutes(r);if(!route&&r.length)setRoute(r[0].id);setGroups(await api('/inventory-groups'));const draft=await readPending(user.id+'-delivery');setPending(draft);if(draft){setRoute(String(draft.route_id));setView('delivery');}}
 async function stock(){if(!route)return;const [i,d]=await Promise.all([api('/inventory?route_id='+route),api<any[]>('/deliveries?route_id='+route)]);setInventory(i);setDeliveries(d);if(admin)setUsers(await api('/routes/'+route+'/users'));}
 useEffect(()=>{run(load);},[]);useEffect(()=>{setCart([]);setMoves(MOVES);run(stock);},[route]);
 async function confirm(){if(lock.current)return;lock.current=true;try{const body=pending||{route_id:route,items:cart.map(c=>({product_id:c.product.id,quantity:quantityForApi(parseQuantity(c.quantity,c.product.unit)!)})),note:note.trim()||'Entrega diaria',request_key:Crypto.randomUUID()};await savePending(user.id+'-delivery',body);setPending(body);try{await api('/deliveries','POST',body);}catch(e){if(e instanceof ApiError&&[400,403,404,409].includes(e.status)){await savePending(user.id+'-delivery',null);setPending(null);}throw e;}await savePending(user.id+'-delivery',null);setPending(null);setCart([]);setNote('');await load();await stock();await refresh();}finally{lock.current=false;}}
 const routeName=routes.find(r=>r.id===route)?.name||'';
 const q=normalizeSearch(query),matches=q?products.filter(p=>p.active&&(normalizeSearch(p.name).includes(q)||p.codes?.some(c=>normalizeSearch(c.code).includes(q)))).slice(0,30):[];
 const cartReady=!!route&&!!cart.length&&!cart.some(c=>!parseQuantity(c.quantity,c.product.unit));
 // Lo que la entrega pondrá en cero: grupos con saldo que no reciben ningún producto de la lista.
 const zeroed=inventory.stock.filter((s:any)=>s.available_milli>0&&!cart.some(c=>c.product.group_id===s.group_id));
 const selected=inventory.stock.find((s:any)=>s.group_id===group);
 const target=qty.trim()==='0'?0:selected?parseQuantity(qty,selected.unit):null;
 const unitOf=(groupId:string)=>inventory.stock.find((s:any)=>s.group_id===groupId)?.unit||groups.find(g=>g.id===groupId)?.unit||'unit';
 const member=groups.find(g=>g.id===memberGroup);
 const tabs=[{id:'stock',name:'Stock'},{id:'delivery',name:'Entrega'},{id:'adjust',name:'Ajuste'},{id:'groups',name:'Grupos'}];
 return <Page onRefresh={()=>run(stock)}>
  <Header title={admin?'Inventarios y entregas':'Inventario de mi ruta'} subtitle={admin?undefined:routeName||'Sin ruta asignada'} onBack={onBack} backLabel="Volver a Más"/>
  {admin&&<View style={{gap:6}}>
   <SearchSelect label="Ruta" items={routes} value={route} disabled={!!pending} onChange={setRoute}/>
   {!!users.length&&<Text style={styles.small}>Asignados: {users.map(u=>u.name).join(', ')}</Text>}
  </View>}
  {admin&&<Segmented testID="inventory-tabs" items={tabs} value={view} onChange={v=>setView(v as View_)}/>}

  {view==='stock'&&<>
   {inventory.stock.length===0?<Empty icon="archive" title="Sin existencias en esta ruta" text={admin?'Registra la entrega diaria para asignar productos a la ruta.':'Cuando el administrador registre la entrega diaria, verás aquí tus existencias.'} action={admin?'Registrar entrega':undefined} onAction={admin?()=>setView('delivery'):undefined}/>
   :inventory.stock.map((s:any)=><Card key={s.group_id} style={{gap:8}}>
    <View style={styles.row}><Text style={[styles.h2,{flex:1}]}>{s.name}</Text><Badge text={s.unit==='kg'?'KG':'UND'} tone="gray"/></View>
    <View style={[styles.row,{alignItems:'flex-end'}]}>
     <View style={{flex:1}}><Text style={styles.small}>Disponible</Text><Text testID="stock-available" style={[styles.metric,s.available_milli<=0&&{color:colors.orange}]}>{quantityLabel(s.available_milli,s.unit)}</Text></View>
     {admin&&<Button title="Ajustar" size="sm" variant="ghost" icon="edit-2" onPress={()=>{setGroup(s.group_id);setQty('');setView('adjust');}}/>}
    </View>
    <View style={styles.divider}/>
    <InfoRow label="Última entrega" value={quantityLabel(s.initial_milli,s.unit)}/>
    <InfoRow label="Vendido neto" value={quantityLabel(s.sold_milli,s.unit)}/>
   </Card>)}
   <Section title="Entregas y movimientos" action={history?'Ocultar':'Ver historial'} onAction={()=>setHistory(!history)}>
    {!history?<Text style={styles.small}>{deliveries.length} {deliveries.length===1?'entrega registrada':'entregas registradas'} · {inventory.movements.length} movimientos</Text>:<>
     {deliveries.map(d=><Card key={d.id} style={{gap:6}}>
      <View style={styles.row}><Text style={[styles.h2,{fontSize:16,flex:1}]}>Entrega · {date(d.created_at)}</Text></View>
      <Text style={styles.small}>{d.actor_name}{d.note?' · '+d.note:''}</Text>
      {d.items.map((i:any)=><InfoRow key={i.product_id} label={i.name} value={quantityLabel(i.quantity_milli,i.unit)}/>)}
     </Card>)}
     {!!inventory.movements.length&&<Card style={{gap:0,paddingVertical:6}}>{inventory.movements.slice(0,moves).map((m:any,n:number)=><View key={m.id} style={[{paddingVertical:8,gap:2},n>0&&{borderTopWidth:1,borderTopColor:colors.line}]}>
      <View style={styles.row}><Text style={[styles.body,{flex:1,fontWeight:'600',color:colors.ink}]} numberOfLines={1}>{KIND[m.kind]||m.kind} · {m.product_name||m.group_name}</Text><Text style={[styles.money,{color:m.quantity_milli<0?colors.red:colors.greenDark}]}>{m.quantity_milli>0?'+':m.quantity_milli<0?'−':''}{quantityLabel(Math.abs(m.quantity_milli),unitOf(m.group_id))}</Text></View>
      <Text style={styles.small}>{date(m.created_at)} · {m.actor_name}{m.note?' · '+m.note:''}</Text>
     </View>)}</Card>}
     {inventory.movements.length>moves&&<Button title={`Ver más movimientos (${inventory.movements.length-moves})`} variant="secondary" onPress={()=>setMoves(moves+MOVES)}/>}
    </>}
   </Section>
  </>}

  {admin&&view==='delivery'&&<Card>
   <Text style={styles.h2}>Entrega diaria de productos</Text>
   <Banner tone="orange" text="Esta entrega reemplaza TODO el stock de la ruta. Los productos omitidos quedarán en cero. Revisa la lista antes de confirmar."/>
   {pending?<><Banner text="Entrega pendiente de confirmar. Reintenta para evitar duplicarla."/><Button title="Reintentar entrega" disabled={busy} onPress={()=>run(confirm)}/></>:<>
    <SearchBar value={query} onChange={setQuery} placeholder="Buscar producto por nombre o código"/>
    {matches.map(p=>{const added=cart.some(c=>c.product.id===p.id);return <View key={p.id} style={styles.row}><View style={{flex:1}}><Text style={styles.body}>{p.name}</Text>{!!p.codes?.[0]?.code&&<Text style={styles.small}>Código {p.codes[0].code}</Text>}</View><Button title={added?'Agregado':'Agregar'} size="sm" variant={added?'secondary':'primary'} disabled={added} onPress={()=>{setCart([...cart,{product:p,quantity:p.unit==='unit'?'1':''}]);setQuery('');}}/></View>;})}
    {!!cart.length&&<Section title={`Productos de la entrega (${cart.length})`}>
     {cart.map(c=><View key={c.product.id} style={[styles.row,{alignItems:'flex-end'}]}><View style={{flex:1}}><Field label={c.product.name+' · '+(c.product.unit==='kg'?'KG':'UND')} value={c.quantity} kind="decimal" onChange={quantity=>setCart(cart.map(x=>x.product.id===c.product.id?{...x,quantity}:x))}/></View><View style={{paddingBottom:4}}><IconButton icon="trash-2" label={'Quitar '+c.product.name} onPress={()=>setCart(cart.filter(x=>x.product.id!==c.product.id))}/></View></View>)}
    </Section>}
    {!cart.length&&<Text style={styles.hint}>Busca y agrega cada producto que sale hoy con la ruta, con su cantidad.</Text>}
    <Field label="Observaciones de la entrega" value={note} onChange={setNote} placeholder="Entrega diaria"/>
    <Button title="Revisar y confirmar entrega" icon="check" disabled={busy||!cartReady} onPress={()=>setReview(true)}/>
   </>}
  </Card>}

  {admin&&view==='adjust'&&<Card>
   <Text style={styles.h2}>Ajuste autorizado</Text>
   <Text style={styles.small}>Corrige el disponible de la ruta cuando el conteo físico no coincide. Escribe la cantidad final que debe quedar.</Text>
   <SearchSelect label="Inventario" items={inventory.stock.map((s:any)=>({id:s.group_id,name:s.name}))} value={group} onChange={id=>{setGroup(id);setQty('');}}/>
   {selected&&<InfoRow label="Disponible actual" value={quantityLabel(selected.available_milli,selected.unit)} strong/>}
   <Field label="Disponible después del ajuste" value={qty} onChange={setQty} kind="decimal"/>
   {selected&&target!==null&&<InfoRow label="Cambio" value={target===selected.available_milli?'Sin cambio':(target>selected.available_milli?'+':'−')+quantityLabel(Math.abs(target-selected.available_milli),selected.unit)} tone={target<selected.available_milli?'red':'green'}/>}
   <Field label="Motivo obligatorio" value={reason} onChange={setReason} placeholder="Ej. 2 kg dañados en transporte"/>
   <Button title="Registrar ajuste" disabled={busy||!group||!qty||!reason.trim()} onPress={()=>run(async()=>{await api('/inventory','POST',{route_id:route,group_id:group,quantity:qty,kind:'adjust',note:reason,expected_available_milli:inventory.stock.find((s:any)=>s.group_id===group)?.available_milli||0});setQty('');setReason('');await stock();await refresh();},'Ajuste registrado')}/>
  </Card>}

  {admin&&view==='groups'&&<>
   <Text style={styles.small}>Un grupo comparte un solo saldo entre varias presentaciones (por ejemplo, pollo entero y por partes).</Text>
   {groups.map(g=>{const members=products.filter(p=>p.active&&g.products.includes(p.id));return <Card key={g.id} style={{gap:6}}>
    <View style={styles.row}><Text style={[styles.h2,{flex:1}]}>{g.name}</Text><Badge text={g.unit==='kg'?'KG':'UND'} tone="gray"/></View>
    {members.length?members.map(p=><View key={p.id} style={styles.row}><Text style={[styles.body,{flex:1}]}>{p.name}</Text><Button title="Retirar del grupo" size="sm" variant="ghost" onPress={()=>run(async()=>{await api('/products/'+p.id+'/group','DELETE');await load();await refresh();})}/></View>):<Text style={styles.small}>Sin productos activos.</Text>}
   </Card>;})}
   <Card>
    <Text style={styles.h2}>Asociar producto a un grupo</Text>
    <SearchSelect label="Grupo" items={groups} value={memberGroup} onChange={id=>{setMemberGroup(id);setProduct('');}}/>
    <SearchSelect label="Producto" items={products.filter(p=>p.active&&!p.group_id&&(!member||p.unit===member.unit))} value={product} onChange={setProduct}/>
    <Text style={styles.hint}>Solo productos activos sin grupo y con la misma unidad del grupo.</Text>
    <Button title="Asociar producto al grupo" disabled={busy||!memberGroup||!product} onPress={()=>run(async()=>{await api('/products/'+product+'/group','PUT',{group_id:memberGroup});setProduct('');await load();await refresh();})}/>
   </Card>
   <Card>
    <Text style={styles.h2}>Nuevo grupo compartido</Text>
    <Field label="Nombre del grupo" value={groupName} onChange={setGroupName}/>
    <Choice items={[{id:'kg',name:'KG'},{id:'unit',name:'UND'}]} value={unit} onChange={setUnit}/>
    <Button title="Crear grupo" variant="secondary" disabled={busy||!groupName.trim()} onPress={()=>run(async()=>{await api('/inventory-groups','POST',{name:groupName,unit});setGroupName('');await load();})}/>
   </Card>
  </>}

  <Confirm visible={review} title={`¿Reemplazar el stock de ${routeName}?`} message="La ruta quedará exactamente con estas cantidades." confirmText="Confirmar entrega" busy={busy} onCancel={()=>setReview(false)} onConfirm={()=>{setReview(false);run(async()=>{await confirm();setView('stock');},'Entrega registrada');}}>
   <View style={{gap:2}}>{cart.map(c=><InfoRow key={c.product.id} label={c.product.name} value={c.quantity+' '+(c.product.unit==='kg'?'kg':'und')} strong/>)}</View>
   {!!zeroed.length&&<Banner tone="orange" title="Quedarán en cero" text={zeroed.map((s:any)=>`${s.name} (hoy ${quantityLabel(s.available_milli,s.unit)})`).join(', ')}/>}
  </Confirm>
 </Page>;
}
