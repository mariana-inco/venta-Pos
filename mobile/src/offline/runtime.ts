// Browser uses the cloud directly. Android resolves runtime.native.ts.
import type {User} from '../types';
export type SyncStatus={device_id?:string;pending:number;blocked:number;error:string|null;last_sync:string|null;catalog_ready:boolean;running:boolean;online:boolean;notice?:string|null};
export const offlineEnabled=false;
export async function activateLocal(_user:User,_token:string):Promise<void>{}
export async function restoreLocal():Promise<User|null>{return null;}
export async function forgetLocal():Promise<void>{}
export async function localRequest(_user:User,_path:string,_method:string,_body?:unknown):Promise<{handled:boolean;value?:any}>{return {handled:false};}
export async function syncNow():Promise<void>{}
export function subscribeSync(_listener:(s:SyncStatus)=>void){return ()=>{};}
export function startSync(){return ()=>{};}
export async function localDocument(_path:string,_width:58|80,_action:'share'|'print'|'open'):Promise<void>{throw new Error('Documento local disponible en Android.');}

export async function readDraftRequest(_userId:string):Promise<Record<string,unknown>|null>{return null;}
export async function saveDraftRequest(_userId:string,_body:Record<string,unknown>|null):Promise<void>{}

export async function cacheLegacySale(_sale:any):Promise<void>{}
