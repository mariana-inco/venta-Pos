import React,{useEffect,useState} from 'react';
import {Text,View} from 'react-native';
import {Feather} from '@expo/vector-icons';
import {api} from './api';
import {Badge,Button,Card,Confirm,Empty,Header,InfoRow,ListRow,Page,Section,colors,cop,date,styles} from './ui';
import {InventorySummary} from './ResultsScreen';
import type {User} from './types';
import type {Run} from '../App';
const STEPS=['Guarda las ventas y el inventario de la jornada.','Deja en cero TODO el stock de la ruta.','No se pueden registrar más ventas hoy en esta ruta.','La caja se cierra aparte, desde Caja.'];
export function RouteClosureScreen({user,run,busy,refresh,onBack}:{user:User;run:Run;busy:boolean;refresh:()=>Promise<void>;onBack?:()=>void}){
 const [state,setState]=useState<any>(null),[confirm,setConfirm]=useState(false),[history,setHistory]=useState<any[]>([]),[selected,setSelected]=useState<any>(null);
 async function load(){setState(await api('/route/closure'));if(user.role==='admin')setHistory(await api('/daily-closures'));}useEffect(()=>{run(load);},[]);
 const closure=selected||state?.closure,closed=!!state?.closure;
 return <Page onRefresh={()=>run(load)}>
  <Header title="Cierre de ruta" onBack={onBack} backLabel="Volver a Más"/>
  <Card style={{gap:10}}>
   <View style={styles.row}><Text style={[styles.h2,{flex:1}]}>{state?.route?.name||'Sin ruta asignada'}</Text>{state?.route&&<Badge text={closed?'Cerrada':'Abierta'} tone={closed?'gray':'green'} icon={closed?'lock':'unlock'}/>}</View>
   <InfoRow label="Responsable" value={user.name}/>
   {closed?<Text style={styles.h2}>Jornada cerrada</Text>:state?.route?<>
    <Text style={styles.label}>Al cerrar la ruta:</Text>
    {STEPS.map(s=><View key={s} style={[styles.row,{justifyContent:'flex-start',alignItems:'flex-start',gap:8}]}><Feather name="check" size={16} color={colors.accent} style={{marginTop:2}}/><Text style={[styles.small,{flex:1}]}>{s}</Text></View>)}
    <Button title="Cerrar mi ruta" icon="check-square" disabled={busy} onPress={()=>setConfirm(true)}/>
   </>:<Text style={styles.small}>Pide al administrador que te asigne una ruta para poder cerrarla.</Text>}
  </Card>
  {closure&&<Section title={selected?'Cierre seleccionado':'Resumen del cierre'}>
   {selected&&<Button title="Ocultar cierre" icon="x" variant="ghost" style={{alignSelf:'flex-start'}} onPress={()=>setSelected(null)}/>}
   <Card>
    <Text style={styles.h2}>{closure.snapshot.route.name} · {closure.day}</Text>
    <InfoRow label="Responsable" value={closure.snapshot.responsible?.name||'Responsable no disponible'}/>
    <InfoRow label="Fecha" value={date(closure.created_at)}/>
    <InfoRow label="Total vendido" value={cop(closure.snapshot.total_cents??closure.snapshot.financial.total_cents)} strong/>
    <View style={styles.divider}/>
    <InventorySummary value={closure.snapshot.inventory}/>
   </Card>
  </Section>}
  {user.role==='admin'&&<Section title="Cierres anteriores">{history.length?<View style={{gap:8}}>{history.map(c=><ListRow key={c.id} icon="check-square" title={c.day+' · '+c.snapshot.route.name} subtitle={c.snapshot.responsible?.name} onPress={()=>setSelected(c)}/>)}</View>:<Empty icon="check-square" title="Sin cierres anteriores" text="Los cierres de todas las rutas aparecerán aquí."/>}</Section>}
  <Confirm visible={confirm} title="¿Cerrar la ruta?" message="Se guardarán las ventas y el inventario de la jornada. Después, TODO el stock de tu ruta quedará en cero y no se podrán registrar más ventas hoy. El cierre de caja es independiente." confirmText="Confirmar cierre de ruta" busy={busy} onCancel={()=>setConfirm(false)} onConfirm={()=>run(async()=>{await api('/route/close','POST',{});setConfirm(false);setSelected(null);await load();await refresh();},'Ruta cerrada')}/>
 </Page>;
}
