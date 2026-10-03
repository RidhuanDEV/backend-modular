import {mkdtemp, writeFile, readFile, mkdir, copyFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {collectProcessCase} from "./hardening-process.mjs";
import {cleanupHardeningFixtures} from "./hardening-fixture-cleanup.mjs";

const root=resolve(import.meta.dirname,"..");
const cases=["springboot","laravel","fastapi"].flatMap(template=>
  ["postgresql","mysql"].map(database=>({
    id:`${template}-${database}`, executable:process.execPath,
    args:["scripts/verify-consumer.mjs",template,database], cwd:root,
    timeoutMs:45*60*1000
  })));
const onlyIndex=process.argv.indexOf("--only");
const only=onlyIndex<0?undefined:process.argv[onlyIndex+1]?.split(",");
if(onlyIndex>=0&&(!only?.length||new Set(only).size!==only.length||only.some(id=>!cases.some(task=>task.id===id))))
  throw new Error("Invalid consumer stage selection");
const selected=only?cases.filter(task=>only.includes(task.id)):cases;
const output=await mkdtemp(join(tmpdir(),"macos-consumer-stage-"));
await writeFile(join(output,"plan.json"),JSON.stringify({authoredAt:new Date().toISOString(),cases,selected,fixtures:"Each consumer owns a temporary generated project; native smoke does not use Docker",environment:{CLI_RUNTIME_TEST:"false"}},null,2));
const results=[], abort=new AbortController();
const cancel=()=>abort.abort();
process.on("SIGINT",cancel);process.on("SIGTERM",cancel);
try {
  for(const task of selected) {
    if(abort.signal.aborted){results.push({id:task.id,status:"CANCELLED",exitCode:130});continue;}
    console.log("START "+task.id);
    const log=join(output,task.id+".log");
    try {
      const result=await collectProcessCase({...task,signal:abort.signal},log,{...process.env,CLI_RUNTIME_TEST:"false"},task.timeoutMs);
      results.push({id:task.id,status:result.exitCode===0?"PASS":"FAIL",...result,log});
      if(result.exitCode!==0)console.error((await readFile(log,"utf8")).slice(-20000));
    } catch(error){results.push({id:task.id,status:"FAIL",exitCode:1,error:String(error),log});}
    finally {
      const ownership=join(output,task.id+"-ownership");await mkdir(ownership);
      try{await copyFile(log,join(ownership,"hardening-task.log"));}catch(error){results.push({id:task.id+"-log",status:"FAIL",error:String(error)});}
      try{const cleanup=await cleanupHardeningFixtures(ownership);if(cleanup.failures.length)results.push({id:task.id+"-cleanup",status:"FAIL",cleanup});}
      catch(error){results.push({id:task.id+"-cleanup",status:"FAIL",error:String(error)});}
    }
    console.log(results.find(result=>result.id===task.id).status+" "+task.id);
  }
} finally {
  process.off("SIGINT",cancel);process.off("SIGTERM",cancel);
  await writeFile(join(output,"results.json"),JSON.stringify(results,null,2));
  console.log("Consumer stage diagnostics: "+output);
  if(results.length<selected.length||results.some(result=>result.status!=="PASS"))process.exitCode=1;
}
