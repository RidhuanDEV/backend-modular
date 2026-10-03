import assert from "node:assert/strict";
import {mkdtemp,mkdir,readFile,writeFile,copyFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve,sep} from "node:path";
import {randomUUID} from "node:crypto";
import {createServer} from "node:net";
import {request as httpRequest} from "node:http";
import {command} from "../dist/process.js";

const cli=resolve(import.meta.dirname,".."),fixture=await mkdtemp(join(tmpdir(),"spring-sse-diagnostic-"));
const project=join(fixture,"sse-probe"),logs=join(fixture,"diagnostics");await mkdir(logs);
const owner="spring-"+randomUUID().replaceAll("-",""),image=owner+"-app:local";
const phase=process.argv[2]??"baseline",inventory=["windows-fetch-abort","windows-http-reset","linux-loopback-fin","linux-fetch-abort","linux-http-reset"];
assert(["baseline","candidate"].includes(phase));
const selected=process.argv.find(arg=>arg.startsWith("--only="))?.slice(7).split(",");
assert(!selected||selected.every(id=>inventory.includes(id)),"Unknown diagnostic case");
const cases=inventory.filter(id=>!selected||selected.includes(id));assert(cases.length>0);
await writeFile(join(logs,"plan.json"),JSON.stringify({owner,phase,cases,assertions:"16 streams=200; seventeenth=503; cancel all; recovery=200 within45s",timeoutSeconds:900,cleanup:"owned project containers, volumes, network and image only"},null,2));
const results=[];let started=false;
const env={...process.env,COMPOSE_PROJECT_NAME:owner,COMPOSE_PROFILES:"",RIDHUAN_DB_PASSWORD:"fixture-diagnostic-password",DB_PASSWORD:"fixture-diagnostic-password",POSTGRES_PASSWORD:"fixture-diagnostic-password",ADMIN_PASSWORD:"fixture-admin-password",SMTP_ENABLED:"false",OTEL_ENABLED:"false",RATE_AUTH_MAX:"10000",RATE_PUBLIC_MAX:"10000",RATE_INTERNAL_MAX:"10000"};
function run(name,args,allow=false,cwd=project){const r=command(name,args,cwd,false,env);if(!allow)assert.equal(r.status,0,(r.stdout??"")+(r.stderr??""));return r;}
const compose=(...args)=>run("docker",["compose","--project-name",owner,"-f","compose.yaml","-f","probe.yaml",...args]);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const server=createServer();await new Promise(r=>server.listen(0,"127.0.0.1",r));const address=server.address();assert(address&&typeof address==="object");const port=address.port;await new Promise(r=>server.close(r));
const base="http://127.0.0.1:"+port;let token;
async function ready(){for(let i=0;i<90;i++){try{const r=await fetch(base+"/ready",{signal:AbortSignal.timeout(2000)});if(r.status===200)return;}catch{}await wait(1000);}throw Error("Readiness timeout");}
async function status(){const r=await fetch(base+"/api/notifications/stream",{headers:{authorization:"Bearer "+token},signal:AbortSignal.timeout(4000)});const code=r.status;await r.body?.cancel();return code;}
async function evidence(id){compose("exec","-T","app","/bin/sh","-c","kill -3 1");await wait(1000);await writeFile(join(logs,id+"-threads.log"),compose("logs","--no-color","app").stdout);for(const name of ["tcp","tcp6"])await writeFile(join(logs,id+"-"+name+".log"),compose("exec","-T","app","cat","/proc/net/"+name).stdout);}
try{
 const tarball=process.env.CLI_TARBALL;assert(tarball,"CLI_TARBALL must name the immutable baseline artifact");
 await writeFile(join(fixture,"package.json"),'{"name":"sse-diagnostic","private":true}\n');
 run("npm",["install","--ignore-scripts","--no-audit","--no-fund",resolve(tarball)],false,fixture);
 run(process.execPath,[join(fixture,"node_modules/create-ridhuan-backend/dist/bin/index.js"),"sse-probe","--template","springboot","--database","postgresql","--java-package","com.example.backend","--yes","--no-install","--port",String(port)],false,fixture);
 if(phase==="candidate"){
  for(const file of ["platform/http/StreamProtocol.java","platform/http/StreamConnection.java","platform/http/StreamTransport.java","notifications/NotificationStreams.java","notifications/NotificationController.java"]){const dest=join(project,"src/main/java/com/example/backend",file);await mkdir(join(dest,".."),{recursive:true});await copyFile(join(cli,"../modular-springboot/src/main/java/com/example/backend",file),dest);}
 }
 await copyFile(join(cli,"scripts/fixtures/SseDiagnostic.java.txt"),join(project,"src/main/java/com/example/backend/SseDiagnostic.java"));
 if(phase==="candidate") {
  const probe=join(project,"src/main/java/com/example/backend/SseDiagnostic.java");
  await writeFile(probe,(await readFile(probe,"utf8")).replace("extends Http11NioProtocol","extends com.example.backend.platform.http.StreamProtocol"));
 }
 await copyFile(join(cli,"scripts/fixtures/sse-node-clients.mjs"),join(project,"probe-node-clients.mjs"));
 const dockerfile=join(project,"Dockerfile");await writeFile(dockerfile,(await readFile(dockerfile,"utf8"))+"\nCOPY --from=node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df /usr/local/bin/node /usr/local/bin/node\n");
 const runtimeEnv={DB_PASSWORD:env.DB_PASSWORD,ADMIN_PASSWORD:env.ADMIN_PASSWORD,SMTP_ENABLED:"false",RATE_AUTH_MAX:"10000",RATE_PUBLIC_MAX:"10000",RATE_INTERNAL_MAX:"10000"};
 await writeFile(join(project,"probe.yaml"),"services:\n  app:\n    image: "+image+"\n    ports: !override ['127.0.0.1:"+port+":8080']\n    environment: "+JSON.stringify(runtimeEnv)+"\n  migrate:\n    image: "+image+"\n    environment: "+JSON.stringify(runtimeEnv)+"\n  seeder:\n    image: "+image+"\n    environment: "+JSON.stringify(runtimeEnv)+"\n  postgres:\n    ports: !override []\n");
 await writeFile(join(fixture,"ownership.json"),JSON.stringify({owner,project,image,phase}));console.log("SSE_DIAGNOSTIC="+fixture+"; owner="+owner);
 started=true;compose("build","app");compose("up","-d","--wait","app");compose("--profile","seed","run","--rm","seeder");
 for(const id of cases){
  const controllers=[],readers=[],sockets=[];
  try{
   compose("up","-d","--no-deps","--force-recreate","--wait","app");await ready();
   const login=await fetch(base+"/api/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:"admin@example.com",password:env.ADMIN_PASSWORD}),signal:AbortSignal.timeout(10000)});assert.equal(login.status,200);token=(await login.json()).data.token;
   if(id==="windows-fetch-abort"){
    for(let i=0;i<16;i++){const c=new AbortController();controllers.push(c);const r=await fetch(base+"/api/notifications/stream",{headers:{authorization:"Bearer "+token},signal:AbortSignal.any([c.signal,AbortSignal.timeout(90000)])});assert.equal(r.status,200,"stream"+(i+1));readers.push(r.body.getReader());}
    assert.equal(await status(),503);controllers.forEach(c=>c.abort());await Promise.allSettled(readers.map(r=>r.cancel()));
   }else if(id==="windows-http-reset"){
    for(let i=0;i<16;i++)await new Promise((resolve,reject)=>{const req=httpRequest(base+"/api/notifications/stream",{agent:false,headers:{authorization:"Bearer "+token,connection:"close"}},res=>{try{assert.equal(res.statusCode,200);res.on("error",()=>{});res.resume();assert(req.socket);sockets.push(req.socket);resolve();}catch(e){reject(e);}});req.on("error",reject);req.setTimeout(30000,()=>req.destroy(Error("HTTP stream headers timeout")));req.end();});
    assert.equal(await status(),503);sockets.forEach(s=>s.resetAndDestroy());
   }else if(id.startsWith("linux-")&&id!=="linux-loopback-fin"){
    compose("cp","probe-node-clients.mjs","app:/tmp/probe-node-clients.mjs");
    const result=compose("exec","-T","-e","FIXTURE_TOKEN="+token,"app","node","/tmp/probe-node-clients.mjs",id);
    await writeFile(join(logs,id+"-client.log"),result.stdout+result.stderr);
    assert(result.stdout.includes("INTERNAL_16_ADMITTED_17_REJECTED_CLIENTS_CLOSED"));
   }else{
    const script=`set -eu
dir=/tmp/${owner}-clients
mkdir "$dir"
pids=""
cleanup() { for pid in $pids; do kill "$pid" 2>/dev/null || true; done; wait || true; rm -f "$dir"/*.headers; rmdir "$dir"; }
trap cleanup EXIT INT TERM
for n in $(seq 1 16); do curl --silent --no-buffer --max-time 30 -H "Authorization: Bearer $FIXTURE_TOKEN" -D "$dir/$n.headers" -o /dev/null http://127.0.0.1:8080/api/notifications/stream & pids="$pids $!"; done
for n in $(seq 1 16); do attempts=0; until grep -q 'HTTP/1.1 200' "$dir/$n.headers" 2>/dev/null; do attempts=$((attempts+1)); test "$attempts" -le 10; sleep 1; done; done
code=$(curl --silent --max-time 3 -H "Authorization: Bearer $FIXTURE_TOKEN" -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/api/notifications/stream)
test "$code" = 503
for pid in $pids; do kill "$pid"; done
wait || true
echo INTERNAL_16_ADMITTED_17_REJECTED_CLIENTS_CLOSED
`;
    const file=join(project,"probe-clients.sh");await writeFile(file,script);compose("cp","probe-clients.sh","app:/tmp/probe-clients.sh");const result=compose("exec","-T","-e","FIXTURE_TOKEN="+token,"app","/bin/sh","/tmp/probe-clients.sh");assert(result.stdout.includes("INTERNAL_16_ADMITTED_17_REJECTED_CLIENTS_CLOSED"));
   }
   await wait(45000);await evidence(id);const recovery=await status();assert.equal(recovery,200,"cancelled slot recovery");
   results.push({id,status:"PASS",recovery});console.log("PASS "+id);
  }catch(error){results.push({id,status:"FAIL",error:String(error),stack:error instanceof Error?error.stack:undefined});console.log("FAIL "+id+": "+error);try{await evidence(id);}catch(diagnosticError){results.push({id:id+"-evidence",status:"FAIL",error:String(diagnosticError)});}}
  finally{controllers.forEach(c=>c.abort());sockets.forEach(s=>s.destroy());await Promise.allSettled(readers.map(r=>r.cancel()));}
 }
}catch(error){results.push({id:"prerequisites",status:"FAIL",error:String(error)});}
finally{
 if(started){const cleanup=run("docker",["compose","--project-name",owner,"-f","compose.yaml","-f","probe.yaml","--profile","*","down","-v","--remove-orphans"],true);if(cleanup.status!==0)results.push({id:"cleanup",status:"FAIL"});run("docker",["image","rm",image],true);for(const args of [["ps","-a","--filter","label=com.docker.compose.project="+owner,"--format","{{.ID}}"],["volume","ls","--filter","label=com.docker.compose.project="+owner,"--format","{{.Name}}"],["network","ls","--filter","label=com.docker.compose.project="+owner,"--format","{{.Name}}"]]){const left=run("docker",args,true);if(left.status!==0||left.stdout.trim())results.push({id:"cleanup-verification",status:"FAIL",resource:args[0]});}if(run("docker",["image","inspect",image],true).status===0)results.push({id:"image-cleanup",status:"FAIL"});}
 await writeFile(join(logs,"results.json"),JSON.stringify({phase,owner,results},null,2));assert(resolve(fixture).startsWith(resolve(tmpdir())+sep));await rm(project,{recursive:true,force:true});await rm(join(fixture,"node_modules"),{recursive:true,force:true});console.log("Diagnostics: "+logs);
}
if(results.some(r=>r.status!=="PASS"))process.exitCode=1;
