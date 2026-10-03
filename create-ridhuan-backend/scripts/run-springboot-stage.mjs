import {mkdtemp,writeFile,mkdir,copyFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {cleanupHardeningFixtures} from "./hardening-fixture-cleanup.mjs";
import {collectProcessCase} from "./hardening-process.mjs";
const root=resolve(import.meta.dirname,".."),output=await mkdtemp(join(tmpdir(),"springboot-final-stage-"));
const cases=[
 ...["postgresql","mysql"].flatMap(provider=>[
  {id:"manual-"+provider,args:["--input-type=module","-e",'import {verifySpringbootRuntime} from "./scripts/verify-springboot-runtime.mjs"; await verifySpringbootRuntime("'+provider+'","manual");']},
  {id:"compose-"+provider,args:["scripts/verify-springboot-compose.mjs",provider]},
  {id:"consumer-"+provider,args:["scripts/verify-springboot-consumer.mjs",provider]}
 ]),
 {id:"cli-package-contracts",args:["scripts/verify-cli.mjs"]},
 {id:"runner-contracts",args:["--test","scripts/test-hardening-runner.mjs"]},
 {id:"runtime-selection-contracts",args:["--test","scripts/test-spring-scenario-selection.mjs"]},
 {id:"existing-history-and-secrets",args:["scripts/verify-hardening-source.mjs"]}
];
const only=process.argv.includes("--only")?process.argv[process.argv.indexOf("--only")+1].split(","):undefined;
const selected=only?cases.filter(c=>only.includes(c.id)):cases;
if(only&&selected.length!==only.length)throw new Error("Unknown stage case");
await writeFile(join(output,"plan.json"),JSON.stringify({authoredAt:new Date().toISOString(),cases,selected},null,2));
const results=[];
for(const task of selected){
 const log=join(output,task.id+".log");console.log("START "+task.id);
 try{const result=await collectProcessCase({executable:process.execPath,args:task.args,cwd:root},log,{...process.env},45*60*1000);results.push({id:task.id,status:result.exitCode===0?"PASS":"FAIL",...result,log});}
 catch(error){results.push({id:task.id,status:"FAIL",error:String(error),log});}
 const taskCleanup=join(output,task.id+"-ownership");await mkdir(taskCleanup);await copyFile(log,join(taskCleanup,"hardening-task.log"));
 const cleanup=await cleanupHardeningFixtures(taskCleanup);if(cleanup.failures.length)results.push({id:task.id+"-cleanup",status:"FAIL",cleanup});
 console.log(results.find(r=>r.id===task.id).status+" "+task.id);
}
await writeFile(join(output,"results.json"),JSON.stringify(results,null,2));console.log("Diagnostics: "+output);
if(results.some(r=>r.status!=="PASS"))process.exitCode=1;
