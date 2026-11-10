import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const out='runtime-smoke';fs.mkdirSync(out,{recursive:true});
const run=(args,timeout=60000)=>{console.log('xcrun '+args.join(' '));const s=execFileSync('xcrun',args,{encoding:'utf8',timeout,stdio:['ignore','pipe','pipe']});console.log(s);return s;};
const devices=JSON.parse(run(['simctl','list','devices','available','--json']));
fs.writeFileSync(out+'/available-devices.json',JSON.stringify(devices,null,2));
const choices=Object.entries(devices.devices).filter(([runtime])=>runtime.includes('.iOS-')).flatMap(([runtime,list])=>list.filter(d=>d.isAvailable).map(d=>({...d,runtime})));
const phone=choices.find(d=>d.name.startsWith('iPhone'));
if(!phone)throw Error('No available installed iPhone iOS simulator');
fs.writeFileSync(out+'/device.json',JSON.stringify(phone,null,2));
fs.appendFileSync(process.env.GITHUB_ENV,'SMOKE_UDID='+phone.udid+'\n');
const app='native/ios/build/DerivedData/Build/Products/Debug-iphonesimulator/OrunVoca.app';
function capture(d,label){
 if(d.state!=='Booted')run(['simctl','boot',d.udid]);
 run(['simctl','bootstatus',d.udid,'-b'],180000);
 run(['simctl','status_bar',d.udid,'override','--time','9:41','--dataNetwork','wifi','--wifiMode','active','--wifiBars','3','--batteryState','charged','--batteryLevel','100']);
 run(['simctl','install',d.udid,app]);
 const launched=run(['simctl','launch',d.udid,'com.orunvoca.app']);
 fs.writeFileSync(out+'/'+label+'-launch.log',launched);
 Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,15000);
 run(['simctl','io',d.udid,'screenshot',out+'/'+label+'-online-first-screen.png']);
 run(['simctl','terminate',d.udid,'com.orunvoca.app']);
}
capture(phone,'iPhone');
const pad=choices.find(d=>d.name.startsWith('iPad'));
if(pad){try{capture(pad,'iPad');run(['simctl','shutdown',pad.udid]);}catch(e){fs.writeFileSync(out+'/iPad-optional-error.log',String(e));}}
