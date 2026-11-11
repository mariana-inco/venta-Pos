import React,{useState} from 'react';
import {Text,Pressable,View} from 'react-native';
import {Button,SearchBar,Sheet,styles,normalizeSearch,colors} from './ui';
export function SearchSelect({label,items,value,onChange,disabled=false}:{label:string;items:{id:string;name:string}[];value:string;onChange:(id:string)=>void;disabled?:boolean}){
 const [open,setOpen]=useState(false),[query,setQuery]=useState('');const chosen=items.find(i=>i.id===value),q=normalizeSearch(query);
 return <View style={{gap:6}}><Text style={styles.label}>{label}</Text><Button title={chosen?.name||'Seleccionar'} variant="outline" disabled={disabled} onPress={()=>{setQuery('');setOpen(true);}}/><Sheet visible={open} title={label} onClose={()=>setOpen(false)}><SearchBar value={query} onChange={setQuery} placeholder="Buscar por nombre"/>{items.filter(i=>!q||normalizeSearch(i.name).includes(q)).slice(0,60).map(i=><Pressable key={i.id} accessibilityRole="button" accessibilityLabel={i.name} style={{padding:14,borderBottomWidth:1,borderColor:colors.line}} onPress={()=>{onChange(i.id);setOpen(false);}}><Text style={styles.body}>{i.name}{value===i.id?' ✓':''}</Text></Pressable>)}</Sheet></View>;
}
