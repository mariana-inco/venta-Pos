import React,{useEffect,useState} from 'react';
import {Text,View} from 'react-native';
import {Badge,Banner,Button,Card,Choice,Confirm,styles} from './ui';
import {offlineEnabled,subscribeSync,syncNow,type SyncStatus} from './offline/runtime';
import {pairedPrinters,printerConfig,savePrinter,testPrinter,printerAvailable,type Printer,type PrinterConfig} from './printing/printer';
import {api} from './api';
import type {Run} from '../App';
const initial:SyncStatus={pending:0,blocked:0,error:null,last_sync:null,catalog_ready:false,running:false,online:true};
export function SyncBanner(){
 const [status,setStatus]=useState(initial);
 useEffect(()=>offlineEnabled?subscribeSync(setStatus):undefined,[]);
 if(!offlineEnabled)return null;
 const text=status.running?'Sincronizando…':status.blocked?`${status.pending} operaciones guardadas · requiere revisión`:status.pending?`${status.pending} operaciones guardadas · pendientes de enviar`:status.online?'Guardado en el equipo · sincronizado':'Sin conexión · puedes seguir vendiendo';
 return <View style={{paddingHorizontal:12,paddingVertical:6}} accessibilityLiveRegion="polite"><Badge text={text} tone={status.blocked?'orange':status.pending||!status.online?'gray':'green'}/></View>;
}
export function DeviceSettings({run,busy}:{run:Run;busy:boolean}){
 const [status,setStatus]=useState(initial),[printers,setPrinters]=useState<Printer[]>([]),[selected,setSelected]=useState<PrinterConfig|null>(null),[width,setWidth]=useState('58'),[encoding,setEncoding]=useState('2');
 useEffect(()=>{if(!offlineEnabled)return;const off=subscribeSync(setStatus);void printerConfig().then(p=>{if(p){setSelected(p);setWidth(String(p.width));setEncoding(String(p.codePage));}});return off;},[]);
 if(!offlineEnabled)return null;
 const persist=async(p:Printer,w=width,e=encoding)=>{const config={...p,width:Number(w) as 58|80,codePage:Number(e),charset:e==='0'?'IBM437':e==='16'?'windows-1252':'IBM850'};await savePrinter(config);setSelected(config);};
 return <>
  <Card>
   <Text style={styles.h2}>Datos de este dispositivo</Text>
   <Text style={styles.body}>Las ventas y los tickets se guardan aquí antes de enviarse. Puedes vender e imprimir sin internet después del primer inicio de sesión con conexión.</Text>
   <Text style={styles.small}>Dispositivo: {status.device_id||'Preparando…'}</Text>
   <Text style={styles.body}>{status.pending} operaciones pendientes · {status.blocked} requieren revisión</Text>
   <Text style={styles.small}>Última descarga: {status.last_sync?new Date(status.last_sync).toLocaleString('es-CO'):'Sin descargar'}</Text>
   {!!status.error&&<Banner tone="orange" text={status.error}/>}
   {!!status.notice&&<Text style={styles.small}>{status.notice}</Text>}
   <Button title="Sincronizar ahora" icon="refresh-cw" loading={status.running} disabled={busy||status.running} onPress={()=>run(syncNow)}/>
   <Text style={styles.hint}>La sincronización automática se intenta cada 30 segundos con la app abierta, al recuperar conexión y en segundo plano cuando Android lo permite. No borres los datos de la app si hay operaciones pendientes.</Text>
  </Card>
  <Card>
   <Text style={styles.h2}>Impresora Bluetooth</Text>
   <Text style={styles.body}>Empareja la impresora desde Ajustes de Android y selecciónala aquí. Esta conexión utiliza Bluetooth Classic con ESC/POS.</Text>
   {!printerAvailable&&<Banner tone="orange" text="Instala el APK propio para habilitar Bluetooth. Expo Go no incluye este módulo."/>}
   <Button title="Ver impresoras emparejadas" icon="bluetooth" variant="secondary" disabled={busy||!printerAvailable} onPress={()=>run(async()=>{const list=await pairedPrinters();setPrinters(list);if(!list.length)throw new Error('No hay dispositivos emparejados. Abre Ajustes de Android y empareja la impresora.');})}/>
   {printers.map(p=><Button key={p.address} title={`${p.name} · ${p.address}`} variant={selected?.address===p.address?'primary':'outline'} disabled={busy} onPress={()=>run(()=>persist(p),'Impresora seleccionada')}/>)}
   {!!selected&&<Text style={styles.body}>Seleccionada: {selected.name}</Text>}
   <Text style={styles.label}>Papel</Text>
   <Choice items={[{id:'58',name:'58 mm'},{id:'80',name:'80 mm'}]} value={width} onChange={w=>{setWidth(w);if(selected)run(()=>persist(selected,w));}}/>
   <Text style={styles.label}>Tabla de caracteres de la impresora</Text>
   <Choice items={[{id:'2',name:'PC850'},{id:'0',name:'PC437'},{id:'16',name:'Windows 1252'}]} value={encoding} onChange={e=>{setEncoding(e);if(selected)run(()=>persist(selected,width,e));}}/>
   <Text style={styles.hint}>Verifica acentos y ñ con el autotest de tu impresora. En un terminal con impresora integrada puede ser necesario el SDK de su fabricante.</Text>
   <Button title="Imprimir prueba" icon="printer" disabled={busy||!selected||!printerAvailable} onPress={()=>run(testPrinter,'Prueba enviada a la impresora')}/>
  </Card>
 </>;
}
export function CloudDevices({run,busy}:{run:Run;busy:boolean}){
 const [devices,setDevices]=useState<any[]|null>(null),[issues,setIssues]=useState<any>(null),[revoke,setRevoke]=useState<string|null>(null);
 const load=async()=>{const [d,i]=await Promise.all([api<any[]>('/devices'),api<any>('/sync-issues')]);setDevices(d);setIssues(i);};
 return <Card>
  <Text style={styles.h2}>Dispositivos y conciliación</Text>
  <Text style={styles.body}>Consulta los equipos registrados, su última comunicación y las diferencias de inventario detectadas al recibir ventas sin conexión.</Text>
  <Button title="Consultar dispositivos" variant="secondary" disabled={busy} onPress={()=>run(load)}/>
  {devices?.map(d=><View key={`${d.id}-${d.user_id}`} style={{gap:6}}><Text style={styles.body}>{d.name} · {d.username} · {d.revoked?'Revocado':'Autorizado'}</Text><Text style={styles.small}>{d.id} · {d.last_seen_at||'Sin sincronizar'}</Text>{!d.revoked&&<Button title="Revocar dispositivo" variant="outline" danger disabled={busy} onPress={()=>setRevoke(d.id)}/>}</View>)}
  {issues?.stock_debts?.map((d:any)=><Banner key={d.product_id} tone="orange" text={`${d.name}: faltante de ${d.quantity_milli/1000}. Recuenta y ajusta existencias en Catálogo.`}/>)}
  {issues?.issues?.slice(0,20).map((i:any)=><Text key={i.id} style={styles.small}>{i.detail.message} · venta {i.sale_id}</Text>)}
  <Confirm visible={!!revoke} title="¿Revocar este dispositivo?" message="Su acceso a la nube se bloqueará. Si está sin conexión, conocerá el bloqueo al volver a comunicarse. Sus ventas locales no se borran." confirmText="Revocar" danger busy={busy} onCancel={()=>setRevoke(null)} onConfirm={()=>run(async()=>{await api(`/devices/${revoke}/revoke`,'POST',{});setRevoke(null);await load();})}/>
 </Card>;
}
