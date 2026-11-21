// Fixed TCP relay only. It never parses a PDF or accepts an upstream destination.
import { createServer, createConnection } from "node:net";
let active=0;
createServer(client=>{
 if(active>=16){client.destroy();return;}active++;
 const upstream=createConnection({host:"pdf-inspector",port:3320});
 let closed=false;const finish=()=>{if(closed)return;closed=true;active--;clearTimeout(timer);client.destroy();upstream.destroy();};
 const timer=setTimeout(finish,20000);
 client.on("error",finish);client.on("close",finish);upstream.on("error",finish);upstream.on("close",finish);
 client.pipe(upstream);upstream.pipe(client);
}).listen(3320,"0.0.0.0");
