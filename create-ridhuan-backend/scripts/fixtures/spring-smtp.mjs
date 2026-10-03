import {createServer} from "node:net";
import {createServer as createHttp} from "node:http";
import {createServer as createTls,createSecureContext,TLSSocket} from "node:tls";
export async function createSmtpFixture({port,httpPort,credentials,implicitPort}){
 let messages=0,mode="normal";const sockets=new Set(),timers=new Set();
 const secureContext=credentials?createSecureContext(credentials):undefined;
 function session(socket,greet=true){
  sockets.add(socket);socket.on("close",()=>sockets.delete(socket));socket.on("error",()=>socket.destroy());socket.setEncoding("utf8");if(greet)socket.write("220 fixture ESMTP\r\n");
  let buffered="",data=false;
  socket.on("data",chunk=>{buffered+=chunk;while(buffered.includes("\r\n")){const end=buffered.indexOf("\r\n"),line=buffered.slice(0,end);buffered=buffered.slice(end+2);
   if(data){if(line==="."){data=false;messages++;if(mode==="reject")socket.write("451 fixture retry\r\n");else if(mode==="hang"){}else if(mode==="delay"){const timer=setTimeout(()=>{timers.delete(timer);if(!socket.destroyed)socket.write("250 accepted\r\n");},23000);timers.add(timer);}else socket.write("250 accepted\r\n");}continue;}
   if(/^EHLO /i.test(line))socket.write(credentials&&!socket.encrypted?"250-fixture\r\n250-STARTTLS\r\n250 8BITMIME\r\n":"250-fixture\r\n250 8BITMIME\r\n");
   else if(line==="STARTTLS"&&secureContext){socket.write("220 Ready for TLS\r\n");socket.removeAllListeners("data");session(new TLSSocket(socket,{isServer:true,secureContext}),false);}
   else if(/^(HELO |MAIL FROM:|RCPT TO:|RSET|NOOP)/i.test(line))socket.write("250 OK\r\n");
   else if(line==="DATA"){data=true;socket.write("354 End with .\r\n");}
   else if(line==="QUIT")socket.end("221 Bye\r\n");else socket.write("502 Unsupported\r\n");
  }});
 }
 const smtp=createServer(socket=>session(socket));
 const implicit=credentials?createTls(credentials,socket=>session(socket)):undefined;
 const http=createHttp((request,response)=>{if(request.url==="/reject")mode="reject";if(request.url==="/normal")mode="normal";if(request.url==="/hang")mode="hang";if(request.url==="/delay")mode="delay";response.setHeader("content-type","application/json");response.end(JSON.stringify({messages,mode}));});
 await Promise.all([new Promise((r,j)=>{smtp.once("error",j);smtp.listen(port,"0.0.0.0",r);}),new Promise((r,j)=>{http.once("error",j);http.listen(httpPort,"0.0.0.0",r);})]);
 if(implicit)await new Promise((r,j)=>{implicit.once("error",j);implicit.listen(implicitPort,"0.0.0.0",r);});
 return {close:async()=>{for(const timer of timers)clearTimeout(timer);for(const socket of sockets)socket.destroy();await Promise.all([new Promise(r=>smtp.close(r)),new Promise(r=>http.close(r)),...(implicit?[new Promise(r=>implicit.close(r))]:[])]);}};
}
