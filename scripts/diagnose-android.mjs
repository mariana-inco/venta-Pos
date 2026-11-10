import {spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
const root=new URL('../',import.meta.url).pathname;
const candidates=[process.env.ADB,join(root,'tmp/platform-tools/adb'),join(process.env.HOME||'','Library/Android/sdk/platform-tools/adb'),'adb'].filter(Boolean);
const adb=candidates.find(p=>p==='adb'?spawnSync(p,['version'],{stdio:'ignore'}).status===0:existsSync(p));
if(!adb){console.error('ADB ausente. Instala Android SDK Platform Tools o define ADB=/ruta/adb.');process.exit(1);}
const out=resolve(root,'output/android-diagnostic');mkdirSync(out,{recursive:true});
function run(name,args,device=false){const result=spawnSync(adb,[...(device&&process.env.ANDROID_SERIAL?['-s',process.env.ANDROID_SERIAL]:[]),...args],{encoding:'utf8',timeout:20000});const text=(result.stdout||'')+(result.stderr||'');writeFileSync(join(out,name+'.txt'),text);return {text,status:result.status};}
const devices=run('devices',['devices','-l']);console.log(devices.text);
const connected=devices.text.split('\n').filter(l=>/^\S+\s+device\b/.test(l));
if(connected.length!==1&&!process.env.ANDROID_SERIAL){console.error('Conecta y autoriza la H10S. Si hay varios equipos, define ANDROID_SERIAL. No se modificó ninguna app.');process.exit(2);}
for(const [name,args] of [
 ['device',['shell','getprop']],
 ['package',['shell','dumpsys','package','com.ventapos.mobile']],
 ['senraise-printer-package',['shell','dumpsys','package','recieptservice.com.recieptservice']],
 ['print-services',['shell','dumpsys','print']],
 ['services',['shell','service','list']],
 ['storage',['shell','df','-h','/data']],
]){const result=run(name,args,true);if(result.status!==0)console.error(name+': '+result.text);}
console.log('Diagnóstico guardado en '+out+'. Contiene identificadores del equipo; revísalo antes de compartir.');
console.log('Para obtener el error exacto al actualizar SIN borrar datos:');
console.log(`${adb} ${process.env.ANDROID_SERIAL?'-s '+process.env.ANDROID_SERIAL+' ':''}install -r /ruta/al/apk-que-falla.apk`);
console.log('Conserva la salida completa. No uses uninstall, pm clear ni -d para ocultar el problema.');
