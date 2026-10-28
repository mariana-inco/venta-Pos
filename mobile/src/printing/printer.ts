import {Platform,PermissionsAndroid} from 'react-native';
import {requireOptionalNativeModule} from 'expo-modules-core';
import * as SecureStore from 'expo-secure-store';
export type Printer={address:string;name:string};
export type PrinterConfig=Printer&{width:58|80;codePage:number;charset:string};
type NativePrinter={pairedDevices:()=>Promise<Printer[]>;print:(address:string,text:string,codePage:number,charset:string)=>Promise<void>};
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
let tail:Promise<unknown>=Promise.resolve();
export async function printText(text:string){
 const config=await printerConfig();if(!config)throw new Error('Selecciona una impresora Bluetooth en Perfil antes de imprimir.');
 const module=await permitted();
 const job=tail.catch(()=>{}).then(()=>module.print(config.address,text,config.codePage,config.charset));tail=job;await job;
}
export async function testPrinter(){await printText("DANNY'S POS\nPRUEBA DE IMPRESIÓN\nÁÉÍÓÚ áéíóú Ñ ñ\nPollo 1,5 kg\nTotal $ 36.000\nSin venta registrada\n");}
