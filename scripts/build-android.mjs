import {spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,copyFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const env={...process.env};
const brewJdk='/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home';
if(!env.JAVA_HOME&&existsSync(brewJdk))env.JAVA_HOME=brewJdk;
const macJdk='/Applications/Android Studio.app/Contents/jbr/Contents/Home';
if(!env.JAVA_HOME&&existsSync(macJdk))env.JAVA_HOME=macJdk;
const sdk=join(process.env.HOME||'','Library/Android/sdk');
if(!env.ANDROID_HOME&&existsSync(sdk))env.ANDROID_HOME=sdk;
const api=env.EXPO_PUBLIC_API_URL;
if(!api||(!api.startsWith('https://')&&!(env.POS_ALLOW_HTTP==='1'&&api.startsWith('http://')))){
 console.error('Define EXPO_PUBLIC_API_URL=https://tu-api. Para una prueba local HTTP, añade POS_ALLOW_HTTP=1.');process.exit(1);
}
function run(cmd,args,cwd){const r=spawnSync(cmd,args,{cwd,env,stdio:'inherit'});if(r.error)throw r.error;if(r.status!==0)process.exit(r.status||1);}
run('npm',['exec','-w','mobile','--','expo','prebuild','--platform','android','--no-install'],root);
run(process.platform==='win32'?'gradlew.bat':'./gradlew',[':app:assembleRelease','--console=plain',...(env.POS_ANDROID_ARCH?[`-PreactNativeArchitectures=${env.POS_ANDROID_ARCH}`]:[])],join(root,'mobile/android'));
mkdirSync(join(root,'output'),{recursive:true});
const out=resolve(root,'output/dannys-pos-preview.apk');
copyFileSync(join(root,'mobile/android/app/build/outputs/apk/release/app-release.apk'),out);
console.log(`APK de prueba local (firma de desarrollo, JS incluido): ${out}`);
