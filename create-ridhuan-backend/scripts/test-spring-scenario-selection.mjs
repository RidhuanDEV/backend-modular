import assert from "node:assert/strict";
import {test} from "node:test";
import {spawnSync} from "node:child_process";
import {mkdtemp,writeFile} from "node:fs/promises";
import {join,resolve} from "node:path";
import {tmpdir} from "node:os";

const root=resolve(import.meta.dirname,".."),output=await mkdtemp(join(tmpdir(),"spring-runtime-selection-"));
const cases=[
 {id:"unknown",selection:"not-a-scenario",mode:"manual"},
 {id:"empty",selection:"",mode:"manual"},
 {id:"duplicate",selection:"registry-openapi-dto-rbac,registry-openapi-dto-rbac",mode:"manual"},
 {id:"unavailable",selection:"generated-invoice-real-provider-migration-permission-crud",mode:"compose"},
 {id:"invalid-mode",selection:"registry-openapi-dto-rbac",mode:"invalid"}
];
await writeFile(join(output,"plan.json"),JSON.stringify({cases,assertions:"nonzero exit and no fixture allocation before invalid selection rejection",timeoutMs:15000,cleanup:"no Docker/process fixture allocated"},null,2));
for(const task of cases)test(task.id,{timeout:20000},async()=>{
 const source='import {verifySpringbootRuntime} from "./scripts/verify-springboot-runtime.mjs"; await verifySpringbootRuntime("postgresql",'+JSON.stringify(task.mode)+');';
 const result=spawnSync(process.execPath,["--input-type=module","-e",source],{cwd:root,env:{...process.env,SPRING_SCENARIOS:task.selection},encoding:"utf8",timeout:15000,maxBuffer:2*1024*1024});
 const transcript=(result.stdout??"")+(result.stderr??"");
 await writeFile(join(output,task.id+".log"),transcript);
 assert.equal(result.error,undefined);assert.notEqual(result.status,0);assert.notEqual(result.status,null);
 assert(!transcript.includes("SPRING_FIXTURE="));assert(transcript.includes("AssertionError"));
 if(task.mode!=="invalid")assert(transcript.includes("Unknown, duplicate or unavailable runtime scenario"));
});
console.log("Diagnostics: "+output);
