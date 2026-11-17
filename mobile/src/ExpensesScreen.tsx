import React,{useEffect,useRef,useState} from 'react';
import {Text} from 'react-native';
import * as Crypto from 'expo-crypto';
import {api} from './api';
import {Button,Card,Empty,Field,Header,InfoRow,Page,Section,cop,date,moneyToCents,normalizeMoney,styles} from './ui';
import {SearchSelect} from './SearchSelect';
import type {CashSession,User} from './types';
import type {Run} from '../App';
export function ExpensesScreen({user,sessions,run,busy,refresh,onBack}:{user:User;sessions:CashSession[];run:Run;busy:boolean;refresh:()=>Promise<void>;onBack:()=>void}){
 const choices=sessions.filter(s=>user.role==='admin'||s.opened_by===user.id);
 const [sessionId,setSessionId]=useState(choices.find(s=>s.opened_by===user.id&&s.state==='open')?.id||choices[0]?.id||''),[data,setData]=useState<any>(null),[description,setDescription]=useState(''),[amount,setAmount]=useState('');
 const request=useRef<{signature:string;key:string}|null>(null),session=choices.find(s=>s.id===sessionId);
 async function load(){setData(sessionId?await api('/cash-sessions/'+sessionId+'/expenses'):null);}
 useEffect(()=>{setData(null);run(load);},[sessionId]);
 const cents=moneyToCents(amount),canAdd=session?.state==='open'&&session.opened_by===user.id;
 async function save(){
  const body={session_id:sessionId,description:description.trim(),amount:normalizeMoney(amount)},signature=JSON.stringify(body);
  if(request.current?.signature!==signature)request.current={signature,key:Crypto.randomUUID()};
  await api('/expenses','POST',{...body,request_key:request.current.key});
  request.current=null;setDescription('');setAmount('');await load();await refresh();
 }
 return <Page onRefresh={()=>run(load)}><Header title="Gastos" subtitle="Pagados en efectivo de la caja" onBack={onBack} backLabel="Volver a Más"/>
  {choices.length?<>
   <Card><SearchSelect label="Caja" items={choices.map(s=>({id:s.id,name:`Caja #${s.number||''} · ${s.opener_name} · ${s.state==='open'?'Abierta':'Cerrada'} · ${date(s.opened_at)}`}))} value={sessionId} onChange={setSessionId}/>{data&&<><InfoRow label="Efectivo disponible" value={cop(data.available_cash_cents)} strong/><InfoRow label="Total de gastos" value={cop(data.total_cents)}/></>}</Card>
   {canAdd?<Card><Field label="¿Qué gasto fue?" value={description} onChange={setDescription} placeholder="Ej. Transporte" testID="expense-description"/><Field label="Valor del gasto" kind="decimal" prefix="$" value={amount} onChange={setAmount} placeholder="0" testID="expense-amount"/>
    <Button title="Guardar gasto" icon="minus-circle" disabled={busy||!data||!description.trim()||description.trim().length>240||cents===null||cents<=0||cents>(data?.available_cash_cents??0)} onPress={()=>run(save,'Gasto guardado')} testID="save-expense"/>
    {cents!==null&&cents>(data?.available_cash_cents??0)&&<Text style={styles.small}>El gasto supera el efectivo disponible.</Text>}
   </Card>:<Text style={styles.small}>Solo puedes agregar gastos en tu propia caja abierta.</Text>}
   <Section title="Resumen de gastos">{data?.expenses?.length?data.expenses.map((e:any)=><Card key={e.id}><InfoRow label={e.description} value={cop(e.amount_cents)} strong/><Text style={styles.small}>{e.user_name} · {date(e.created_at)}</Text></Card>):<Empty icon="file-text" title="Sin gastos" text="Los gastos de esta apertura aparecerán aquí."/>}</Section>
  </>:<Empty icon="inbox" title="Abre tu caja" text="Necesitas una caja abierta para registrar gastos."/>}
 </Page>;
}
