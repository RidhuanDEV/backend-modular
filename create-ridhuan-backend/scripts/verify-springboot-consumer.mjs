import assert from "node:assert/strict";
import {writeFileSync} from "node:fs";
import { mkdtemp, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { command } from "../dist/process.js";
import { verifySpringbootRuntime } from "./verify-springboot-runtime.mjs";
const database=process.argv[2]??"postgresql";
assert(["postgresql","mysql"].includes(database));
const root=resolve(import.meta.dirname,".."),scratch=await mkdtemp(join(tmpdir(),"springboot-consumer-"));
const project=join(scratch,"verified-java"),diagnostics=await mkdtemp(join(tmpdir(),"spring-consumer-logs-"));
 const results=[];
function run(id,name,args,cwd=project){const result=command(name,args,cwd);const log=join(diagnostics,id+".log");writeFileSync(log,(result.stdout??"")+"\n"+(result.stderr??""));results.push({id,exitCode:result.status,error:result.error?.message,log});return result;}
function requirePass(result){assert.equal(result.status,0,result.stderr||result.stdout);}
try{
 let archive=process.env.CLI_TARBALL;
 if(!archive){const pack=run("pack","npm",["pack","--ignore-scripts","--json","--pack-destination",scratch],root);requirePass(pack);archive=join(scratch,JSON.parse(pack.stdout)[0].filename);}
 await writeFile(join(scratch,"package.json"),'{"name":"spring-consumer","private":true}\n');
 requirePass(run("install-package","npm",["install","--ignore-scripts","--no-audit","--no-fund",resolve(archive)],scratch));
 const invalidJdk=command("node",[join(scratch,"node_modules/create-ridhuan-backend/dist/bin/index.js"),"invalid-jdk-home","--template","springboot","--database",database,"--yes"],scratch,false,{JAVA_HOME:join(scratch,"missing-jdk")});
 await writeFile(join(diagnostics,"preflight-invalid-java-home.log"),(invalidJdk.stdout??"")+(invalidJdk.stderr??""));
 assert.notEqual(invalidJdk.status,0);assert.notEqual(invalidJdk.status,null);assert.match(invalidJdk.stderr,/Maven Wrapper requires a complete JDK/);
 assert(!(await readdir(scratch)).includes("invalid-jdk-home"));
 results.push({id:"preflight-invalid-java-home",exitCode:0,observedExitCode:invalidJdk.status,expectedFailure:true,log:join(diagnostics,"preflight-invalid-java-home.log")});
 requirePass(run("generate","node",[join(scratch,"node_modules/create-ridhuan-backend/dist/bin/index.js"),"verified-java","--template","springboot","--database",database,"--java-package","id.ridhuan.verified","--yes"],scratch));
 const pom=await readFile(join(project,"pom.xml"),"utf8");assert(pom.includes("<artifactId>verified-java</artifactId>"));assert(pom.includes("id.ridhuan.verified.BackendApplication"));
 requirePass(run("full-build","mvnw",["-B","-Dmaven.test.skip=true","package"]));
 requirePass(run("generator","java",["-jar","target/app.jar","--app.mode=generate-module","--module.name=Invoice"]));
 requirePass(run("generated-build","mvnw",["-B","-Dmaven.test.skip=true","package"]));
 const refuse=run("generator-refuses-overwrite","java",["-jar","target/app.jar","--app.mode=generate-module","--module.name=Invoice"]);assert.notEqual(refuse.status,0);results.pop();
 const registry=JSON.parse(await readFile(join(project,"contracts/endpoints.json"),"utf8"));assert.equal(registry.operations.length,38);
 const invalid=run("invalid-java-package","node",[join(scratch,"node_modules/create-ridhuan-backend/dist/bin/index.js"),"invalid","--template","springboot","--java-package","com.class.bad","--yes","--no-install"],scratch);assert.notEqual(invalid.status,0);results.pop();
 // Independent unit and formatting checks collect even when another fails.
 run("native-unit","mvnw",["-B","-Dtest=CoreTest,StorageScopeTest,StreamConnectionTest","test"]);
 requirePass(run("format-generated","mvnw",["-B","spotless:apply"]));run("format-check","mvnw",["-B","spotless:check"]);
 if(process.env.CLI_RUNTIME_TEST==="true"){
  const previous=process.env.SPRING_SCENARIOS;
  try{process.env.SPRING_SCENARIOS="generated-invoice-real-provider-migration-permission-crud,registry-openapi-dto-rbac,auth-sliding-replay-logout-concurrency,outbox-snapshot-delivery-fencing";await verifySpringbootRuntime(database,"manual");}
  finally{if(previous===undefined)delete process.env.SPRING_SCENARIOS;else process.env.SPRING_SCENARIOS=previous;}
 }
 console.log("Spring tarball/native generator "+database+": "+(results.every(r=>r.exitCode===0)?"PASS":"FAIL"));
}finally{
 for(const result of results.filter(item=>item.exitCode!==0)) {
  console.error("Failed Spring consumer task: "+result.id+"; exit="+result.exitCode+"; "+(result.error??""));
  console.error((await readFile(result.log,"utf8")).slice(-20000));
 }
 const log=join(tmpdir(),"springboot-consumer-results-"+database+"-"+Date.now()+".json");await writeFile(log,JSON.stringify(results,null,2));console.log("Consumer diagnostics: "+log);
 assert(resolve(scratch).startsWith(resolve(tmpdir())+sep));await rm(scratch,{recursive:true,force:true});
}
if(results.some(r=>r.exitCode!==0))process.exitCode=1;
