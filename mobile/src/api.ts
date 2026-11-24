import * as SecureStore from 'expo-secure-store';
import {Platform} from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import type {User} from './types';
import {printerConfig,stopReceiver} from './printing/printer';
let token='';
export {API_URL,ApiError} from './transport';
import {API_URL,ApiError,remote} from './transport';
import {activateLocal,restoreLocal,forgetLocal,localRequest,localDocument,offlineEnabled,syncNow,readDraftRequest,saveDraftRequest,cacheLegacySale,cachedPrintRecord} from './offline/runtime';
let currentUser:User|null=null;
export async function api<T>(path:string,method='GET',body?:unknown):Promise<T>{
 if(offlineEnabled&&currentUser){const local=await localRequest(currentUser,path,method,body);if(local.handled)return local.value as T;}
 const result=await remote<T>(path,method,body,token);
 if(offlineEnabled&&path==='/settings'&&method==='GET')return {...result,paper_width:(await printerConfig())?.width||58} as T;
 if(offlineEnabled&&method==='POST'&&path==='/sales')await cacheLegacySale(result);
 if(offlineEnabled&&method!=='GET')await syncNow();
 return result;
}
export async function restoreSession():Promise<User|null>{
 if(offlineEnabled){token=await SecureStore.getItemAsync('pos-token')||'';currentUser=await restoreLocal();return currentUser;}
 token=Platform.OS==='web'?(sessionStorage.getItem('pos-token')||''):(await SecureStore.getItemAsync('pos-token')||'');
 if(!token)return null;
 try{currentUser=await api<User>('/me');return currentUser;}catch(e){if(e instanceof ApiError&&e.status===401){await forgetSession();return null;}throw e;}
}
export async function signIn(username:string,password:string){
 const result=await api<{token:string;user:User}>('/auth/login','POST',{username,password});token=result.token;
 if(offlineEnabled)await activateLocal(result.user,token);
 if(Platform.OS==='web'){
  const {generation}=await remote<{generation:string}>('/data-generation');
  const key='pos-generation-'+API_URL,previous=localStorage.getItem(key)||'initial';
  if(previous!==generation)for(const pendingKey of Object.keys(localStorage))if(pendingKey.startsWith('pos-pending-'))localStorage.removeItem(pendingKey);
  localStorage.setItem(key,generation);
 }
 if(Platform.OS==='web')sessionStorage.setItem('pos-token',token);else await SecureStore.setItemAsync('pos-token',token);currentUser=result.user;return result.user;
}
export async function forgetSession(){if(Platform.OS==='android')await stopReceiver();currentUser=null;token='';if(offlineEnabled)await forgetLocal();if(Platform.OS==='web')sessionStorage.removeItem('pos-token');else await SecureStore.deleteItemAsync('pos-token');}
export async function signOut(){if(offlineEnabled){try{await remote('/auth/logout','POST',{},token,3000);}catch{}await forgetSession();return;}await api('/auth/logout','POST',{});await forgetSession();}
/** Descarga el PDF guardado de la venta/cierre (nunca se recalcula) y lo abre, comparte o imprime. */
export async function documentAction(path:string,width:58|80,action:'share'|'print'|'open'){
 if(action==='print')action='share';
 if(offlineEnabled&&path.startsWith('/sales/')){const local=await cachedPrintRecord(path);if(local&&(local.sync_status==='pending'||local.reservation_id)){await localDocument(path,width,action);return;}}
 // Account statements and new route documents are rendered by the server.
 const url=`${API_URL}/api${path}/pdf?width=${width}`;const name=`comprobante-${path.split('/').pop()?.slice(0,8)}-${width}mm.pdf`;
 if(Platform.OS==='web'){
  const response=await fetch(url,{headers:{Authorization:`Bearer ${token}`}});if(!response.ok)throw new ApiError('No se pudo descargar el comprobante. Inténtalo nuevamente.',response.status,`HTTP ${response.status} · GET ${path}/pdf`);
  const blob=await response.blob();
  if(action==='share'){const file=new File([blob],name,{type:'application/pdf'});if(navigator.canShare?.({files:[file]})){try{await navigator.share({files:[file],title:'Comprobante'});}catch(e){if((e as Error).name!=='AbortError')throw e;}return;}}
  const uri=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=uri;a.download=name;a.click();
  setTimeout(()=>URL.revokeObjectURL(uri),60000);return;
 }
 const result=await FileSystem.downloadAsync(url,FileSystem.cacheDirectory+name,{headers:{Authorization:`Bearer ${token}`}});
 if(result.status!==200)throw new ApiError('No se pudo descargar el comprobante. Revisa la conexión e inténtalo nuevamente.',result.status,`HTTP ${result.status} · GET ${path}/pdf`);
 {if(!await Sharing.isAvailableAsync())throw new Error('Este celular no permite compartir archivos.');await Sharing.shareAsync(result.uri,{mimeType:'application/pdf',UTI:'com.adobe.pdf',dialogTitle:action==='open'?'Abrir o guardar comprobante':'Compartir comprobante'});}
}
export async function readPending(userId:string):Promise<Record<string,unknown>|null>{
 if(offlineEnabled){const local=await readDraftRequest(userId);if(local)return local;const legacy=await SecureStore.getItemAsync(`pos-pending-${userId}`);if(legacy){const pending=JSON.parse(legacy);await saveDraftRequest(userId,pending);await SecureStore.deleteItemAsync(`pos-pending-${userId}`);return pending;}return null;}
 const key=`pos-pending-${userId}`;const value=Platform.OS==='web'?localStorage.getItem(key):await SecureStore.getItemAsync(key);return value?JSON.parse(value):null;
}
export async function savePending(userId:string,body:Record<string,unknown>|null){
 if(offlineEnabled)return saveDraftRequest(userId,body);
 const key=`pos-pending-${userId}`;
 if(Platform.OS==='web'){if(body)localStorage.setItem(key,JSON.stringify(body));else localStorage.removeItem(key);}
 else{if(body)await SecureStore.setItemAsync(key,JSON.stringify(body));else await SecureStore.deleteItemAsync(key);}
}

/** Authenticated customer statements/reports; no public URLs or session tokens in links. */
export async function downloadPdf(path:string,name='estado-de-cuenta.pdf'){
 const url=API_URL+'/api'+path;
 if(Platform.OS==='web'){
  const response=await fetch(url,{headers:{Authorization:`Bearer ${token}`}});if(!response.ok){const error=await response.json().catch(()=>({}));throw new ApiError(error.error||'No se pudo descargar el PDF.',response.status,'GET '+path);}
  const uri=URL.createObjectURL(await response.blob()),a=document.createElement('a');a.href=uri;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(uri),60000);return;
 }
 const result=await FileSystem.downloadAsync(url,FileSystem.cacheDirectory+name,{headers:{Authorization:`Bearer ${token}`}});if(result.status!==200)throw new Error('No se pudo descargar el estado de cuenta. Revisa las fechas y la conexión.');
 await Sharing.shareAsync(result.uri,{mimeType:'application/pdf',dialogTitle:'Estado de cuenta'});
}

export async function uploadExpenseEvidence(uri:string,sessionId:string,requestKey:string,onProgress:(value:number)=>void):Promise<string>{
 const url=API_URL+'/api/expenses/evidence?'+new URLSearchParams({session_id:sessionId,request_key:requestKey});
 if(Platform.OS!=='web'){
  const task=FileSystem.createUploadTask(url,uri,{httpMethod:'POST',uploadType:FileSystem.FileSystemUploadType.BINARY_CONTENT,headers:{Authorization:`Bearer ${token}`,'Content-Type':'image/jpeg'}},p=>onProgress(p.totalBytesExpectedToSend?Math.round(p.totalBytesSent*100/p.totalBytesExpectedToSend):0));
  const result=await task.uploadAsync();if(!result)throw new Error('Carga cancelada; puedes reintentar.');const value=JSON.parse(result.body);if(result.status!==200)throw new ApiError(value.error||'No se pudo cargar la evidencia.',result.status);onProgress(100);return value.id;
 }
 const blob=await(await fetch(uri)).blob();
 return new Promise((resolve,reject)=>{const xhr=new XMLHttpRequest();xhr.open('POST',url);xhr.setRequestHeader('Authorization','Bearer '+token);xhr.setRequestHeader('Content-Type',blob.type||'image/jpeg');xhr.upload.onprogress=p=>{if(p.lengthComputable)onProgress(Math.round(p.loaded*100/p.total));};xhr.onerror=()=>reject(new Error('Se perdió la conexión. Reintenta la carga.'));xhr.onload=()=>{const value=JSON.parse(xhr.responseText);if(xhr.status!==200)return reject(new ApiError(value.error||'No se pudo cargar la evidencia.',xhr.status));resolve(value.id);};xhr.send(blob);});
}
export async function evidenceImage(id:string,size:'thumbnail'|'image'):Promise<string>{
 const url=API_URL+'/api/expenses/evidence/'+encodeURIComponent(id)+'/'+size;
 if(Platform.OS!=='web'){const uri=FileSystem.cacheDirectory+'evidence-'+id+'-'+size+'.jpg';const r=await FileSystem.downloadAsync(url,uri,{headers:{Authorization:'Bearer '+token}});if(r.status!==200)throw new ApiError('No se pudo consultar la evidencia.',r.status);return r.uri;}
 const r=await fetch(url,{headers:{Authorization:'Bearer '+token}});if(!r.ok)throw new ApiError('No se pudo consultar la evidencia.',r.status);return URL.createObjectURL(await r.blob());
}
