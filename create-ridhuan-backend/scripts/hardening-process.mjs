import { spawn } from "node:child_process";
import { open } from "node:fs/promises";
import { command } from "../dist/process.js";
export async function collectProcessCase(item, log, env, timeoutMs=45*60*1000) {
  let handle;
  try { handle=await open(log,"w"); }
  catch(error) { return {exitCode:1,signal:null,error:"Cannot open task log: "+error.message,timedOut:false,aborted:false}; }
  const output=handle.createWriteStream();
  let timedOut=false,aborted=false,writeFailure;
  const result=await new Promise(finish=>{
    const child=spawn(item.executable,item.args,{cwd:item.cwd,env,shell:false,windowsHide:true,detached:process.platform!=="win32",stdio:["ignore","pipe","pipe"]});
    let escalation,finished=false;
    function terminate(){
      if(!child.pid)return;
      if(process.platform==="win32") command("taskkill",["/PID",String(child.pid),"/T","/F"],item.cwd);
      else {
        try{process.kill(-child.pid,"SIGTERM");}catch(error){if(error.code!=="ESRCH")writeFailure??="Child termination failed";}
        escalation=setTimeout(()=>{try{process.kill(-child.pid,"SIGKILL");}catch{}},5000);
      }
    }
    output.on("error",error=>{writeFailure=error.message;terminate();});
    const timeout=setTimeout(()=>{timedOut=true;terminate();},timeoutMs);
    const abort=()=>{aborted=true;terminate();};
    item.signal?.addEventListener("abort",abort,{once:true});
    if(item.signal?.aborted)abort();
    child.stdout.pipe(output,{end:false});child.stderr.pipe(output,{end:false});
    function complete(value){if(finished)return;finished=true;clearTimeout(timeout);clearTimeout(escalation);item.signal?.removeEventListener("abort",abort);finish({...value,exitCode:timedOut?124:aborted?130:value.exitCode,timedOut,aborted});}
    child.on("error",error=>complete({exitCode:1,signal:null,error:error.message}));
    child.on("close",(exitCode,signal)=>complete({exitCode,signal}));
  });
  if(!output.destroyed)await new Promise(finish=>{output.once("close",finish);output.end();});
  return writeFailure?{...result,exitCode:1,error:"Cannot write task log: "+writeFailure}:result;
}
