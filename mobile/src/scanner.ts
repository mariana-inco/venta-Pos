import {Platform} from 'react-native';
import {requireOptionalNativeModule} from 'expo-modules-core';
type Scanner={setScannerEnabled:(enabled:boolean)=>Promise<void>;addListener:(event:'barcodeScan',listener:(event:{code:string})=>void)=>{remove:()=>void}};
const native=Platform.OS==='android'?requireOptionalNativeModule<Scanner>('PosPrinter'):null;
export const scannerAvailable=!!native;
export async function enableScanner(enabled:boolean){await native?.setScannerEnabled(enabled);}
export function onBarcode(listener:(code:string)=>void){return native?.addListener('barcodeScan',event=>listener(event.code));}
