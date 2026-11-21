// Dedicated container: no app source, credentials, database, Docker socket or storage mounts.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
let active = 0;
function inspect(bytes) {
 return new Promise(resolve => {
  let done=false, output="";
  const child=spawn("/usr/bin/prlimit",["--core=0","--data=268435456","--cpu=10","--",process.execPath,"--jitless","--max-old-space-size=96","/inspector/check-passive-pdf.mjs"],{stdio:["pipe","pipe","ignore"],env:{NODE_ENV:"production",TZ:"UTC"}});
  const finish=(status,body)=>{if(done)return;done=true;clearTimeout(timer);child.kill("SIGKILL");resolve({status,body});};
  const timer=setTimeout(()=>finish(503,{error:"INSPECTOR_UNAVAILABLE"}),12000);
  child.on("error",()=>finish(503,{error:"INSPECTOR_UNAVAILABLE"}));
  child.stdin.on("error",()=>{});
  child.stdout.on("data",chunk=>{output+=chunk.toString("utf8");if(output.length>512)finish(503,{error:"INSPECTOR_UNAVAILABLE"});});
  child.on("close",code=>{try{const result=JSON.parse(output);if(code===1&&result.valid===false)return finish(400,{valid:false});if(code!==0||result.valid!==true||!Number.isInteger(result.pages)||result.pages<1||result.pages>100)throw Error();finish(200,{valid:true,pages:result.pages});}catch{finish(503,{error:"INSPECTOR_UNAVAILABLE"});}});
  child.stdin.end(bytes);
 });
}
const server=createServer(async(req,res)=>{
 res.setHeader("Cache-Control","no-store");res.setHeader("Content-Type","application/json");
 const send=(status,body)=>{res.writeHead(status);res.end(JSON.stringify(body));};
 if(req.method==="GET"&&req.url==="/health")return send(200,{mode:"isolated-pdf-v1"});
 if(req.method!=="POST"||req.url!=="/inspect"||req.headers["content-type"]!=="application/pdf")return send(404,{error:"NOT_FOUND"});
 if(active>=2)return send(429,{error:"BUSY"});
 active++;let timer;
 try{
  if(Number(req.headers["content-length"]||0)>10485760)return send(413,{error:"TOO_LARGE"});
  const chunks=[];let size=0;
  timer=setTimeout(()=>req.destroy(),5000);
  for await(const chunk of req){size+=chunk.length;if(size>10485760)return send(413,{error:"TOO_LARGE"});chunks.push(chunk);}
  clearTimeout(timer);
  if(!size)return send(400,{valid:false});
  const result=await inspect(Buffer.concat(chunks));send(result.status,result.body);
 }catch{if(!res.destroyed)send(503,{error:"INSPECTOR_UNAVAILABLE"});}
 finally{clearTimeout(timer);active--;}
});
server.requestTimeout=15000;server.headersTimeout=5000;server.maxHeadersCount=16;
server.listen(3320,"0.0.0.0");
