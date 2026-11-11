import React,{useCallback,useEffect,useRef,useState} from 'react';
import {StatusBar} from 'expo-status-bar';
import {Feather} from '@expo/vector-icons';
import {Text,View,Pressable,StyleSheet,ActivityIndicator,Animated,Platform,useWindowDimensions} from 'react-native';
import {SafeAreaProvider,SafeAreaView} from 'react-native-safe-area-context';
import {api,ApiError,forgetSession,restoreSession,signIn,signOut} from './src/api';
import {Banner,Logo,ProgressBar,colors,initials,styles,useHardwareBack,useKeyboardVisible} from './src/ui';
import type {User,Product,Customer,Platform as PayPlatform,Settings,CashSession,Sale,Closure,Tab} from './src/types';
import {LoginScreen} from './src/LoginScreen';
import {HomeScreen} from './src/HomeScreen';
import {SaleScreen} from './src/SaleScreen';
import {CatalogScreen} from './src/CatalogScreen';
import {CashScreen} from './src/CashScreen';
import {HistoryScreen} from './src/HistoryScreen';
import {syncSummary,useSyncStatus} from './src/DeviceSettings';
import {offlineEnabled,startSync,subscribeSync} from './src/offline/runtime';
import {OperationsScreen} from './src/OperationsScreen';
import {SettingsScreen} from './src/SettingsScreen';
// Cinco pestañas caben desde 320 px. Vender es la acción principal (botón morado); la sección actual se marca con la barra superior y el texto.
const tabs=[{id:'home',name:'Inicio',icon:'home'},{id:'cash',name:'Caja',icon:'inbox'},{id:'sale',name:'Vender',icon:'shopping-cart'},{id:'catalog',name:'Catálogo',icon:'package'},{id:'history',name:'Historial',icon:'clock'}] as const;
export type Run=(fn:()=>Promise<void>,success?:string)=>void;
export default function App(){return <SafeAreaProvider><Main/></SafeAreaProvider>;}
function Main(){
 const {width}=useWindowDimensions();
 const [user,setUser]=useState<User|null>(null),[boot,setBoot]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState<{text:string;detail?:string}|null>(null),[tab,setTab]=useState<Tab>('home');
 const [products,setProducts]=useState<Product[]>([]),[customers,setCustomers]=useState<Customer[]>([]),[platforms,setPlatforms]=useState<PayPlatform[]>([]),[sessions,setSessions]=useState<CashSession[]>([]),[settings,setSettings]=useState<Settings>({business_name:"Dok Pollo MC",paper_width:80}),[sale,setSale]=useState<Sale|null>(null),[closure,setClosure]=useState<Closure|null>(null),[sessionFilter,setSessionFilter]=useState(''),[historyVersion,setHistoryVersion]=useState(0),[catalogTab,setCatalogTab]=useState<'products'|'customers'>('products'),[catalogVersion,setCatalogVersion]=useState(0),[toast,setToast]=useState('');
 const [route,setRoute]=useState<{id:string;name:string}|null>(null),[flow,setFlow]=useState(false);
 const keyboard=useKeyboardVisible(),sync=useSyncStatus();
 const toastTimer=useRef<ReturnType<typeof setTimeout>>(undefined);
 const notify=useCallback((text:string)=>{setToast(text);clearTimeout(toastTimer.current);toastTimer.current=setTimeout(()=>setToast(''),2600);},[]);
 const run=useCallback<Run>((fn,success)=>{setBusy(true);setError(null);void fn().then(()=>{if(success)notify(success);}).catch(async(e:unknown)=>{
  setError({text:e instanceof Error?e.message:'Ocurrió un error inesperado. Inténtalo nuevamente.',detail:e instanceof ApiError?e.detail:e instanceof Error?undefined:String(e)});
  if(e instanceof ApiError&&e.status===401&&!e.detail.includes('/auth/login')){await forgetSession();setUser(null);setError({text:'Tu sesión terminó. Ingresa de nuevo para continuar.'});}
 }).finally(()=>setBusy(false));},[notify]);
 const refresh=useCallback(async()=>{
  const currentRoute=await api<{id:string;name:string}|null>('/route');setRoute(currentRoute);
  const results=await Promise.all([api<Product[]>('/products'),api<Customer[]>('/customers'),api<PayPlatform[]>('/platforms'),api<CashSession[]>('/cash-sessions'),api<Settings>('/settings')]);setProducts(results[0]);setCustomers(results[1]);setPlatforms(results[2]);setSessions(results[3]);setSettings(results[4]);
 },[]);
 useEffect(()=>{void restoreSession().then(async u=>{if(u){setUser(u);await refresh();}}).catch(e=>setError({text:e.message,detail:e instanceof ApiError?e.detail:undefined})).finally(()=>setBoot(false));},[]);
 // Botón atrás de Android: primero cierra hojas/subpantallas, luego vuelve a Inicio y solo entonces sale.
 useHardwareBack(()=>{if(user&&tab!=='home'){setTab('home');return true;}return false;});
 useEffect(()=>{if(!user||!offlineEnabled)return;const stop=startSync();let last:string|null=null;const unsubscribe=subscribeSync(s=>{if(!s.running&&s.last_sync&&s.last_sync!==last){last=s.last_sync;void refresh().catch(()=>{});}});return ()=>{stop();unsubscribe();};},[user?.id,refresh]);
 const own=sessions.find(s=>s.opened_by===user?.id&&s.state==='open'&&(offlineEnabled||!s.device_id));
 function go(target:Tab){setError(null);setTab(target);}
 function history(selectedSale:Sale|null=null,selectedClosure:Closure|null=null,filter=''){setSale(selectedSale);setClosure(selectedClosure);setSessionFilter(filter);setHistoryVersion(n=>n+1);go('history');}
 function catalog(sub:'products'|'customers'){setCatalogTab(sub);setCatalogVersion(n=>n+1);go('catalog');}
 const logout=()=>run(async()=>{await signOut();setUser(null);setProducts([]);setCustomers([]);setPlatforms([]);setSessions([]);setSale(null);setClosure(null);setSessionFilter('');setTab('home');});
 if(boot)return <SafeAreaView style={local.root}><View style={{flex:1,alignItems:'center',justifyContent:'center',gap:18}}><Logo width={120}/><Text style={styles.h2}>DOK POLLO MC</Text><ActivityIndicator color={colors.accent}/></View></SafeAreaView>;
 const errorBanner=error&&<View style={local.bannerWrap}><Banner text={error.text} detail={error.detail} onClose={()=>setError(null)}/></View>;
 if(!user)return <SafeAreaView style={local.root} edges={['top','left','right','bottom']}><StatusBar style="dark"/><ProgressBar active={busy}/>{errorBanner}
  <LoginScreen busy={busy} onSubmit={(username,password)=>run(async()=>{const u=await signIn(username,password);setUser(u);setTab('home');await refresh();})}/></SafeAreaView>;
 const brand='DOK POLLO MC',narrow=width<360,state=sync&&syncSummary(sync);
 const stateColor=state?.tone==='green'?colors.green:state?.tone==='orange'?colors.orange:colors.muted;
 // En el cobro y con el teclado abierto se oculta la navegación: más espacio para el campo activo y la acción de continuar.
 const showNav=!keyboard&&!(flow&&tab==='sale');
 return <SafeAreaView style={local.root} edges={['top','left','right','bottom']}><StatusBar style="dark"/>
  <View style={local.top}>
   <Pressable accessibilityRole="button" accessibilityLabel={`Ir a inicio${state?`. ${state.text}`:''}`} onPress={()=>go('home')} style={local.brandGroup}>
    <Logo width={32}/>
    {!narrow&&<View style={{flexShrink:1,minWidth:0}}>
     <Text numberOfLines={1} style={local.brandText}>{brand}</Text>
     {state&&<View testID="sync-status" accessibilityLiveRegion="polite" style={local.syncLine}><Feather name={state.icon} size={11} color={stateColor}/><Text numberOfLines={1} style={[local.syncText,{color:stateColor}]}>{state.text}</Text></View>}
    </View>}
   </Pressable>
   <Pressable testID="cash-status" accessibilityRole="button" accessibilityLabel={own?'Caja abierta, ver caja':'Caja cerrada, abrir caja'} onPress={()=>go('cash')} style={[local.cashPill,{backgroundColor:own?colors.greenSoft:colors.orangeSoft}]}>
    {width>=400&&<Feather name={own?'unlock':'lock'} size={13} color={own?colors.greenDark:colors.orange}/>}<Text numberOfLines={1} style={[local.cashText,{color:own?colors.greenDark:colors.orange}]}>{own?`Caja${own.number?' #'+own.number:''}`:'Sin caja'}</Text>
   </Pressable>
   <Pressable accessibilityRole="button" accessibilityLabel="Rutas y abonos" onPress={()=>go('operations')} style={[local.iconTap,tab==='operations'&&{backgroundColor:colors.accentSoft}]}><Feather name="credit-card" size={20} color={tab==='operations'?colors.accent:colors.ink}/></Pressable>
   <Pressable testID="profile-button" accessibilityRole="button" accessibilityLabel="Mi perfil y configuración" onPress={()=>go('settings')} style={[local.avatar,tab==='settings'&&{borderColor:colors.accent,borderWidth:2}]}>
    <Text style={local.avatarText}>{initials(user.name)}</Text>
   </Pressable>
  </View>
  {narrow&&state&&state.tone!=='green'&&<View testID="sync-status" accessibilityLiveRegion="polite" style={local.syncStrip}><Feather name={state.icon} size={13} color={stateColor}/><Text numberOfLines={1} style={[local.syncText,{color:stateColor,fontSize:12}]}>{state.text}</Text></View>}
  <View style={{flex:1}}>
   <ProgressBar active={busy}/>
   {errorBanner}
   {tab==='home'&&<HomeScreen user={user} sessions={sessions} busy={busy} run={run} refresh={refresh} go={go} onHistory={()=>history()} onCatalog={catalog}/>}
   {/* Vender permanece montada: el carrito no se pierde al cambiar de pestaña. */}
   <View style={{flex:tab==='sale'?1:0,display:tab==='sale'?'flex':'none'}}><SaleScreen route={route} userId={user.id} active={tab==='sale'} session={own} products={products} customers={customers} platforms={platforms} paperWidth={Platform.OS==='android'?58:settings.paper_width} refresh={refresh} run={run} busy={busy} onViewSale={s=>history(s)} onOpenCash={()=>go('cash')} onFlowChange={setFlow}/></View>
   {tab==='cash'&&<CashScreen sessions={sessions} user={user} refresh={refresh} run={run} busy={busy} onClosure={c=>history(null,c)} onHistory={id=>history(null,null,id)} onSell={()=>go('sale')}/>}
   {tab==='catalog'&&<CatalogScreen key={catalogVersion} initialTab={catalogTab} products={products} customers={customers} user={user} run={run} refresh={refresh} busy={busy}/>}
   {tab==='history'&&<HistoryScreen key={historyVersion} user={user} settings={settings} run={run} busy={busy} initialSale={sale} initialClosure={closure} sessionFilter={sessionFilter} clearInitial={()=>{setSale(null);setClosure(null);}} customers={customers} sessions={sessions}/>}
   {tab==='operations'&&<OperationsScreen user={user} products={products} customers={customers} session={own} run={run} busy={busy} refresh={refresh}/>}
   {tab==='settings'&&<SettingsScreen user={user} settings={settings} platforms={platforms} run={run} refresh={refresh} busy={busy} logout={logout}/>}
   {!!toast&&<Toast text={toast}/>}
  </View>
  {showNav&&<View style={styles.nav} accessibilityRole="tablist">{tabs.map(t=>{const on=tab===t.id;const center=t.id==='sale';return <Pressable key={t.id} testID={`tab-${t.id}`} accessibilityRole="tab" accessibilityLabel={t.name} accessibilityState={{selected:on}} onPress={()=>t.id==='history'?history():go(t.id)} style={({pressed})=>[styles.navItem,pressed&&{backgroundColor:colors.subtle}]}>
   <View style={[local.indicator,on&&{backgroundColor:colors.accent}]}/>
   {center?<View style={local.sellIcon}><Feather name={t.icon} size={20} color="white"/></View>:<View style={[local.navPill,on&&{backgroundColor:colors.accentSoft}]}><Feather name={t.icon} size={20} color={on?colors.accent:colors.muted}/></View>}
   <Text numberOfLines={1} style={[styles.navText,center&&{color:colors.ink,fontWeight:'700'},on&&{color:colors.accentDark,fontWeight:'800'}]}>{t.name}</Text>
  </Pressable>;})}</View>}
 </SafeAreaView>;
}
function Toast({text}:{text:string}){
 const y=useRef(new Animated.Value(-20)).current;
 useEffect(()=>{Animated.spring(y,{toValue:0,useNativeDriver:Platform.OS!=='web'}).start();},[y]);
 return <View pointerEvents="none" style={local.toastWrap}><Animated.View accessibilityLiveRegion="polite" accessibilityRole="alert" style={[local.toast,{transform:[{translateY:y}]}]}><Feather name="check-circle" size={18} color="#8FD3A4"/><Text style={local.toastText}>{text}</Text></Animated.View></View>;
}
const local=StyleSheet.create({
 root:{flex:1,backgroundColor:colors.bg},
 top:{paddingHorizontal:12,paddingVertical:6,flexDirection:'row',alignItems:'center',gap:6,borderBottomColor:colors.accent,borderBottomWidth:2,backgroundColor:colors.white,minHeight:56},
 brandGroup:{flex:1,flexDirection:'row',alignItems:'center',gap:8,minWidth:0,minHeight:48},
 brandText:{fontSize:14,fontWeight:'900',color:colors.accentDark,letterSpacing:0},
 syncLine:{flexDirection:'row',alignItems:'center',gap:4,marginTop:1},
 syncText:{fontSize:11,fontWeight:'600',flexShrink:1},
 syncStrip:{flexDirection:'row',alignItems:'center',gap:6,paddingHorizontal:12,paddingVertical:5,backgroundColor:colors.subtle,borderBottomWidth:1,borderBottomColor:colors.line},
 cashPill:{flexDirection:'row',alignItems:'center',gap:4,paddingHorizontal:9,minHeight:36,borderRadius:999,flexShrink:0},
 cashText:{fontSize:13,fontWeight:'700'},
 iconTap:{width:42,height:44,borderRadius:21,alignItems:'center',justifyContent:'center'},
 avatar:{width:40,height:40,borderRadius:20,backgroundColor:colors.accentDark,alignItems:'center',justifyContent:'center',flexShrink:0},
 avatarText:{color:'white',fontWeight:'800',fontSize:14},
 bannerWrap:{paddingHorizontal:16,paddingTop:10,width:'100%',maxWidth:720,alignSelf:'center'},
 indicator:{position:'absolute',top:0,width:28,height:3,borderBottomLeftRadius:3,borderBottomRightRadius:3,backgroundColor:'transparent'},
 navPill:{width:48,height:30,borderRadius:15,alignItems:'center',justifyContent:'center'},
 sellIcon:{width:48,height:30,borderRadius:15,backgroundColor:colors.accent,alignItems:'center',justifyContent:'center'},
 toastWrap:{position:'absolute',left:16,right:16,top:10,alignItems:'center',zIndex:30},
 toast:{width:'100%',maxWidth:520,flexDirection:'row',alignItems:'center',gap:10,backgroundColor:colors.ink,paddingHorizontal:16,paddingVertical:13,borderRadius:12,elevation:4},
 toastText:{color:'white',fontWeight:'700',fontSize:15,flex:1},
});
