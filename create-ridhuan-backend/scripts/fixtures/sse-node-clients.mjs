import assert from "node:assert/strict";
import {request as httpRequest} from "node:http";

assert.equal(process.versions.node,"24.19.0");
const base="http://127.0.0.1:8080",token=process.env.FIXTURE_TOKEN;
assert(token);const controllers=[],readers=[],sockets=[];
async function status(){const r=await fetch(base+"/api/notifications/stream",{headers:{authorization:"Bearer "+token},signal:AbortSignal.timeout(4000)});const code=r.status;await r.body?.cancel();return code;}
try {
 if(process.argv[2]==="linux-fetch-abort") {
  for(let i=0;i<16;i++){const c=new AbortController();controllers.push(c);const r=await fetch(base+"/api/notifications/stream",{headers:{authorization:"Bearer "+token},signal:AbortSignal.any([c.signal,AbortSignal.timeout(90000)])});assert.equal(r.status,200,"stream"+(i+1));readers.push(r.body.getReader());}
  assert.equal(await status(),503);controllers.forEach(c=>c.abort());await Promise.allSettled(readers.map(r=>r.cancel()));
 }else {
  assert.equal(process.argv[2],"linux-http-reset");
  for(let i=0;i<16;i++)await new Promise((resolve,reject)=>{const req=httpRequest(base+"/api/notifications/stream",{agent:false,headers:{authorization:"Bearer "+token,connection:"close"}},res=>{try{assert.equal(res.statusCode,200);res.on("error",()=>{});res.resume();assert(req.socket);sockets.push(req.socket);console.log("OPENED "+(i+1));resolve();}catch(e){reject(e);}});req.on("error",error=>reject(new Error("stream "+(i+1)+": "+error.message,{cause:error})));req.setTimeout(30000,()=>req.destroy(Error("HTTP stream headers timeout")));req.end();});
  assert.equal(await status(),503);sockets.forEach(s=>s.resetAndDestroy());
 }
 console.log("INTERNAL_16_ADMITTED_17_REJECTED_CLIENTS_CLOSED");
} finally {
 controllers.forEach(c=>c.abort());sockets.forEach(s=>s.destroy());await Promise.allSettled(readers.map(r=>r.cancel()));
}
