import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { randomUUID, createHash, createHmac } from "node:crypto";
import { createServer } from "node:net";
import { request as httpRequest } from "node:http";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { command } from "../dist/process.js";
import pg from "pg";
import mysql from "mysql2/promise";
import { createSmtpFixture } from "./fixtures/spring-smtp.mjs";

const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function port(){const s=createServer();await new Promise((r,j)=>{s.once("error",j);s.listen(0,"127.0.0.1",r);});const address=s.address();assert(address&&typeof address==="object");await new Promise(r=>s.close(r));return address.port;}
export async function verifySpringbootRuntime(provider,mode="manual"){
 assert(["postgresql","mysql"].includes(provider));
 assert(["manual","compose"].includes(mode));
 const selected=process.env.SPRING_SCENARIOS?.split(",");
 const scenarioInventory=[
  ...(mode==="manual"?["generated-invoice-real-provider-migration-permission-crud"]:[]),
  "registry-openapi-dto-rbac","auth-sliding-replay-logout-concurrency","audit-required-rollback-optional-savepoint",
  "sse-120-backlog-cursors-concurrency-ownership","crud-and-rbac-privilege-boundaries","sse-expiry-inactive-admission-and-cancel",
  "sse-slow-client-write-timeout-and-slot-recovery","local-upload-stream-content","outbox-snapshot-delivery-fencing",
  "two-workers-renewal-snapshot-and-accepted-retry","worker-real-lease-renewal-and-compose-graceful-shutdown",
  "cleanup-dry-run-retention-active-family","redis-cache-scope-invalidation-outage","shared-redis-quota-across-two-replicas",
  "s3-upload-download-and-compensation","telemetry-labels-redaction-and-collector-outage",
  "smtp-starttls-implicit-tls-hostname-verification","database-outage-live-ready-and-stream-eof"
 ];
 assert(!selected||(selected.length>0&&new Set(selected).size===selected.length&&selected.every(id=>scenarioInventory.includes(id))),"Unknown, duplicate or unavailable runtime scenario");
 if(!selected||selected.includes("sse-slow-client-write-timeout-and-slot-recovery")){
  const python=command("python",["--version"],resolve(import.meta.dirname,".."));
  assert.equal(python.status,0,"Python3.13.3 is required by the controlled slow TCP fixture");
  assert.match((python.stdout??"")+(python.stderr??""),/Python 3\.13\.3(?:\s|$)/);
 }
 const cli=resolve(import.meta.dirname,".."),fixture=await mkdtemp(join(tmpdir(),"spring-runtime-"+provider+"-"));
 const project=join(fixture,"runtime-java"),owner="spring-"+randomUUID().replaceAll("-",""),results=[],children=[];
 const apiPort=await port(),dbPort=await port(),redisPort=await port(),s3Port=await port(),smtpPort=await port(),smtpControl=await port(),otelPort=await port(),dbService=provider==="mysql"?"mysql":"postgres";
 const image=owner+"-app:local";const password="fixture-quoted-$-'日本",jwt="fixture-jwt-"+randomUUID()+randomUUID();
 let sql,started=false,token;
 const env={...process.env,COMPOSE_PROJECT_NAME:owner,COMPOSE_PROFILES:"",DB_PASSWORD:password,POSTGRES_PASSWORD:password,MYSQL_PASSWORD:password,MYSQL_ROOT_PASSWORD:"fixture-root-"+randomUUID()};
 const logs=join(fixture,"diagnostics");await mkdir(logs);
 await writeFile(join(logs,"plan.json"),JSON.stringify({provider,mode,scenarioInventory,selected:selected??scenarioInventory,assertions:"Defined complete scenario tasks below",cleanup:"owned fixture resources finally; verify absence"},null,2));
 function run(name,args,cwd=project,allowed=false){const r=command(name,args,cwd,false,env);if(!allowed)assert.equal(r.status,0,(r.error?.message??"")+(r.stdout??"")+(r.stderr??""));return r;}
 const compose=(...args)=>run("docker",["compose","--project-name",owner,"-f","compose.yaml","-f","fixture.yaml","-f","optional.yaml",...args]);
 async function scenario(id,task){if(selected&&!selected.includes(id))return;try{await task();results.push({id,status:"PASS"});console.log("PASS "+id);}catch(error){results.push({id,status:"FAIL",error:error instanceof Error?error.message:String(error),stack:error instanceof Error?error.stack:undefined,cause:error instanceof Error&&error.cause instanceof Error?{message:error.cause.message,code:typeof error.cause.code==="string"?error.cause.code:undefined,stack:error.cause.stack}:undefined});console.error("FAIL "+id+": "+results.at(-1).error);if(results.at(-1).cause)console.error(JSON.stringify(results.at(-1).cause));
   if(mode==="compose"){const state=run("docker",["compose","--project-name",owner,"-f","compose.yaml","-f","fixture.yaml","-f","optional.yaml","ps","-a","--format","json"],project,true);await writeFile(join(logs,id+"-compose-state.json"),state.stdout??"");const captured=run("docker",["compose","--project-name",owner,"-f","compose.yaml","-f","fixture.yaml","-f","optional.yaml","logs","--no-color","--tail","100","app","worker","minio","minio-init"],project,true);await writeFile(join(logs,id+"-compose.log"),(captured.stdout??"")+(captured.stderr??""));}
  }}
 async function request(path,{body,method="GET",token,status=200,headers={}}={}){
  const response=await fetch("http://127.0.0.1:"+apiPort+path,{method,headers:{...(body?{"content-type":"application/json"}:{}),...(token?{authorization:"Bearer "+token}:{}),...headers},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
  const text=await response.text();assert.equal(response.status,status,method+" "+path+": "+text);return status===204?null:JSON.parse(text);
 }
 async function ready(expected=200){for(let n=0;n<90;n++){try{const r=await fetch("http://127.0.0.1:"+apiPort+"/ready",{signal:AbortSignal.timeout(3000)});if(r.status===expected)return;}catch{}await wait(1000);}throw new Error("Readiness timeout expected "+expected);}
 async function query(statement,args=[]){if(provider==="mysql"){const [rows]=await (args.length?sql.execute(statement,args):sql.query(statement));return rows;}return (await sql.query(statement,args)).rows;}

 async function auditFault(enable){
  if(enable){
   if(provider==="mysql")await query("CREATE TRIGGER fixture_upload_audit BEFORE INSERT ON activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='fixture'");
   else{await query("CREATE FUNCTION fixture_upload_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture'; END $$");await query("CREATE TRIGGER fixture_upload_audit BEFORE INSERT ON activity_logs FOR EACH ROW EXECUTE FUNCTION fixture_upload_fault()");}
  }else{await query("DROP TRIGGER fixture_upload_audit"+(provider==="mysql"?"":" ON activity_logs"));if(provider!=="mysql")await query("DROP FUNCTION fixture_upload_fault()");}
 }
 async function objectCount(storage){
  if(storage==="local"){
   if(mode==="manual")return (await import("node:fs/promises")).readdir(join(project,"uploads")).then(files=>files.filter(f=>/^[a-f0-9-]{36}$/.test(f)).length);
   const listed=compose("run","--rm","--no-deps","--entrypoint","/bin/sh","app","-c","find /app/uploads -maxdepth 1 -type f -printf '%f\\n'");
   return listed.stdout.split(/\r?\n/).filter(f=>/^[a-f0-9-]{36}$/.test(f)).length;
  }
  const listed=compose("--profile","s3","run","--rm","--no-deps","--entrypoint","/bin/sh","minio-init","-c",'mc alias set -- local http://minio:9000 "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY" >/dev/null && mc ls --recursive --json "local/$S3_BUCKET"');
  return listed.stdout.split(/\r?\n/).filter(v=>v.startsWith("{")).map(v=>JSON.parse(v)).filter(v=>v.type==="file").length;
 }
 async function compensation(storage){
  const before=await objectCount(storage),rows=await query("SELECT COUNT(*) AS count FROM stored_files");
  await auditFault(true);
  try{const form=new FormData();form.append("file",new Blob(["%PDF-1.4\nrollback"],{type:"application/pdf"}),"rollback.pdf");const response=await fetch("http://127.0.0.1:"+apiPort+"/api/upload",{method:"POST",headers:{authorization:"Bearer "+token},body:form,signal:AbortSignal.timeout(30000)});assert.equal(response.status,500);}
  finally{await auditFault(false);}
  assert.equal(await objectCount(storage),before);assert.equal(String((await query("SELECT COUNT(*) AS count FROM stored_files"))[0].count),String(rows[0].count));
 }
 async function java(role,extra=[]){return run("java",["-jar","target/app.jar","--app.mode="+role,...extra]);}
 function startJava(role){const child=spawn("java",["-jar","target/app.jar","--app.mode="+role],{cwd:project,env,shell:false,windowsHide:true,stdio:["ignore","pipe","pipe"]});child.role=role;children.push(child);let output="";child.stdout.on("data",v=>output+=v);child.stderr.on("data",v=>output+=v);const ordinal=children.length;child.on("close",()=>writeFile(join(logs,role+"-"+ordinal+".log"),output.replaceAll(password,"[fixture-password]")));return child;}
 async function stop(child){if(!child||child.exitCode!==null)return;if(process.platform==="win32")run("taskkill",["/PID",String(child.pid),"/T","/F"],project,true);else child.kill("SIGTERM");await Promise.race([new Promise(r=>child.once("close",r)),wait(35000)]);}
 let smtp;
 try{
  let tarball=process.env.CLI_TARBALL;if(!tarball){const packed=run("npm",["pack","--ignore-scripts","--json","--pack-destination",fixture],cli);tarball=join(fixture,JSON.parse(packed.stdout)[0].filename);}
  await writeFile(join(fixture,"package.json"),'{"name":"spring-runtime","private":true}\n');
  run("npm",["install","--ignore-scripts","--no-audit","--no-fund",resolve(tarball)],fixture);
  run("node",[join(fixture,"node_modules/create-ridhuan-backend/dist/bin/index.js"),"runtime-java","--template","springboot","--database",provider,"--yes","--no-install","--port",String(apiPort),"--db-port",String(dbPort)],fixture);
  let generatedEnv=await readFile(join(project,".env"),"utf8");
  const replacement={DB_PASSWORD:password,JWT_SECRET:jwt,ADMIN_PASSWORD:"fixture-admin-password",RATE_AUTH_MAX:"10000",RATE_PUBLIC_MAX:"10000",RATE_INTERNAL_MAX:"10000",CLEANUP_AUDIT_RETENTION_DAYS:"365",SMTP_ENABLED:"true",SMTP_HOST:"host.docker.internal",SMTP_PORT:String(smtpPort),SMTP_AUTH:"false",SMTP_STARTTLS:"false",SMTP_SSL:"false",POSTGRES_PASSWORD:password,MYSQL_PASSWORD:password,MYSQL_ROOT_PASSWORD:env.MYSQL_ROOT_PASSWORD};
  for(const [key,value]of Object.entries(replacement))generatedEnv=generatedEnv.replace(new RegExp("^"+key+"=.*$","m"),key+"='"+value.replaceAll("'","\\'")+"'");
  await writeFile(join(project,".env"),generatedEnv);
  Object.assign(env,{PORT:String(apiPort),DB_PROVIDER:provider,DB_HOST:"127.0.0.1",DB_PORT:String(dbPort),DB_NAME:"runtime_java",DB_USER:provider==="mysql"?"backend":"postgres", POSTGRES_DB:"runtime_java", POSTGRES_USER:"postgres", MYSQL_DATABASE:"runtime_java", MYSQL_USER:"backend",ADMIN_PASSWORD:"fixture-admin-password",JWT_SECRET:jwt,RATE_AUTH_MAX:"10000",RATE_PUBLIC_MAX:"10000",RATE_INTERNAL_MAX:"10000",SMTP_ENABLED:"true",SMTP_HOST:"127.0.0.1",SMTP_PORT:String(smtpPort),SMTP_AUTH:"false",SMTP_STARTTLS:"false",SMTP_SSL:"false"});
  await writeFile(join(project,"fixture.yaml"),"services:\n  app:\n    image: "+image+"\n    extra_hosts: ['host.docker.internal:host-gateway']\n    environment:\n      RATE_AUTH_MAX: '10000'\n      RATE_PUBLIC_MAX: '10000'\n      RATE_INTERNAL_MAX: '10000'\n      SMTP_HOST: host.docker.internal\n  worker:\n    extra_hosts: ['host.docker.internal:host-gateway']\n  "+dbService+":\n"+(provider==="mysql"?"    environment:\n      MYSQL_ROOT_HOST: '%'\n":"")+"    ports: !override ['127.0.0.1:"+dbPort+":"+(provider==="mysql"?3306:5432)+"']\n  redis:\n    ports: !override ['127.0.0.1:"+redisPort+":6379']\n  minio:\n    ports: !override ['127.0.0.1:"+s3Port+":9000']\n");
  await writeFile(join(project,"optional.yaml"),JSON.stringify({services:{}}));
  await writeFile(join(fixture,"ownership.json"),JSON.stringify({owner,project,mode,provider}));console.log("SPRING_FIXTURE="+fixture);console.log("SPRING_OWNER="+owner);
  started=true;compose("up","-d","--wait",dbService,"redis");
  // Fault-injection triggers require the fixture database owner's privileges.
  // HTTP, migrations and workers continue to use the generated application account.
  sql=provider==="mysql"?await mysql.createConnection({host:"127.0.0.1",port:dbPort,user:"root",password:env.MYSQL_ROOT_PASSWORD,database:"runtime_java",dateStrings:true}):new pg.Client({host:"127.0.0.1",port:dbPort,user:"postgres",password,database:"runtime_java"});sql.on("error",error=>results.push({id:"fixture-database-connection",status:"FAIL",error:error.code??"Database connection lost"}));if(provider!=="mysql")await sql.connect();
  smtp=await createSmtpFixture({port:smtpPort,httpPort:smtpControl});
  if(mode==="compose"){compose("--profile","*","build");compose("up","-d","--no-build","--wait","app","worker");compose("--profile","seed","run","--rm","seeder");}
  else{
   if(!selected||selected.includes("s3-upload-download-and-compensation"))compose("--profile","s3","build","minio","minio-init");
   run("mvnw",["-B","-Dmaven.test.skip=true","package"]);
   await java("generate-module",["--module.name=Invoice"]);
   run("mvnw",["-B","-Dmaven.test.skip=true","spotless:apply","package"]);
   await java("migrate");await java("seed");startJava("http");startJava("email-worker");
  }
  await ready();const credentials={email:"admin@example.com",password:"fixture-admin-password"};
  const login=()=>request("/api/auth/login",{method:"POST",body:credentials});
  token=(await login()).data.token;let admin=(await request("/api/auth/me",{token})).data;
  if(mode==="manual")await scenario("generated-invoice-real-provider-migration-permission-crud",async()=>{
   await request("/api/invoices",{status:401});await request("/api/invoices",{token,status:403});
   const permission=(await request("/api/permissions",{token})).data.find(p=>p.name==="manage_invoices");assert(permission,"Generated migration did not create permission");
   // Newly introduced rights are bootstrapped explicitly by the database owner;
   // the API correctly forbids an actor from granting a right it does not hold.
   await query("INSERT INTO role_permissions(role_id,permission_id) VALUES("+(provider==="mysql"?"?,?":"$1,$2")+")",[admin.roleId,permission.id]);
   await request("/api/invoices",{method:"POST",token,body:{},status:400});
   const invoice=(await request("/api/invoices",{method:"POST",token,body:{name:"Generated invoice"},status:201})).data;
   assert.deepEqual(Object.keys(invoice).sort(),["createdAt","id","name","updatedAt"]);
   assert.equal((await request("/api/invoices/"+invoice.id,{token})).data.name,"Generated invoice");
   assert.equal((await request("/api/invoices/"+invoice.id,{method:"PATCH",token,body:{name:"Changed invoice"}})).data.name,"Changed invoice");
   assert.equal((await request("/api/invoices",{token})).data.length,1);
   await request("/api/invoices/"+invoice.id,{method:"DELETE",token,status:204});await request("/api/invoices/"+invoice.id,{token,status:404});
   assert.equal(Number((await query("SELECT COUNT(*) AS count FROM activity_logs WHERE module='invoice'"))[0].count),3);
  });
  await scenario("registry-openapi-dto-rbac",async()=>{
   const cold=await request("/docs/specs/auth.json");assert(cold.paths["/api/auth/login"],"Cold module specification is empty");const spec=await request("/docs/openapi.json");for(const operation of JSON.parse(await readFile(join(project,"contracts/endpoints.json"),"utf8")).operations){if(operation.module==="docs")continue;assert(spec.paths[operation.path]?.[operation.method.toLowerCase()],"Missing OpenAPI "+operation.id);}
   assert(spec.paths["/api/users"].get.responses["403"].content["application/json"].schema);
   await request("/api/missing-fixture-route",{token,status:404});await request("/api/auth/login",{method:"POST",body:{},status:400});
   const empty=new FormData();empty.append("other","missing file");const missing=await fetch("http://127.0.0.1:"+apiPort+"/api/upload",{method:"POST",headers:{authorization:"Bearer "+token},body:empty,signal:AbortSignal.timeout(10000)});assert.equal(missing.status,400);
   const me=await request("/api/auth/me",{token});assert(!JSON.stringify(me).includes("password"));assert.equal(me.data.id,admin.id);
   const projected=(await request("/api/users?fields=id,email",{token})).data;assert(projected.length);assert.deepEqual(Object.keys(projected[0]).sort(),["email","id"]);
   const moduleSpec=await request("/docs/specs/auth.json");assert(moduleSpec.paths["/api/auth/login"]);assert(Object.keys(moduleSpec.paths).every(path=>path.startsWith("/api/auth/")));
   const email="plain-"+randomUUID()+"@example.com";await request("/api/auth/register",{method:"POST",body:{email,password:"plain-password"},status:201});
   const plain=(await request("/api/auth/login",{method:"POST",body:{email,password:"plain-password"}})).data.token;
   await request("/api/users",{token:plain,status:403});await request("/api/notifications/stream",{status:401});
   const bad=await fetch("http://127.0.0.1:"+apiPort+"/health",{headers:{origin:"https://bad.example"},signal:AbortSignal.timeout(3000)});assert(!bad.headers.get("access-control-allow-origin"));
  });
  await scenario("auth-sliding-replay-logout-concurrency",async()=>{
   const pair=(await login()).data;const claims=JSON.parse(Buffer.from(pair.token.split(".")[1],"base64url"));assert.equal(claims.exp-claims.iat,900);
   const hash=createHash("sha256").update(pair.refreshToken).digest("hex");const old=(await query("SELECT * FROM refresh_tokens WHERE token_hash=?".replace("?",provider==="mysql"?"?":"$1"),[hash]))[0];
   await query("UPDATE refresh_families SET created_at='"+new Date(Date.now()-150*86400000).toISOString().replace("T"," ").replace("Z","")+"' WHERE id='"+old.family_id+"'");
   const rotated=(await request("/api/auth/refresh",{method:"POST",body:{refreshToken:pair.refreshToken}})).data;
   const preserved=(await query("SELECT * FROM refresh_tokens WHERE token_hash=?".replace("?",provider==="mysql"?"?":"$1"),[hash]))[0];assert.equal(String(preserved.expires_at),String(old.expires_at));
   await request("/api/auth/refresh",{method:"POST",body:{refreshToken:pair.refreshToken},status:401});await request("/api/auth/refresh",{method:"POST",body:{refreshToken:rotated.refreshToken},status:401});
   const concurrent=(await login()).data;const responses=await Promise.all([1,2].map(()=>fetch("http://127.0.0.1:"+apiPort+"/api/auth/refresh",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({refreshToken:concurrent.refreshToken}),signal:AbortSignal.timeout(10000)})));assert.deepEqual(responses.map(r=>r.status).sort(),[200,401]);const winner=await responses.find(r=>r.status===200).json();await request("/api/auth/refresh",{method:"POST",body:{refreshToken:winner.data.refreshToken},status:401});
   const before=(await login()).data,after=(await request("/api/auth/refresh",{method:"POST",body:{refreshToken:before.refreshToken}})).data;await request("/api/auth/logout",{method:"POST",body:{refreshToken:before.refreshToken},status:204});await request("/api/auth/refresh",{method:"POST",body:{refreshToken:after.refreshToken},status:401});await request("/api/auth/logout",{method:"POST",body:{refreshToken:"unknown"},status:204});
  });
  await scenario("audit-required-rollback-optional-savepoint",async()=>{
   const roles=(await request("/api/roles",{token})).data,role=roles.find(r=>r.name==="USER").id;
   if(provider==="mysql")await query("CREATE TRIGGER fixture_audit BEFORE INSERT ON activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='fixture'");
   else{await query("CREATE FUNCTION fixture_audit_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture'; END $$");await query("CREATE TRIGGER fixture_audit BEFORE INSERT ON activity_logs FOR EACH ROW EXECUTE FUNCTION fixture_audit_fault()");}
   try{
    const email="rollback-"+randomUUID()+"@example.com";await request("/api/users",{method:"POST",token,body:{email,password:"fixture-password",roleId:role},status:500});
    const count=await query("SELECT COUNT(*) AS count FROM app_users WHERE email=?".replace("?",provider==="mysql"?"?":"$1"),[email]);assert.equal(Number(count[0].count),0);
    assert((await login()).data.refreshToken,"Optional audit failure rolled back login");
   }finally{await query("DROP TRIGGER fixture_audit"+(provider==="mysql"?"":" ON activity_logs"));if(provider!=="mysql")await query("DROP FUNCTION fixture_audit_fault()");}
  });
  await scenario("sse-120-backlog-cursors-concurrency-ownership",async()=>{
   const email="sse-"+randomUUID()+"@example.com";const user=(await request("/api/auth/register",{method:"POST",body:{email,password:"fixture-password"},status:201})).data;
   const own=(await request("/api/auth/login",{method:"POST",body:{email,password:"fixture-password"}})).data.token;
   const ids=[];for(let n=0;n<120;n++)ids.push((await request("/api/notifications",{method:"POST",token,body:{recipientId:user.id,title:"n"+n,body:"body"},status:201})).data.id);
   const response=await fetch("http://127.0.0.1:"+apiPort+"/api/notifications/stream",{headers:{authorization:"Bearer "+own},signal:AbortSignal.timeout(15000)});assert.equal(response.status,200);const reader=response.body.getReader();let text="";
   try{while((text.match(/event:notification/g)??[]).length<120){const item=await reader.read();assert(!item.done,"Stream closed before full backlog");text+=new TextDecoder().decode(item.value);}assert.equal(new Set([...text.matchAll(/id:([^\n]+)/g)].map(m=>m[1].trim())).size,120);}finally{await reader.cancel();}
   await request("/api/notifications/"+ids[119]+"/read",{method:"PATCH",token:own});await request("/api/notifications?cursor="+ids[119],{token,status:400});
   const reconnect=await fetch("http://127.0.0.1:"+apiPort+"/api/notifications/stream",{headers:{authorization:"Bearer "+own,"Last-Event-ID":ids[118]},signal:AbortSignal.timeout(5000)});const reconnectReader=reconnect.body.getReader();try{let text="";while(!text.includes(ids[119])){const data=await reconnectReader.read();assert(!data.done);text+=new TextDecoder().decode(data.value);}}finally{await reconnectReader.cancel();}
   await Promise.all(Array.from({length:8},(_,n)=>request("/api/notifications",{method:"POST",token,body:{recipientId:user.id,title:"concurrent"+n,body:"body"},status:201})));
   const sequence=await query("SELECT sequence FROM notifications WHERE recipient_id='"+user.id+"' ORDER BY sequence");assert.equal(sequence.length,128);assert.equal(new Set(sequence.map(v=>String(v.sequence))).size,128);
  });

  await scenario("crud-and-rbac-privilege-boundaries",async()=>{
   const permissions=(await request("/api/permissions",{token})).data,permission=name=>permissions.find(p=>p.name===name).id;
   const role=(await request("/api/roles",{method:"POST",token,body:{name:"manager-"+randomUUID().slice(0,8)},status:201})).data;
   await request("/api/roles/"+role.id,{token});await request("/api/roles/"+role.id,{method:"PATCH",token,body:{name:"manager-updated"}});
   await request("/api/roles/"+role.id+"/permissions",{method:"POST",token,body:{permissionIds:[permission("manage_users"),permission("manage_roles")]}});
   const assigned=(await query("SELECT before_snapshot,after_snapshot FROM activity_logs WHERE endpoint_id='role.assignPermissions' AND entity_id='"+role.id+"'"))[0];assert(assigned,"Missing assignment audit");const snapshot=value=>typeof value==="string"?JSON.parse(value):value;assert.deepEqual(snapshot(assigned.before_snapshot).permissionIds,[]);assert.equal(snapshot(assigned.after_snapshot).permissionIds.length,2);
   const email="manager-"+randomUUID()+"@example.com",manager=(await request("/api/users",{method:"POST",token,body:{email,password:"fixture-password",roleId:role.id},status:201})).data;
   await request("/api/users/"+manager.id,{token});await request("/api/users/"+manager.id,{method:"PATCH",token,body:{email}});
   const limited=(await request("/api/auth/login",{method:"POST",body:{email,password:"fixture-password"}})).data.token;
   const adminRole=(await request("/api/roles",{token})).data.find(r=>r.name==="ADMIN").id;
   await request("/api/users",{method:"POST",token:limited,body:{email:"escalate@example.com",password:"fixture-password",roleId:adminRole},status:403});
   await request("/api/roles/"+role.id+"/permissions",{method:"POST",token:limited,body:{permissionIds:[permission("manage_uploads")]},status:403});
   const custom=(await request("/api/permissions",{method:"POST",token,body:{name:"fixture_"+randomUUID().replaceAll("-","")},status:201})).data;
   await query("INSERT INTO role_permissions(role_id,permission_id) VALUES('"+adminRole+"','"+custom.id+"')");
   await request("/api/permissions/"+custom.id,{token});await request("/api/permissions/"+custom.id,{method:"PATCH",token,body:{name:"renamed_"+randomUUID().replaceAll("-","")}});
   await request("/api/permissions/"+custom.id,{method:"DELETE",token,status:204});
   await request("/api/users/"+manager.id,{method:"DELETE",token,status:204});await request("/api/users/"+manager.id,{token,status:404});await request("/api/auth/me",{token:limited,status:401});
   await request("/api/roles/"+role.id,{method:"DELETE",token,status:409});
   const unused=(await request("/api/roles",{method:"POST",token,body:{name:"unused-"+randomUUID().slice(0,8)},status:201})).data;await request("/api/roles/"+unused.id,{method:"DELETE",token,status:204});
  });
  await scenario("sse-expiry-inactive-admission-and-cancel",async()=>{
   const claim=JSON.parse(Buffer.from(token.split(".")[1],"base64url"));claim.exp=Math.floor(Date.now()/1000)+5;
   const parts=[token.split(".")[0],Buffer.from(JSON.stringify(claim)).toString("base64url")];const short=parts.join(".")+"."+createHmac("sha256",jwt).update(parts.join(".")).digest("base64url");
   async function eof(response){const reader=response.body.getReader();try{while(!(await reader.read()).done){}}finally{await reader.cancel();}}
   const expired=await fetch("http://127.0.0.1:"+apiPort+"/api/notifications/stream",{headers:{authorization:"Bearer "+short},signal:AbortSignal.timeout(12000)});assert.equal(expired.status,200);await eof(expired);
   const email="inactive-"+randomUUID()+"@example.com",user=(await request("/api/auth/register",{method:"POST",body:{email,password:"fixture-password"},status:201})).data;
   const pair=(await request("/api/auth/login",{method:"POST",body:{email,password:"fixture-password"}})).data;
   const response=await fetch("http://127.0.0.1:"+apiPort+"/api/notifications/stream",{headers:{authorization:"Bearer "+pair.token},signal:AbortSignal.timeout(12000)});
   await query("UPDATE app_users SET deleted_at=CURRENT_TIMESTAMP WHERE id='"+user.id+"'");await eof(response);await request("/api/auth/refresh",{method:"POST",body:{refreshToken:pair.refreshToken},status:401});
   // Prior cancelled sockets can require two heartbeat writes for TCP failure
   // detection. Include both 15s heartbeats, 3s polling and the 5s write budget.
   await wait(45000);const connections=[],controllers=[];
   try{
    for(let i=0;i<16;i++){const controller=new AbortController();controllers.push(controller);const stream=await fetch("http://127.0.0.1:"+apiPort+"/api/notifications/stream",{headers:{authorization:"Bearer "+token},signal:controller.signal});assert.equal(stream.status,200,"Admission failed at stream "+(i+1));connections.push(stream.body.getReader());}
    await request("/api/notifications/stream",{token,status:503});
   }finally{controllers.forEach(controller=>controller.abort());await Promise.allSettled(connections.map(reader=>reader.cancel()));}
   await wait(45000);const recovered=await fetch("http://127.0.0.1:"+apiPort+"/api/notifications/stream",{headers:{authorization:"Bearer "+token},signal:AbortSignal.timeout(5000)});
   if(recovered.status!==200&&mode==="compose"){
    compose("exec","-T","app","/bin/sh","-c","kill -3 1");await wait(1000);
    await writeFile(join(logs,"cancelled-stream-thread-dump.log"),compose("logs","--no-color","app").stdout);
   }
   assert.equal(recovered.status,200,"Cancelled stream slots did not recover within the heartbeat/write budget");await recovered.body.cancel();
  });
  await scenario("sse-slow-client-write-timeout-and-slot-recovery",async()=>{
   const email="slow-"+randomUUID()+"@example.com",recipient=(await request("/api/auth/register",{method:"POST",body:{email,password:"fixture-password"},status:201})).data;
   const access=(await request("/api/auth/login",{method:"POST",body:{email,password:"fixture-password"}})).data.token;
   // The client fixes SO_RCVBUF before connecting; Linux receive autotuning cannot absorb the backlog.
   for(let batch=0;batch<20;batch++){
    const values=Array.from({length:100},(_,i)=>"('"+randomUUID()+"','"+recipient.id+"',"+(batch*100+i+1)+",'slow','"+"x".repeat(4000)+"','NOT_REQUESTED',CURRENT_TIMESTAMP)");
    await query("INSERT INTO notifications(id,recipient_id,sequence,title,body,email_status,created_at) VALUES "+values.join(","));
   }
   await query("INSERT INTO notification_counters(recipient_id,sequence) VALUES('"+recipient.id+"',2000)");
   try{
    const client=command("python",[join(cli,"scripts/fixtures/spring-slow-client.py"),String(apiPort)],project,false,{...env,SPRING_SLOW_CLIENT_TOKEN:access});
    await writeFile(join(logs,"slow-client-window.log"),(client.stdout??"")+(client.stderr??""));
    assert.equal(client.status,0,(client.error?.message??"")+(client.stdout??"")+(client.stderr??""));
    const observation=JSON.parse(client.stdout);assert(observation.opened&&observation.closed);assert(observation.actualReceiveBuffer<=16384);
    await request("/api/auth/me",{token});
    const recovered=await fetch("http://127.0.0.1:"+apiPort+"/api/notifications/stream",{headers:{authorization:"Bearer "+token},signal:AbortSignal.timeout(5000)});assert.equal(recovered.status,200);await recovered.body.cancel();
   }finally{await query("DELETE FROM notifications WHERE recipient_id='"+recipient.id+"'");await query("UPDATE app_users SET deleted_at=CURRENT_TIMESTAMP WHERE id='"+recipient.id+"'");}
  });
  await scenario("local-upload-stream-content",async()=>{
   const content="%PDF-1.4\nfixture content",form=new FormData();form.append("file",new Blob([content],{type:"application/pdf"}),"../../fixture\r\n.pdf");
   const response=await fetch("http://127.0.0.1:"+apiPort+"/api/upload",{method:"POST",headers:{authorization:"Bearer "+token},body:form,signal:AbortSignal.timeout(10000)});assert.equal(response.status,201);const file=(await response.json()).data;assert(!("objectKey" in file));const download=await fetch("http://127.0.0.1:"+apiPort+"/api/upload/"+file.id,{headers:{authorization:"Bearer "+token,accept:"application/octet-stream"},signal:AbortSignal.timeout(10000)});assert.equal(await download.text(),content);
   await request("/api/upload/"+randomUUID(),{token,status:404});await compensation("local");
  });
  await scenario("outbox-snapshot-delivery-fencing",async()=>{
   const notice=(await request("/api/notifications",{method:"POST",token,body:{recipientId:admin.id,title:"mail",body:"immutable",sendEmail:true},status:201})).data;assert.equal(notice.emailStatus,"PENDING");
   const jobs=await query("SELECT * FROM email_jobs WHERE notification_id='"+notice.id+"'");assert.equal(jobs.length,1);assert.equal(jobs[0].recipient,admin.email);
   for(let i=0;i<40;i++){const rows=(await request("/api/notifications",{token})).data;if(rows.find(n=>n.id===notice.id)?.emailStatus==="SENT")return;await wait(1000);}throw new Error("Outbox delivery timed out");
  });

  await scenario("two-workers-renewal-snapshot-and-accepted-retry",async()=>{
   if(mode==="compose")compose("up","-d","--no-deps","--scale","worker=2","worker");else startJava("email-worker");
   const notices=await Promise.all(Array.from({length:8},(_,n)=>request("/api/notifications",{method:"POST",token,body:{recipientId:admin.id,title:"parallel"+n,body:"snapshot",sendEmail:true},status:201})));
   for(let i=0;i<40;i++){const rows=await query("SELECT status,attempts FROM email_jobs WHERE notification_id IN ("+notices.map(n=>"'"+n.data.id+"'").join(",")+")");if(rows.every(row=>row.status==="SENT")){assert(rows.every(row=>row.attempts===1));break;}if(i===39)throw Error("Two-worker delivery timeout");await wait(1000);}
   const before=(await (await fetch("http://127.0.0.1:"+smtpControl)).json()).messages;
   if(provider==="mysql")await query("CREATE TRIGGER fixture_completion BEFORE UPDATE ON email_jobs FOR EACH ROW BEGIN IF NEW.status='SENT' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='fixture'; END IF; END");
   else {await query("CREATE FUNCTION fixture_completion_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='SENT' THEN RAISE EXCEPTION 'fixture'; END IF; RETURN NEW; END $$");await query("CREATE TRIGGER fixture_completion BEFORE UPDATE ON email_jobs FOR EACH ROW EXECUTE FUNCTION fixture_completion_fault()");}
   let notice;
   try{
    notice=(await request("/api/notifications",{method:"POST",token,body:{recipientId:admin.id,title:"accepted-retry",body:"immutable",sendEmail:true},status:201})).data;
    for(let n=0;n<20;n++){if((await (await fetch("http://127.0.0.1:"+smtpControl)).json()).messages>before)break;await wait(1000);}
    assert((await (await fetch("http://127.0.0.1:"+smtpControl)).json()).messages>before);
   }finally{await query("DROP TRIGGER fixture_completion"+(provider==="mysql"?"":" ON email_jobs"));if(provider!=="mysql")await query("DROP FUNCTION fixture_completion_fault()");}
   for(let n=0;n<25;n++){const rows=await query("SELECT status,attempts,recipient,body FROM email_jobs WHERE notification_id='"+notice.id+"'");if(rows[0].status==="SENT"){assert(rows[0].attempts>=2);assert.equal(rows[0].recipient,admin.email);assert.equal(rows[0].body,"immutable");assert((await (await fetch("http://127.0.0.1:"+smtpControl)).json()).messages>=before+2);return;}await wait(1000);}throw Error("Accepted delivery recovery timeout");
  });
  await scenario("worker-real-lease-renewal-and-compose-graceful-shutdown",async()=>{
   const control="http://127.0.0.1:"+smtpControl;
   await fetch(control+"/delay",{signal:AbortSignal.timeout(3000)});
   let shutdown;
   try{
    const notice=(await request("/api/notifications",{method:"POST",token,body:{recipientId:admin.id,title:"lease-renewal",body:"delayed-accepted",sendEmail:true},status:201})).data;
    let initial;
    for(let i=0;i<12;i++){const row=(await query("SELECT * FROM email_jobs WHERE notification_id='"+notice.id+"'"))[0];if(row.status==="LEASED"){initial=row;break;}await wait(1000);}
    assert(initial,"Delayed job was not claimed");
    if(mode==="compose"){
     // The asynchronous child keeps the fixture's SMTP event loop responsive to SIGTERM drainage.
     const child=spawn("docker",["compose","--project-name",owner,"-f","compose.yaml","-f","fixture.yaml","-f","optional.yaml","stop","--timeout","35","worker"],{cwd:project,env,windowsHide:true,stdio:["ignore","pipe","pipe"]});
     shutdown=new Promise((resolve,reject)=>{let output="";child.stdout.on("data",v=>output+=v);child.stderr.on("data",v=>output+=v);const timer=setTimeout(()=>{child.kill();reject(Error("Worker graceful shutdown timeout"));},40000);child.once("error",reject);child.once("close",code=>{clearTimeout(timer);writeFile(join(logs,"worker-graceful.log"),output).then(()=>code===0?resolve():reject(Error("Worker stop exit "+code)));});});
    }
    let renewalObserved=false;
    const renewalDeadline=Date.now()+24000;
    while(Date.now()<renewalDeadline){
     const renewed=(await query("SELECT * FROM email_jobs WHERE notification_id='"+notice.id+"'"))[0];
     if(renewed.status==="LEASED"){
      assert.equal(renewed.lease_id,initial.lease_id,"Lease ownership changed during slow SMTP");
      if(new Date(renewed.lease_until)>new Date(initial.lease_until)){renewalObserved=true;break;}
     }
     await wait(200);
    }
    assert(renewalObserved,"Real scheduler did not renew the lease while SMTP remained active");
    if(shutdown)await shutdown;
    for(let i=0;i<10;i++){const final=(await query("SELECT * FROM email_jobs WHERE notification_id='"+notice.id+"'"))[0];if(final.status==="SENT"){assert.equal(final.attempts,1);return;}await wait(1000);}throw Error("Delayed SMTP confirmation did not commit");
   }finally{if(shutdown)await shutdown.catch(()=>{});await fetch(control+"/normal",{signal:AbortSignal.timeout(3000)});if(mode==="compose")compose("up","-d","--no-deps","--scale","worker=2","worker");}
  });
  await scenario("cleanup-dry-run-retention-active-family",async()=>{
   const before=(await query("SELECT COUNT(*) AS count FROM notifications"))[0].count;
   if(mode==="compose")compose("run","--rm","--no-deps","app","--app.mode=cleanup");else await java("cleanup");
   assert.equal(String((await query("SELECT COUNT(*) AS count FROM notifications"))[0].count),String(before));
  });
  async function reconfigure(settings){
   Object.assign(env,settings);
   if(mode==="compose"){
    const overrides=JSON.parse(await readFile(join(project,"optional.yaml"),"utf8"));
    for(const service of ["app","worker"]){overrides.services[service]??={};overrides.services[service].environment={...overrides.services[service].environment,...settings};}
    overrides.services["otel-collector"]={ports:["127.0.0.1:"+otelPort+":4318"]};
    await writeFile(join(project,"optional.yaml"),JSON.stringify(overrides));
    compose("up","-d","--no-deps","--wait","app","worker");
   }else{for(const child of children.filter(c=>c.role==="http"||c.role==="email-worker"))await stop(child);startJava("http");startJava("email-worker");}
   await ready(); token=(await login()).data.token;
  }
  await scenario("redis-cache-scope-invalidation-outage",async()=>{
   await reconfigure({CACHE_ENABLED:"true",RATE_LIMIT_STORE:"redis",REDIS_URL:mode==="compose"?"redis://redis:6379":"redis://127.0.0.1:"+redisPort,REDIS_NAMESPACE:owner});
   const first=(await request("/api/users?search=cacheunique",{token})).data;assert.equal(first.length,0);
   const role=(await request("/api/roles",{token})).data.find(r=>r.name==="USER").id;
   await request("/api/users",{method:"POST",token,body:{email:"cacheunique@example.com",password:"fixture-password",roleId:role},status:201});
   assert.equal((await request("/api/users?search=cacheunique",{token})).data.length,1);
   assert.equal((await request("/api/users?search=unknownunique",{token})).data.length,0);
   compose("stop","redis");await ready(503);await request("/api/auth/login",{method:"POST",body:credentials,status:503});
   await reconfigure({RATE_LIMIT_STORE:"memory"});await request("/api/users?search=cacheunique",{token});
   compose("start","redis");
  });

  await scenario("shared-redis-quota-across-two-replicas",async()=>{
   await reconfigure({RATE_LIMIT_STORE:"redis",REDIS_URL:mode==="compose"?"redis://redis:6379":"redis://127.0.0.1:"+redisPort,REDIS_NAMESPACE:owner+"-quota",RATE_AUTH_MAX:"5",RATE_AUTH_WINDOW_SECONDS:"3600"});
   const secondPort=await port();let second;
   try{
    if(mode==="compose"){
     const data=JSON.parse(await readFile(join(project,"optional.yaml"),"utf8"));
     const effective=JSON.parse(compose("config","--format","json").stdout);
     data.services.replica={...effective.services.app,ports:[{target:8080,published:String(secondPort),host_ip:"127.0.0.1",protocol:"tcp"}]};
     delete data.services.replica.depends_on;
     await writeFile(join(project,"optional.yaml"),JSON.stringify(data));compose("up","-d","--no-deps","--wait","replica");
    }else {const originalPort=env.PORT;env.PORT=String(secondPort);second=startJava("http");env.PORT=originalPort;for(let i=0;i<90;i++){try{const live=await fetch("http://127.0.0.1:"+secondPort+"/live",{signal:AbortSignal.timeout(3000)});if(live.status===200)break;}catch{}await wait(1000);if(i===89)throw Error("Replica startup timeout");}}
    // This Redis belongs exclusively to this fixture. Reset after both replicas
    // are ready so bootstrap logins and startup duration cannot consume quota.
    const secondsUntilBoundary=3600-Math.floor(Date.now()/1000)%3600;
    if(secondsUntilBoundary<=16)await wait(secondsUntilBoundary*1000+100);
    compose("exec","-T","redis","redis-cli","FLUSHDB");
    // Isolate each concurrent attempt from idle sockets held across synchronous Compose startup.
    // No retry: every transport failure still fails the scenario and all 12 responses are required.
    const collected=await Promise.allSettled(Array.from({length:12},(_,n)=>new Promise((resolve,reject)=>{
     const endpoint="http://127.0.0.1:"+(n%2?secondPort:apiPort)+"/api/auth/login";
     const fail=error=>reject(new Error("Quota HTTP request failed: "+endpoint,{cause:error}));
     const request=httpRequest(endpoint,{method:"POST",agent:false,headers:{"content-type":"application/json"},signal:AbortSignal.timeout(15000)},response=>{
      response.once("error",fail);response.resume();response.once("end",()=>resolve(response.statusCode));
     });
     request.once("error",fail);request.end(JSON.stringify({email:"unknown@example.com",password:"fixture-password"}));
    })));
    await writeFile(join(logs,"quota-http-attempts.json"),JSON.stringify(collected.map((result,index)=>({index,replica:index%2===1,status:result.status==="fulfilled"?result.value:undefined,error:result.status==="rejected"?result.reason.message:undefined,cause:result.status==="rejected"?result.reason.cause?.code:undefined})),null,2));
    const failures=collected.filter(result=>result.status==="rejected");
    if(failures.length)throw new AggregateError(failures.map(result=>result.reason),"Quota transport failures: "+failures.length,{cause:failures[0].reason});
    const attempts=collected.map(result=>result.value);
    assert.equal(attempts.length,12);assert(attempts.every(status=>[401,429].includes(status)));assert.equal(attempts.filter(status=>status===401).length,5);assert.equal(attempts.filter(status=>status===429).length,7);
   }catch(error){
    if(mode==="compose"){
     const state=run("docker",["compose","--project-name",owner,"-f","compose.yaml","-f","fixture.yaml","-f","optional.yaml","ps","-a","--format","json"],project,true);await writeFile(join(logs,"quota-replica-before-cleanup-state.json"),state.stdout??"");
     const captured=run("docker",["compose","--project-name",owner,"-f","compose.yaml","-f","fixture.yaml","-f","optional.yaml","logs","--no-color","--tail","100","replica"],project,true);await writeFile(join(logs,"quota-replica-before-cleanup.log"),(captured.stdout??"")+(captured.stderr??""));
    }
    throw error;
   }finally {
    if(mode==="compose"){compose("stop","replica");compose("rm","-f","replica");const data=JSON.parse(await readFile(join(project,"optional.yaml"),"utf8"));delete data.services.replica;await writeFile(join(project,"optional.yaml"),JSON.stringify(data));}else await stop(second);
    await reconfigure({RATE_AUTH_MAX:"10000",RATE_AUTH_WINDOW_SECONDS:"60",REDIS_NAMESPACE:owner});
   }
  });
  await scenario("s3-upload-download-and-compensation",async()=>{
   // up --wait only establishes running/healthy, not successful bucket creation.
   compose("--profile","s3","up","--no-build","-d","--wait","minio");
   // Foreground run must finish successfully before the first S3 request.
   compose("--profile","s3","run","--rm","--no-deps","--pull","never","minio-init");
   await reconfigure({UPLOAD_STORAGE:"s3",S3_PREFIX:owner,S3_ENDPOINT:mode==="compose"?"http://minio:9000":"http://127.0.0.1:"+s3Port});
   const form=new FormData(),content="%PDF-1.4\ns3 owned fixture";form.append("file",new Blob([content],{type:"application/pdf"}),"s3.pdf");
   const response=await fetch("http://127.0.0.1:"+apiPort+"/api/upload",{method:"POST",headers:{authorization:"Bearer "+token},body:form,signal:AbortSignal.timeout(30000)});assert.equal(response.status,201);const id=(await response.json()).data.id;
   const downloaded=await fetch("http://127.0.0.1:"+apiPort+"/api/upload/"+id,{headers:{authorization:"Bearer "+token,accept:"application/octet-stream"},signal:AbortSignal.timeout(10000)});assert.equal(await downloaded.text(),content);
   const listed=compose("--profile","s3","run","--rm","--no-deps","--entrypoint","/bin/sh","minio-init","-c",'mc alias set -- local http://minio:9000 "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY" >/dev/null && mc ls --recursive --json "local/$S3_BUCKET"');
   const objects=listed.stdout.split(/\r?\n/).filter(v=>v.startsWith("{")).map(v=>JSON.parse(v)).filter(v=>v.type==="file");
   assert(objects.some(object=>object.key===owner+"/"+id),"Actual S3 object must use the deployment namespace");
   await compensation("s3");
  });
  await scenario("telemetry-labels-redaction-and-collector-outage",async()=>{
   const collector=join(project,"scripts/otel-collector.yaml");await writeFile(collector,(await readFile(collector,"utf8")).replace("verbosity: basic","verbosity: detailed"));
   const telemetryOverrides=JSON.parse(await readFile(join(project,"optional.yaml"),"utf8"));telemetryOverrides.services["otel-collector"]={ports:["127.0.0.1:"+otelPort+":4318"]};await writeFile(join(project,"optional.yaml"),JSON.stringify(telemetryOverrides));
   compose("--profile","telemetry","up","-d","otel-collector");
   await reconfigure({OTEL_ENABLED:"true",OTEL_EXPORTER_OTLP_ENDPOINT:mode==="compose"?"http://otel-collector:4318/v1/traces":"http://127.0.0.1:"+otelPort+"/v1/traces",OTEL_METRICS_ENDPOINT:mode==="compose"?"http://otel-collector:4318/v1/metrics":"http://127.0.0.1:"+otelPort+"/v1/metrics"});
   const sentinel="private-"+randomUUID(),trace="0123456789abcdef0123456789abcdef";
   await request("/api/users?search="+sentinel,{token,headers:{traceparent:"00-"+trace+"-0123456789abcdef-01"}});
   let text="";for(let i=0;i<30;i++){const logs=compose("logs","--no-color","otel-collector");text=(logs.stdout??"")+(logs.stderr??"");if(text.includes(trace)&&text.includes("backend.outbox.backlog"))break;await wait(1000);}
   assert(text.includes(trace),"Trace propagation missing");assert(text.includes("backend.outbox.backlog"),"Metrics missing");for(const secret of [sentinel,password,credentials.password,credentials.email])assert(!text.includes(secret),"Telemetry contains sensitive fixture");
   compose("stop","otel-collector");await ready();await request("/live");
  });
  await scenario("smtp-starttls-implicit-tls-hostname-verification",async()=>{
   const certDir=join(fixture,"certificates");await mkdir(certDir);const cert=join(certDir,"certificate.pem"),key=join(certDir,"key.pem"),trust=join(certDir,"trust.p12"),implicitPort=await port();
   const gitPath=run("git",["--exec-path"],fixture).stdout.trim();const gitOpenSSL=resolve(gitPath,"../../../usr/bin/openssl.exe");const openssl=process.platform==="win32"&&existsSync(gitOpenSSL)?gitOpenSSL:"openssl";
   run(openssl,["req","-x509","-newkey","rsa:2048","-nodes","-days","2","-keyout",key,"-out",cert,"-subj","/CN=localhost","-addext","subjectAltName=DNS:localhost,DNS:host.docker.internal,IP:127.0.0.1"],fixture);
   run("keytool",["-importcert","-noprompt","-alias","fixture","-file",cert,"-keystore",trust,"-storetype","PKCS12","-storepass","changeit"],fixture);
   await smtp.close();smtp=await createSmtpFixture({port:smtpPort,httpPort:smtpControl,implicitPort,credentials:{cert:await readFile(cert),key:await readFile(key)}});
   if(mode==="compose"){
    const data=JSON.parse(await readFile(join(project,"optional.yaml"),"utf8"));for(const service of ["app","worker"]){data.services[service]??={};data.services[service].volumes=[trust+":/app/fixture-trust.p12:ro"];}
    await writeFile(join(project,"optional.yaml"),JSON.stringify(data));
   }
   async function deliverTLS(settings){
    const trustPath=mode==="compose"?"/app/fixture-trust.p12":trust;
    await reconfigure({...settings,JAVA_TOOL_OPTIONS:'-Djavax.net.ssl.trustStore="'+trustPath+'" -Djavax.net.ssl.trustStorePassword=changeit -Duser.timezone=UTC'});
    const notice=(await request("/api/notifications",{method:"POST",token,body:{recipientId:admin.id,title:"TLS verification",body:"fixture",sendEmail:true},status:201})).data;
    for(let i=0;i<35;i++){const rows=(await request("/api/notifications",{token})).data;if(rows.find(n=>n.id===notice.id)?.emailStatus==="SENT")return;await wait(1000);}throw new Error("TLS worker delivery timed out");
   }
   await deliverTLS({SMTP_STARTTLS:"true",SMTP_SSL:"false",SMTP_PORT:String(smtpPort)});
   await deliverTLS({SMTP_STARTTLS:"false",SMTP_SSL:"true",SMTP_PORT:String(implicitPort)});
  });
  await scenario("database-outage-live-ready-and-stream-eof",async()=>{
   const stream=await fetch("http://127.0.0.1:"+apiPort+"/api/notifications/stream",{headers:{authorization:"Bearer "+token},signal:AbortSignal.timeout(25000)});assert.equal(stream.status,200);
   await sql.end();sql=undefined;
   try{compose("stop",dbService);await ready(503);const live=await fetch("http://127.0.0.1:"+apiPort+"/live",{signal:AbortSignal.timeout(3000)});assert.equal(live.status,200);const reader=stream.body.getReader();while(!(await reader.read()).done){}}
   finally{compose("start",dbService);await ready();}
  });
 }catch(error){results.push({id:"prerequisite",status:"FAIL",error:error instanceof Error?error.message:String(error)});}
 finally{
  try{if(sql)await sql.end();}catch{}
  try{if(smtp)await smtp.close();}catch{}
  for(const child of children)await stop(child);
  if(started){
   const captured=run("docker",["compose","--project-name",owner,"-f","compose.yaml","-f","fixture.yaml","-f","optional.yaml","logs","--no-color"],project,true);await writeFile(join(logs,"compose.log"),((captured.stdout??"")+(captured.stderr??"")).replaceAll(password,"[fixture-password]"));
   const down=run("docker",["compose","--project-name",owner,"-f","compose.yaml","-f","fixture.yaml","-f","optional.yaml","--profile","*","down","-v","--remove-orphans"],project,true);if(down.status!==0)results.push({id:"cleanup-compose",status:"FAIL"});
   // Owned tags only, regardless of whether image data is shared.
   const tags=run("docker",["image","ls","--format","{{.Repository}}:{{.Tag}}"],project,true).stdout.split(/\r?\n/).filter(t=>t.startsWith(owner+"-"));
   for(const tag of tags){const removed=run("docker",["image","rm",tag],project,true);if(removed.status!==0)results.push({id:"cleanup-image",status:"FAIL",tag});}
   for(const args of [["ps","-a","--filter","label=com.docker.compose.project="+owner,"--format","{{.ID}}"],["volume","ls","--filter","label=com.docker.compose.project="+owner,"--format","{{.Name}}"],["network","ls","--filter","label=com.docker.compose.project="+owner,"--format","{{.Name}}"]]){const remaining=run("docker",args,project,true);if(remaining.status!==0||remaining.stdout.trim())results.push({id:"cleanup-verification",status:"FAIL",resource:args[0]});}
  }
  if(selected?.some(id=>!results.some(result=>result.id===id)))results.push({id:"scenario-selection",status:"FAIL",error:"Unknown or unexecuted scenario"});
  await writeFile(join(logs,"results.json"),JSON.stringify({provider,mode,owner,results},null,2));console.log("Runtime diagnostics retained: "+logs);
  assert(resolve(fixture).startsWith(resolve(tmpdir())+sep));
  // Keep only diagnostics, never secret env or template payload.
  await rm(project,{recursive:true,force:true});await rm(join(fixture,"node_modules"),{recursive:true,force:true});
 }
 if(results.some(r=>r.status!=="PASS"))throw new Error("Spring runtime stage FAILED: "+results.filter(r=>r.status!=="PASS").map(r=>r.id).join(","));
}
