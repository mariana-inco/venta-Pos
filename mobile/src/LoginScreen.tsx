import React,{useRef,useState} from 'react';
import {Pressable,Text,TextInput,View} from 'react-native';
import {Feather} from '@expo/vector-icons';
import {API_URL} from './api';
import {Button,Card,Field,Logo,Page,colors,styles} from './ui';
export function LoginScreen({busy,onSubmit}:{busy:boolean;onSubmit:(username:string,password:string)=>void}){
 const [username,setUsername]=useState(''),[password,setPassword]=useState(''),[show,setShow]=useState(false);
 const passwordRef=useRef<React.ComponentRef<typeof TextInput>>(null);
 const ready=!busy&&!!username.trim()&&!!password;
 const submit=()=>{if(ready){onSubmit(username.trim(),password);setPassword('');}};
 return <Page>
  <View style={{alignItems:'center',gap:6,marginTop:16}}>
   <Logo width={96}/>
   <Text accessibilityRole="header" style={[styles.title,{textAlign:'center'}]}>DOK POLLO MC</Text>
   <Text style={[styles.muted,{textAlign:'center'}]}>Punto de venta · pollos campesinos</Text>
  </View>
  <Card style={{width:'100%',maxWidth:440,alignSelf:'center',gap:14}}>
   <Text accessibilityRole="header" style={styles.h2}>Inicia sesión</Text>
   <Field label="Usuario" value={username} onChange={setUsername} placeholder="Tu usuario" kind="plain" autoComplete="username" returnKey="next" onSubmit={()=>passwordRef.current?.focus()}/>
   <Field label="Contraseña" value={password} onChange={setPassword} secure={!show} placeholder="Tu contraseña" autoComplete="password" returnKey="go" inputRef={passwordRef} onSubmit={submit}
    right={<Pressable accessibilityRole="button" accessibilityLabel={show?'Ocultar contraseña':'Mostrar contraseña'} hitSlop={10} onPress={()=>setShow(!show)}><Feather name={show?'eye-off':'eye'} size={20} color={colors.muted}/></Pressable>}/>
   <Button title="Entrar" icon="log-in" size="lg" loading={busy} disabled={!ready} onPress={submit}/>
  </Card>
  <View style={{alignItems:'center',gap:4}}>
   <Text style={[styles.small,{textAlign:'center'}]}>¿No tienes usuario? Pídelo al administrador del negocio.</Text>
   <Text style={styles.small}>Versión {require('../app.json').expo.version}</Text>
   <Text style={[styles.small,{fontSize:11,textAlign:'center'}]}>Servidor: {API_URL}</Text>
  </View>
 </Page>;
}
