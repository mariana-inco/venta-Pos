import {Asset} from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
const cached:Partial<Record<'sale'|'closure',Promise<string>>>={};
export function receiptLogo(kind:'sale'|'closure'='sale'){
 if(!cached[kind])cached[kind]=(async()=>{
  const asset=Asset.fromModule(kind==='sale'?require('../../assets/brand/receipt-logo.png'):require('../../assets/brand/dok-pollo-mc.png'));
  await asset.downloadAsync();
  return await FileSystem.readAsStringAsync(asset.localUri||asset.uri,{encoding:FileSystem.EncodingType.Base64});
 })().catch(error=>{delete cached[kind];throw error;});
 return cached[kind]!;
}
