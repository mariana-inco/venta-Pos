const {withDangerousMod}=require('@expo/config-plugins');
const fs=require('node:fs');const path=require('node:path');
// R8 elimina el constructor de las bases Room generadas (WorkManager de expo-background-task)
// y la app se cierra al iniciar en compilación release. Estas reglas lo conservan.
const RULES=`
# Dok Pollo MC: WorkManager/Room en release
-keep class * extends androidx.room.RoomDatabase { <init>(); }
-keep class androidx.work.impl.** { *; }
`;
module.exports=config=>withDangerousMod(config,['android',async mod=>{
 const file=path.join(mod.modRequest.platformProjectRoot,'app','proguard-rules.pro');
 const current=fs.existsSync(file)?fs.readFileSync(file,'utf8'):'';
 if(!current.includes('Dok Pollo MC: WorkManager'))fs.writeFileSync(file,current+RULES);
 return mod;
}]);
