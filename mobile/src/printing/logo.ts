import {Asset} from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
let cached:Promise<string>|null=null;
export function receiptLogo(){
 if(!cached)cached=(async()=>{
  const asset=Asset.fromModule(require('../../assets/brand/dok-pollo-mc.png'));
  await asset.downloadAsync();
  return await FileSystem.readAsStringAsync(asset.localUri||asset.uri,{encoding:FileSystem.EncodingType.Base64});
 })().catch(error=>{cached=null;throw error;});
 return cached;
}
