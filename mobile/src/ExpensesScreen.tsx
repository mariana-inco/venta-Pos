import {Image,View} from 'react-native';
import {pickEvidence,EvidenceThumbnail} from './ExpenseEvidence';
import React,{useEffect,useRef,useState} from 'react';
import {Text} from 'react-native';
import * as Crypto from 'expo-crypto';
import {api,uploadExpenseEvidence,ApiError,readPending,savePending} from './api';
import {Banner,Button,Card,Empty,Field,Header,InfoRow,Page,Section,cop,date,moneyToCents,normalizeMoney,styles,bogotaDay} from './ui';
import {SearchSelect} from './SearchSelect';
import type {CashSession,User} from './types';
import type {Run} from '../App';
export function ExpensesScreen({user,sessions,run,busy,refresh,onBack}:{user:User;sessions:CashSession[];run:Run;busy:boolean;refresh:()=>Promise<void>;onBack:()=>void}){
 const choices=sessions.filter(s=>user.role==='admin'||s.opened_by===user.id);
 const [sessionId,setSessionId]=useState(user.role==='admin'?'':choices.find(s=>s.opened_by===user.id&&s.state==='open')?.id||choices[0]?.id||''),[data,setData]=useState<any>(null),[description,setDescription]=useState(''),[amount,setAmount]=useState('');
 const [photo,setPhoto]=useState(''),[progress,setProgress]=useState<number|null>(null),[from,setFrom]=useState(bogotaDay()),[to,setTo]=useState(bogotaDay()),[list,setList]=useState<any[]>([]),[page,setPage]=useState(1),[count,setCount]=useState(0);
 const [pending,setPending]=useState<Record<string,unknown>|null>(null);
 useEffect(()=>{run(async()=>{const p=await readPending(user.id+'-expense');setPending(p);if(p)setSessionId(String(p.session_id));});},[user.id]);
 const photoRequest=useRef({uri:'',key:'',id:''});
 const request=useRef<{signature:string;key:string}|null>(null),session=choices.find(s=>s.id===sessionId);
 async function listLoad(next=1){const q=new URLSearchParams({from,to,page:String(next)});if(sessionId)q.set('session_id',sessionId);const r=await api<any>('/expenses?'+q);setList(r.expenses);setCount(r.count);setPage(next);}
 async function load(){setData(sessionId?await api('/cash-sessions/'+sessionId+'/expenses'):null);await listLoad();}
 useEffect(()=>{setData(null);run(load);},[sessionId]);
 const cents=moneyToCents(amount),canAdd=session?.state==='open'&&session.opened_by===user.id;
 async function sendExpense(body:Record<string,unknown>){await savePending(user.id+'-expense',body);setPending(body);try{await api('/expenses','POST',body);}catch(e){if(e instanceof ApiError&&[400,403,404,409].includes(e.status)){await savePending(user.id+'-expense',null);setPending(null);request.current=null;}throw e;}await savePending(user.id+'-expense',null);setPending(null);request.current=null;setDescription('');setAmount('');setPhoto('');photoRequest.current={uri:'',key:'',id:''};await load();await refresh();}
 async function save(){
  if(pending)return sendExpense(pending);
  let evidenceId:string|undefined;if(photo){if(photoRequest.current.uri!==photo)photoRequest.current={uri:photo,key:Crypto.randomUUID(),id:''};if(!photoRequest.current.id){setProgress(0);try{photoRequest.current.id=await uploadExpenseEvidence(photo,sessionId,photoRequest.current.key,setProgress);}finally{setProgress(null);}}evidenceId=photoRequest.current.id;}
  const body={evidence_id:evidenceId,session_id:sessionId,description:description.trim(),amount:normalizeMoney(amount)},signature=JSON.stringify(body);
  if(request.current?.signature!==signature)request.current={signature,key:Crypto.randomUUID()};
  await sendExpense({...body,request_key:request.current.key});
 }
 return <Page onRefresh={()=>run(load)}><Header title="Gastos" subtitle="Pagados en efectivo de la caja" onBack={onBack} backLabel="Volver a Más"/>
  {choices.length?<>
   <Card><SearchSelect label="Caja" items={[...(user.role==='admin'?[{id:'',name:'Todas las cajas'}]:[]),...choices.map(s=>({id:s.id,name:`Caja #${s.number||''} · ${s.opener_name} · ${s.state==='open'?'Abierta':'Cerrada'} · ${date(s.opened_at)}`}))]} value={sessionId} disabled={!!pending} onChange={id=>{setSessionId(id);setPhoto('');photoRequest.current={uri:'',key:'',id:''};}}/>{data&&<><InfoRow label="Efectivo disponible" value={cop(data.available_cash_cents)} strong/><InfoRow label="Total de gastos" value={cop(data.total_cents)}/></>}</Card>
   {pending?<Card><Banner title="Gasto pendiente de confirmar" text="Reintenta con la misma referencia. No registres otro gasto: si el servidor ya lo guardó, se recuperará sin duplicarlo."/><InfoRow label={String(pending.description)} value={String(pending.amount)}/><Button title="Reintentar gasto" disabled={busy} onPress={()=>run(save,'Gasto confirmado')}/></Card>:canAdd?<Card><Field label="¿Qué gasto fue?" value={description} onChange={setDescription} placeholder="Ej. Transporte" testID="expense-description"/><Field label="Valor del gasto" kind="decimal" prefix="$" value={amount} onChange={setAmount} placeholder="0" testID="expense-amount"/>
    <Text style={styles.label}>Evidencia del gasto (opcional)</Text><View style={styles.wrap}><Button title="Tomar fotografía" icon="camera" variant="outline" disabled={busy} onPress={()=>run(async()=>{const uri=await pickEvidence(true);if(uri)setPhoto(uri);})}/><Button title="Elegir de galería" icon="image" variant="outline" disabled={busy} onPress={()=>run(async()=>{const uri=await pickEvidence(false);if(uri)setPhoto(uri);})}/></View>{!!photo&&<><Image source={{uri:photo}} style={{height:180,width:'100%'}} resizeMode="contain"/><Button title="Quitar fotografía" variant="ghost" disabled={busy} onPress={()=>setPhoto('')}/></>}{progress!==null&&<Text style={styles.small}>Cargando evidencia: {progress}%</Text>}
    <Button title="Guardar gasto" icon="minus-circle" disabled={busy||!data||!description.trim()||description.trim().length>240||cents===null||cents<=0||cents>(data?.available_cash_cents??0)} onPress={()=>run(save,'Gasto guardado')} testID="save-expense"/>
    {cents!==null&&cents>(data?.available_cash_cents??0)&&<Text style={styles.small}>El gasto supera el efectivo disponible.</Text>}
   </Card>:<Text style={styles.small}>Solo puedes agregar gastos en tu propia caja abierta.</Text>}
   <Section title="Resumen de gastos"><View style={styles.wrap}><Field label="Fecha inicial" value={from} onChange={setFrom}/><Field label="Fecha final" value={to} onChange={setTo}/></View><Button title="Consultar gastos" variant="outline" disabled={busy} onPress={()=>run(()=>listLoad(1))}/>{list.length?list.map((e:any)=><Card key={e.id}><InfoRow label={e.description} value={cop(e.amount_cents)} strong/><Text style={styles.small}>{e.user_name} · {date(e.created_at)}</Text>{e.evidence_id?<EvidenceThumbnail id={e.evidence_id}/>:<Text style={styles.small}>Sin evidencia fotográfica</Text>}</Card>):<Empty icon="file-text" title="Sin gastos en este rango" text="Por defecto se muestran los gastos de hoy."/>}<Text style={styles.small}>Página {page} · {count} gastos en este rango</Text>{page>1&&<Button title="Página anterior" disabled={busy} variant="outline" onPress={()=>run(()=>listLoad(page-1))}/>} {page*30<count&&<Button title="Página siguiente" disabled={busy} variant="outline" onPress={()=>run(()=>listLoad(page+1))}/>}</Section>
  </>:<Empty icon="inbox" title="Abre tu caja" text="Necesitas una caja abierta para registrar gastos."/>}
 </Page>;
}
