import * as SecureStore from 'expo-secure-store';
import {Platform} from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as Print from 'expo-print';
import type {User} from './types';
let token='';
export {API_URL,ApiError} from './transport';
import {API_URL,ApiError,remote} from './transport';
import {activateLocal,restoreLocal,forgetLocal,localRequest,localDocument,offlineEnabled,syncNow,readDraftRequest,saveDraftRequest,cacheLegacySale} from './offline/runtime';
let currentUser:User|null=null;
export async function api<T>(path:string,method='GET',body?:unknown):Promise<T>{
 if(offlineEnabled&&currentUser){const local=await localRequest(currentUser,path,method,body);if(local.handled)return local.value as T;}
 const result=await remote<T>(path,method,body,token);
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
 if(Platform.OS==='web')sessionStorage.setItem('pos-token',token);else await SecureStore.setItemAsync('pos-token',token);currentUser=result.user;return result.user;
}
export async function forgetSession(){currentUser=null;token='';if(offlineEnabled)await forgetLocal();if(Platform.OS==='web')sessionStorage.removeItem('pos-token');else await SecureStore.deleteItemAsync('pos-token');}
export async function signOut(){if(offlineEnabled){try{await remote('/auth/logout','POST',{},token,3000);}catch{}await forgetSession();return;}await api('/auth/logout','POST',{});await forgetSession();}
/** Descarga el PDF guardado de la venta/cierre (nunca se recalcula) y lo abre, comparte o imprime. */
export async function documentAction(path:string,width:58|80,action:'share'|'print'|'open'){
 if(offlineEnabled)return localDocument(path,width,action);
 const url=`${API_URL}/api${path}/pdf?width=${width}`;const name=`comprobante-${path.split('/').pop()?.slice(0,8)}-${width}mm.pdf`;
 if(Platform.OS==='web'){
  const response=await fetch(url,{headers:{Authorization:`Bearer ${token}`}});if(!response.ok)throw new ApiError('No se pudo descargar el comprobante. Inténtalo nuevamente.',response.status,`HTTP ${response.status} · GET ${path}/pdf`);
  const blob=await response.blob();
  if(action==='share'){const file=new File([blob],name,{type:'application/pdf'});if(navigator.canShare?.({files:[file]})){try{await navigator.share({files:[file],title:'Comprobante'});}catch(e){if((e as Error).name!=='AbortError')throw e;}return;}}
  const uri=URL.createObjectURL(blob);
  // Imprimir abre el visor PDF del navegador (botón imprimir al 100 %); abrir/compartir sin soporte descarga el archivo.
  // Si el navegador bloquea la ventana emergente, se descarga el archivo para imprimirlo desde el visor.
  if(action!=='print'||!window.open(uri,'_blank')){const a=document.createElement('a');a.href=uri;a.download=name;a.click();}
  setTimeout(()=>URL.revokeObjectURL(uri),60000);return;
 }
 const result=await FileSystem.downloadAsync(url,FileSystem.cacheDirectory+name,{headers:{Authorization:`Bearer ${token}`}});
 if(result.status!==200)throw new ApiError('No se pudo descargar el comprobante. Revisa la conexión e inténtalo nuevamente.',result.status,`HTTP ${result.status} · GET ${path}/pdf`);
 if(action==='print')await Print.printAsync({uri:result.uri});
 else{if(!await Sharing.isAvailableAsync())throw new Error('Este celular no permite compartir archivos.');await Sharing.shareAsync(result.uri,{mimeType:'application/pdf',UTI:'com.adobe.pdf',dialogTitle:action==='open'?'Abrir o guardar comprobante':'Compartir comprobante'});}
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
