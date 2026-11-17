import React,{useEffect,useState} from 'react';
import {Text,View} from 'react-native';
import {api} from './api';
import {Badge,Button,Empty,Field,Header,ListRow,Page,SearchBar,Sheet,styles,normalizeSearch} from './ui';
import type {User} from './types';
import type {Run} from '../App';
export function RoutesScreen({user,run,busy,onBack}:{user:User;run:Run;busy:boolean;onBack?:()=>void}){
 const admin=user.role==='admin';
 const [routes,setRoutes]=useState<any[]>([]),[query,setQuery]=useState(''),[editing,setEditing]=useState(''),[name,setName]=useState(''),[users,setUsers]=useState<any[]>([]);
 async function load(){setRoutes(await api('/routes'));}useEffect(()=>{run(load);},[]);
 async function open(r:any){setEditing(r?.id||'new');setName(r?.name||'');setUsers(r&&admin?await api('/routes/'+r.id+'/users'):[]);}
 const list=routes.filter(r=>normalizeSearch(r.name).includes(normalizeSearch(query)));
 return <Page onRefresh={()=>run(load)}>
  <Header title="Rutas" subtitle={admin?`${routes.filter(r=>r.active).length} activas`:'Tu ruta asignada'} onBack={onBack} backLabel="Volver a Más" right={admin?<Button title="Crear ruta" icon="plus" size="sm" onPress={()=>run(()=>open(null))}/>:undefined}/>
  {routes.length>5&&<SearchBar value={query} onChange={setQuery} placeholder="Buscar ruta"/>}
  {list.length?<View style={{gap:8}}>{list.map(r=><ListRow key={r.id} icon="map" tone={r.active?'accent':'gray'} title={r.name} subtitle={r.active?'Activa':'Inactiva'} onPress={()=>run(()=>open(r))}/>)}</View>
   :<Empty icon="map" title={query?'Sin resultados':admin?'Aún no hay rutas':'Sin ruta asignada'} text={query?'Prueba con otro nombre.':admin?'Crea la primera ruta para asignarle usuarios, clientes e inventario.':'Pide al administrador que te asigne una ruta.'}/>}
  <Text style={styles.hint}>Las entregas y ajustes se administran en Inventarios y entregas.</Text>
  <Sheet visible={!!editing} title={editing==='new'?'Nueva ruta':'Ruta'} onClose={()=>setEditing('')} footer={admin?<Button title="Guardar ruta" disabled={busy||!name.trim()} onPress={()=>run(async()=>{await api('/routes'+(editing==='new'?'':'/'+editing),editing==='new'?'POST':'PUT',{name,active:routes.find(r=>r.id===editing)?.active!==0});setEditing('');await load();},'Ruta guardada')}/>:undefined}>
   {admin?<Field label="Nombre de ruta" value={name} onChange={setName}/>:<Text style={styles.h2}>{name}</Text>}
   {editing!=='new'&&admin&&<><Text style={styles.h2}>Usuarios asignados</Text>{users.length?users.map(u=><Text key={u.id} style={styles.body}>{u.name} · @{u.username}</Text>):<Text style={styles.small}>Ningún usuario asignado. Asígnalos desde Perfil › Usuarios y accesos.</Text>}</>}
   {editing!=='new'&&<Badge text={routes.find(r=>r.id===editing)?.active===0?'Inactiva':'Activa'} tone={routes.find(r=>r.id===editing)?.active===0?'gray':'green'}/>}
  </Sheet>
 </Page>;
}
