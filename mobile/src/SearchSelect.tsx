import React,{useState} from 'react';
import {Text,Pressable,View} from 'react-native';
import {Feather} from '@expo/vector-icons';
import {SearchBar,Sheet,styles,normalizeSearch,colors} from './ui';
/** Campo de selección con búsqueda: se ve como un campo (no como un botón de acción) y abre una hoja con la lista. */
export function SearchSelect({label,items,value,onChange,disabled=false}:{label:string;items:{id:string;name:string}[];value:string;onChange:(id:string)=>void;disabled?:boolean}){
 const [open,setOpen]=useState(false),[query,setQuery]=useState('');const chosen=items.find(i=>i.id===value),q=normalizeSearch(query);
 return <View style={{gap:6}}><Text style={styles.label}>{label}</Text>
  <Pressable accessibilityRole="button" accessibilityLabel={chosen?.name||'Seleccionar'} accessibilityHint={label} accessibilityState={{disabled}} disabled={disabled} onPress={()=>{setQuery('');setOpen(true);}} style={({pressed})=>[styles.inputBox,pressed&&{backgroundColor:colors.subtle},disabled&&{backgroundColor:colors.subtle,borderColor:colors.line}]}>
   <Text numberOfLines={1} style={[styles.input,{paddingVertical:14},!chosen&&{color:colors.muted},disabled&&{color:colors.muted}]}>{chosen?.name||'Seleccionar'}</Text>
   {!disabled&&<Feather name="chevron-down" size={20} color={colors.muted}/>}
  </Pressable>
  <Sheet visible={open} title={label} onClose={()=>setOpen(false)}><SearchBar value={query} onChange={setQuery} placeholder="Buscar por nombre"/>{items.filter(i=>!q||normalizeSearch(i.name).includes(q)).slice(0,60).map(i=><Pressable key={i.id} accessibilityRole="button" accessibilityLabel={i.name} accessibilityState={{selected:value===i.id}} style={({pressed})=>[{padding:14,borderBottomWidth:1,borderColor:colors.line,flexDirection:'row',alignItems:'center',gap:8},pressed&&{backgroundColor:colors.subtle}]} onPress={()=>{onChange(i.id);setOpen(false);}}><Text style={[styles.body,{flex:1},value===i.id&&{color:colors.accentDark,fontWeight:'700'}]}>{i.name}</Text>{value===i.id&&<Feather name="check" size={18} color={colors.accent}/>}</Pressable>)}</Sheet>
 </View>;
}
