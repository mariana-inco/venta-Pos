const {withAndroidManifest}=require('@expo/config-plugins');
module.exports=config=>withAndroidManifest(config,mod=>{
 const app=mod.modResults.manifest.application[0];
 app.$['android:allowBackup']='false';
 app.$['android:usesCleartextTraffic']=process.env.POS_ALLOW_HTTP==='1'?'true':'false';
 return mod;
});
