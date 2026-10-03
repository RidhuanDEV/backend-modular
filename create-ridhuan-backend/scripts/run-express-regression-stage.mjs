import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { existsSync } from "node:fs";
import { collectProcessCase } from "./hardening-process.mjs";
const project=resolve(import.meta.dirname,"../../modular-express-typescript-starter-postgre");
const directory=await mkdtemp(join(tmpdir(),"express-final-regression-"));
const npmPath=[process.env.npm_execpath,join(dirname(process.execPath),"node_modules/npm/bin/npm-cli.js"),join(dirname(process.execPath),"../lib/node_modules/npm/bin/npm-cli.js")].find(path=>path&&existsSync(path));
if(!npmPath)throw Error("Native npm CLI was not found");
const npmCommand=args=>({executable:process.execPath,args:[npmPath,...args]});
const tasks=[
 {id:"lint",command:npmCommand(["run","lint"])},
 ...["time-docs-audit","rate-limit","env-policies","storage","health-cors","input-errors","env-loader","hardening-config"].map(name=>({id:"unit-"+name,command:{executable:process.execPath,args:["--test","tests/"+name+".test.mjs"]}})),
 {id:"openapi",command:npmCommand(["run","api-docs:check"])},
 {id:"schema",command:npmCommand(["exec","--","prisma","validate"])},
 {id:"dependency-audit",command:npmCommand(["audit","--json"])}
];
await writeFile(join(directory,"plan.json"),JSON.stringify({authoredAt:new Date().toISOString(),tasks,timeoutMs:180000},null,2));
const results=[];
for(const task of tasks){const log=join(directory,task.id+".log");const result=await collectProcessCase({...task.command,cwd:project},log,{...process.env},180000);results.push({id:task.id,log,...result});console.log((result.exitCode===0?"PASS ":"FAIL ")+task.id);}
await writeFile(join(directory,"results.json"),JSON.stringify(results,null,2));console.log("Diagnostics: "+directory);
if(results.some(result=>result.exitCode!==0||result.error))process.exitCode=1;
