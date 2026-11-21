import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:net";
import { scannerDatabaseStatus,ScannerUnavailable } from "../src/lib/private-files/scanner-health";
import { readUploadBody,UploadReadTimeout } from "../src/lib/private-files/upload-body";
import { BodyTooLarge } from "../src/lib/http-body";
process.env.DEMO_REGISTRATION="true";
const run=promisify(execFile);
test("isolated PDF runtime has no host data mounts, no writable root or capabilities and no external network",async()=>{
 const {stdout:id}=await run("docker",["compose","ps","-q","pdf-inspector"]);assert.ok(id.trim());
 const {stdout}=await run("docker",["inspect",id.trim()]);const [info]=JSON.parse(stdout);
 assert.equal(info.Config.User,"10001:10001");assert.equal(info.HostConfig.ReadonlyRootfs,true);assert.deepEqual(info.HostConfig.CapDrop,["ALL"]);assert.ok(info.HostConfig.SecurityOpt.includes("no-new-privileges:true"));assert.equal(info.Mounts.length,0);assert.ok(info.HostConfig.Memory>0);assert.ok(info.HostConfig.PidsLimit<=64);
 const networks=Object.values(info.NetworkSettings.Networks) as {NetworkID:string}[];assert.equal(networks.length,1);
 const inspected=await run("docker",["network","inspect",networks[0].NetworkID]);assert.equal(JSON.parse(inspected.stdout)[0].Internal,true);
 const probe='const fs=require("node:fs");if(process.getuid()!==10001)process.exit(1);try{fs.readFileSync("/workspace/siberian-maths-olympiad/.env");process.exit(2)}catch{};try{fs.writeFileSync("/inspector/probe","test");process.exit(3)}catch{};fetch("http://192.0.2.1",{signal:AbortSignal.timeout(500)}).then(()=>process.exit(4)).catch(()=>console.log("isolated"));';
 const result=await run("docker",["exec",id.trim(),"node","-e",probe]);assert.equal(result.stdout.trim(),"isolated");
 const {PDFDocument}=await import("pdf-lib"),{inspectPassivePdf}=await import("../src/lib/private-files/pdf-inspection");
 const pdf=await PDFDocument.create();pdf.addPage().drawText("Synthetic concurrent inspection");const bytes=await pdf.save();
 const concurrent=await Promise.all([inspectPassivePdf(bytes,"application/pdf"),inspectPassivePdf(bytes,"application/pdf"),run("docker",["exec",id.trim(),"node","-e","fetch('http://127.0.0.1:3320/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"])]);
 assert.equal(concurrent[0].pages,1);assert.equal(concurrent[1].pages,1);

});
test("upload reader bounds actual streamed bytes, cancels stalled transfers and accepts data at the boundary",async()=>{
 const request=(body:ReadableStream<Uint8Array>)=>new Request("http://localhost/upload",{method:"POST",body,duplex:"half"} as RequestInit);
 let cancelled=false;const slow=new ReadableStream<Uint8Array>({cancel(){cancelled=true;}});
 await assert.rejects(readUploadBody(request(slow),8,20),UploadReadTimeout);assert.equal(cancelled,true);
 const large=new ReadableStream<Uint8Array>({start(c){c.enqueue(new Uint8Array(9));}});await assert.rejects(readUploadBody(request(large),8,100),BodyTooLarge);
 const good=new ReadableStream<Uint8Array>({start(c){c.enqueue(new Uint8Array(8));c.close();}});assert.equal((await readUploadBody(request(good),8,100)).length,8);
});
test("scanner freshness is checked against loaded signatures, rejects future/malformed versions and reports stale data",async()=>{
 for(const [reply,expected] of [["ClamAV 1.5.4/28171/Sun Nov  1 06:27:34 2026\0","stale"],["ClamAV 1.5.4/28171/Sat Nov 21 00:00:00 2026\0","fresh"],["ClamAV 1.5.4/28171/Mon Nov 30 00:00:00 2026\0","reject"],["garbage\0","reject"]]){
  const server=createServer(socket=>{socket.on("data",()=>socket.end(reply));});await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));const address=server.address();assert.ok(address&&typeof address!=="string");
  try{const read=()=>scannerDatabaseStatus(address.port,1000,168,Date.parse("2026-11-21T06:00:00Z"));if(expected==="reject")await assert.rejects(read(),ScannerUnavailable);else assert.equal((await read()).fresh,expected==="fresh");}finally{await new Promise<void>(r=>server.close(()=>r()));}
 }
});
test("stale signatures stop a scan before any PDF bytes are sent to INSTREAM",async()=>{
 const {scanWithClamav}=await import("../src/lib/private-files/clamav");const old=process.env.CLAMAV_MAX_DATABASE_AGE_HOURS;process.env.CLAMAV_MAX_DATABASE_AGE_HOURS="1";
 const commands:string[]=[];const date=new Date(Date.now()-48*3600000).toUTCString().replace(",","").replace(" GMT","");
 const server=createServer(socket=>socket.on("data",bytes=>{commands.push(bytes.toString());socket.end(`ClamAV 1.5.4/28171/${date}\0`);}));await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));const address=server.address();assert.ok(address&&typeof address!=="string");
 try{await assert.rejects(scanWithClamav(Buffer.from("synthetic PDF bytes"),address.port,1000),ScannerUnavailable);assert.deepEqual(commands,["zVERSION\0"]);}finally{await new Promise<void>(r=>server.close(()=>r()));if(old===undefined)delete process.env.CLAMAV_MAX_DATABASE_AGE_HOURS;else process.env.CLAMAV_MAX_DATABASE_AGE_HOURS=old;}
});
