export const API_URL=(process.env.EXPO_PUBLIC_API_URL||'http://localhost:4317').replace(/\/$/,'');
export class ApiError extends Error {constructor(message:string,public status:number,public detail=''){super(message);}}
export async function remote<T>(path:string,method='GET',body?:unknown,token='',timeout=15000):Promise<T>{
 let response:Response;
 try{response=await fetch(API_URL+'/api'+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(timeout)});}
 catch(e){throw new ApiError('No hay conexión con el servidor. Los datos guardados en este dispositivo se conservan.',0,`${method} ${path} · ${e instanceof Error?e.message:String(e)}`);}
 let data:any=null;try{data=await response.json();}catch{}
 if(!response.ok)throw new ApiError(data?.error||(response.status>=500?'El servidor no pudo completar la operación.':'No se pudo completar la operación.'),response.status,`${method} ${path}`);
 if(data===null)throw new ApiError('La respuesta del servidor no es válida.',502,`${method} ${path}`);
 return data;
}
