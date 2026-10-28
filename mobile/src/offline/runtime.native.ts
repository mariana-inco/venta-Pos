import * as SQLite from 'expo-sqlite';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as Network from 'expo-network';
import * as TaskManager from 'expo-task-manager';
import * as BackgroundTask from 'expo-background-task';
import {AppState} from 'react-native';
import {LocalStore} from './store';
import {API_URL,ApiError,remote} from '../transport';
import type {User} from '../types';
import {printerConfig} from '../printing/printer';
import {outputLocalDocument} from '../printing/documents';
export type SyncStatus={device_id?:string;pending:number;blocked:number;error:string|null;last_sync:string|null;catalog_ready:boolean;running:boolean;online:boolean;notice?:string|null};
export const offlineEnabled=true;
let instance:Promise<LocalStore>|null=null;
let prefix='';
let running:Promise<void>|null=null;
let online=true,lastError:string|null=null,notice:string|null=null;
const listeners=new Set<(s:SyncStatus)=>void>();
const TASK='venta-pos-sync-v1';
async function store(){
 if(!instance)instance=(async()=>{
  prefix='pos-'+(await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,API_URL)).slice(0,20);
  const db=SQLite.openDatabaseSync(prefix+'.sqlite');
  const adapter={exec:(sql:string)=>db.execSync(sql),run:(sql:string,...args:any[])=>db.runSync(sql,...args),get:(sql:string,...args:any[])=>db.getFirstSync<any>(sql,...args),all:(sql:string,...args:any[])=>db.getAllSync<any>(sql,...args)};
  return new LocalStore(adapter,()=>Crypto.randomUUID());
 })();
 return instance;
}
async function emit(){const s=await store();const status={...s.status(),running:!!running,online,error:lastError||s.status().error,notice};for(const listener of listeners)listener(status);}
const grantKey=(userId:string)=>`${prefix}-grant-${userId}`;
export async function activateLocal(user:User,token:string){
 const s=await store();
 const grant=await remote<{token:string}>('/devices/register','POST',{device_id:s.deviceId,name:'POS Android'},token);
 await SecureStore.setItemAsync(grantKey(user.id),grant.token);
 s.profile({...user,blocked:false});
 // A valid catalogue is mandatory before first offline use; never claim ready early.
 const catalog=await remote<any>('/sync/catalog','GET',undefined,grant.token);
 s.applyCatalog(catalog);
 await SecureStore.setItemAsync(prefix+'-active',JSON.stringify(user));
 try{await BackgroundTask.registerTaskAsync(TASK,{minimumInterval:15});}catch{notice='Android no habilitó la tarea de fondo; sincronizaremos al abrir la app y mientras esté activa.';}
 void syncNow();
}
export async function restoreLocal():Promise<User|null>{
 const s=await store(),value=await SecureStore.getItemAsync(prefix+'-active');if(!value)return null;
 const user=JSON.parse(value) as User,profile=s.get('profile',user.id);
 if(!profile||profile.blocked||!s.catalog)return null;
 return user;
}
export async function forgetLocal(){await store();await SecureStore.deleteItemAsync(prefix+'-active');}
export async function localRequest(user:User,path:string,method:string,body?:unknown){
 const s=await store();
 if(path==='/sales'&&method==='POST'&&body&&typeof body==='object'&&'session_id' in body&&!s.get('session',String(body.session_id)))return {handled:false};
 let value;
 try{value=s.request(user,path,method,body);}catch(e){if(e instanceof Error && 'status' in e)throw new ApiError(e.message,Number(e.status),`${method} ${path}`);throw e;}
 if(value===undefined)return {handled:false};
 if(path==='/settings'&&method==='GET')value={...value,paper_width:(await printerConfig())?.width||58};
 if(method!=='GET'){void emit();void syncNow();}
 return {handled:true,value};
}
export async function syncNow(){
 if(running)return running;
 running=(async()=>{
  const s=await store();lastError=null;
  try{
   // Ordered across users on this physical device: customer -> cash -> sale -> close.
   // Keep every event until an explicit acknowledgement, including HTTP 401 and 409.
   for(const row of s.pending()){
    const grant=await SecureStore.getItemAsync(grantKey(row.actor_id));
    if(!grant){s.block(row.id,'Inicia sesión con el usuario que creó esta operación para sincronizarla.');break;}
    try{
     const result=await remote<any>('/sync/events','POST',{events:[row.event]},grant,10000);
     online=true;
     for(const ack of result.accepted||[])s.acknowledge(ack.event_id,ack);
     if(result.rejected){s.block(row.id,result.rejected.error);break;}
    }catch(e){
     if(e instanceof ApiError&&e.status===401){const profile=s.get('profile',row.actor_id);if(profile)s.profile({...profile,blocked:true});s.block(row.id,'Acceso revocado o vencido: inicia sesión nuevamente.');}
     throw e;
    }
   }
   const active=await restoreLocal();
   const profiles=active?[active,...s.profiles().filter((u:User)=>u.id!==active.id)]:s.profiles();
   for(const user of profiles){
    const grant=await SecureStore.getItemAsync(grantKey(user.id));if(!grant||s.get('profile',user.id)?.blocked)continue;
    try{const catalog=await remote<any>('/sync/catalog','GET',undefined,grant,10000);s.applyCatalog(catalog);online=true;break;}
    catch(e){if(e instanceof ApiError&&e.status===401){s.profile({...user,blocked:true});continue;}throw e;}
   }
  }catch(e){online=!(e instanceof ApiError&&e.status===0);lastError=e instanceof Error?e.message:'No se pudo sincronizar.';}
 })();
 void emit();
 try{await running;}finally{running=null;await emit();}
}
export function subscribeSync(listener:(s:SyncStatus)=>void){listeners.add(listener);void emit();return ()=>{listeners.delete(listener);};}
export function startSync(){
 void syncNow();
 const timer=setInterval(()=>{if(AppState.currentState==='active')void syncNow();},30000);
 const app=AppState.addEventListener('change',state=>{if(state==='active')void syncNow();});
 const network=Network.addNetworkStateListener(state=>{online=!!state.isConnected;if(state.isConnected)void syncNow();else void emit();});
 return ()=>{clearInterval(timer);app.remove();network.remove();};
}
if(!TaskManager.isTaskDefined(TASK))TaskManager.defineTask(TASK,async()=>{await syncNow();return lastError?BackgroundTask.BackgroundTaskResult.Failed:BackgroundTask.BackgroundTaskResult.Success;});
export async function localDocument(path:string,width:58|80,action:'share'|'print'|'open'){
 const s=await store(),user=await restoreLocal();if(!user)throw new Error('Inicia sesión para consultar comprobantes.');
 const record=s.request(user,path,'GET');if(!record)throw new Error('Comprobante no encontrado en este dispositivo.');
 await outputLocalDocument(s,record,path.startsWith('/sales/')?'sale':'closure',width,action);
}

export async function readDraftRequest(userId:string):Promise<Record<string,unknown>|null>{return (await store()).meta('pending-'+userId);}
export async function saveDraftRequest(userId:string,body:Record<string,unknown>|null){(await store()).setMeta('pending-'+userId,body);}

export async function cacheLegacySale(sale:any){const s=await store();s.put('sale',{...sale,sync_status:'synced',method:sale.payments?.[0]?.method,platform_name:sale.payments?.[0]?.platform_name});}
