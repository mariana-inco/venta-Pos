import {receiptLogo} from './logo';
import {Platform,PermissionsAndroid} from 'react-native';
import {requireOptionalNativeModule} from 'expo-modules-core';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
export type Printer={address:string;name:string};
export type PrinterConfig=Printer&{width:58|80;codePage:number;charset:string;transport?:'bluetooth'|'h10s'|'internal'};
export type ReceiverStatus={active:boolean;internalAvailable:boolean;received:number;error:string|null};
type NativePrinter={pairedDevices:()=>Promise<Printer[]>;print:(address:string,text:string,codePage:number,charset:string,logo:string)=>Promise<void>;printInternal:(text:string,logo:string)=>Promise<void>;printToH10s:(address:string,id:string,text:string,logo:string)=>Promise<void>;receiverStatus:()=>Promise<ReceiverStatus>;startReceiver:()=>Promise<ReceiverStatus>;stopReceiver:()=>Promise<ReceiverStatus>};
const native=Platform.OS==='android'?requireOptionalNativeModule<NativePrinter>('PosPrinter'):null;
const KEY='pos-bluetooth-printer-v1';
export const printerAvailable=!!native;
export async function printerConfig():Promise<PrinterConfig|null>{
 if(Platform.OS!=='android')return null;const raw=await SecureStore.getItemAsync(KEY);return raw?JSON.parse(raw):null;
}
export async function savePrinter(config:PrinterConfig){await SecureStore.setItemAsync(KEY,JSON.stringify(config));}
async function permitted(){
 if(!native)throw new Error('La impresión Bluetooth requiere el APK Android de esta app. No está disponible en Expo Go ni en navegador.');
 if(Number(Platform.Version)>=31){const result=await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT);if(result!==PermissionsAndroid.RESULTS.GRANTED)throw new Error('Permite el acceso a dispositivos cercanos para conectar la impresora.');}
 return native;
}
export async function pairedPrinters(){return (await permitted()).pairedDevices();}
export async function receiverStatus():Promise<ReceiverStatus>{return native?.receiverStatus?native.receiverStatus():{active:false,internalAvailable:false,received:0,error:null};}
export async function startReceiver(){return (await permitted()).startReceiver();}
export async function stopReceiver(){if(!native)return receiverStatus();return native.stopReceiver();}
export async function useInternalPrinter(){await savePrinter({address:'internal-h10s',name:'Impresora integrada H10S',transport:'internal',width:58,codePage:2,charset:'IBM850'});}
let tail:Promise<unknown>=Promise.resolve();
export async function printText(text:string,withLogo=false){
 const config=await printerConfig();if(!config)throw new Error('Selecciona una impresora Bluetooth en Perfil antes de imprimir.');
 const module=config.transport==='internal'?native:await permitted();
 if(!module)throw new Error('Instala el APK Android actualizado.');
 const logo=withLogo?await receiptLogo():'';
 const id=Crypto.randomUUID();
 const job=tail.catch(()=>{}).then(()=>config.transport==='internal'?module.printInternal(text,logo):config.transport==='h10s'?module.printToH10s(config.address,id,text,logo):module.print(config.address,text,config.codePage,config.charset,logo));tail=job;await job;
}
export async function testPrinter(){await printText("DOK POLLO MC\nPRUEBA DE IMPRESIÓN\nÁÉÍÓÚ áéíóú Ñ ñ\nPollo 1,5 kg\nTotal $ 36.000\nSin venta registrada\n",true);}
