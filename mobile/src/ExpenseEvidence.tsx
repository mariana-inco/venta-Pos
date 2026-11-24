import React,{useEffect,useRef,useState} from 'react';
import {Image,Platform,Text,View,useWindowDimensions} from 'react-native';
import * as Picker from 'expo-image-picker';
import * as Manipulator from 'expo-image-manipulator';
import {evidenceImage} from './api';
import {Button,Sheet,styles} from './ui';
export async function pickEvidence(camera:boolean):Promise<string|null>{
 if(camera&&Platform.OS!=='web'&&!(await Picker.requestCameraPermissionsAsync()).granted)throw new Error('Autoriza la cámara para tomar la evidencia.');
 const result=await(camera?Picker.launchCameraAsync:Picker.launchImageLibraryAsync)({mediaTypes:['images'],quality:1,allowsEditing:false});if(result.canceled||!result.assets[0])return null;
 const asset=result.assets[0];const output=await Manipulator.manipulateAsync(asset.uri,[{resize:asset.width>=asset.height?{width:Math.min(asset.width,1600)}:{height:Math.min(asset.height,1600)}}],{compress:0.85,format:Manipulator.SaveFormat.JPEG});return output.uri;
}
export function EvidenceThumbnail({id}:{id:string}){
 const ref=useRef<React.ComponentRef<typeof View>>(null),{height}=useWindowDimensions(),[uri,setUri]=useState(''),[error,setError]=useState(''),[full,setFull]=useState(''),[visible,setVisible]=useState(false),[loading,setLoading]=useState(false);
 useEffect(()=>{let live=true,started=false;const tick=()=>ref.current?.measureInWindow((_x,y,_w,h)=>{if(!started&&h>0&&y<(Platform.OS==='web'?(window.visualViewport?.height||height):height)&&y+h>0){started=true;clearInterval(timer);void evidenceImage(id,'thumbnail').then(u=>{if(live)setUri(u);}).catch(e=>{if(live)setError(e.message);});}});const timer=setInterval(tick,400);tick();return ()=>{live=false;clearInterval(timer);};},[id,height]);
 useEffect(()=>()=>{if(Platform.OS==='web'&&uri)URL.revokeObjectURL(uri);},[uri]);useEffect(()=>()=>{if(Platform.OS==='web'&&full)URL.revokeObjectURL(full);},[full]);
 async function enlarge(){setVisible(true);if(full)return;setLoading(true);try{setFull(await evidenceImage(id,'image'));setError('');}catch(e){setError((e as Error).message);}finally{setLoading(false);}}
 return <View ref={ref} style={{minHeight:80,gap:6}}>{uri?<Image source={{uri}} style={{width:100,height:100,borderRadius:8}} resizeMode="contain" accessibilityLabel="Miniatura del comprobante"/>:<Text style={styles.small}>{error||'Evidencia fotográfica · miniatura al visualizar'}</Text>}<Button title="Ver comprobante" variant="outline" icon="image" size="sm" onPress={()=>{void enlarge();}}/><Sheet visible={visible} title="Evidencia del gasto" onClose={()=>setVisible(false)}>{full?<Image source={{uri:full}} style={{width:'100%',height:500}} resizeMode="contain"/>:<Text style={styles.small}>{loading?'Cargando fotografía…':error}</Text>}{!loading&&!full&&<Button title="Reintentar imagen" onPress={()=>{void enlarge();}}/>}</Sheet></View>;
}
