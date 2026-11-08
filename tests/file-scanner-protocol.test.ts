import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Socket } from "node:net";
import { scanWithClamav, ScannerUnavailable } from "../src/lib/private-files/clamav";
process.env.DEMO_REGISTRATION="true";
// These simulated peers test failures only. CLEAN/REJECTED are tested against real clamd.
test("E09c scanner transport fails closed for timeout, malformed/error/empty/oversized responses",async()=>{
 for(const answer of [null,"stream: synthetic sensitive error ERROR\0","garbage\0","", "x".repeat(1100)]){
  const sockets=new Set<Socket>();const server=createServer(socket=>{sockets.add(socket);socket.on("error",()=>{});socket.on("data",()=>{});if(answer!==null)socket.end(answer);});
  await new Promise<void>(ok=>server.listen(0,"127.0.0.1",ok));
  const address=server.address();assert.ok(address&&typeof address!=="string");
  try{await assert.rejects(scanWithClamav(Buffer.from("synthetic"),address.port,100),error=>error instanceof ScannerUnavailable&&error.message==="FILE_SCANNER_UNAVAILABLE");}
  finally{for(const socket of sockets)socket.destroy();await new Promise<void>(ok=>server.close(()=>ok()));}
 }
});
test("E09c scanner input and demo guards reject before network I/O",async()=>{
 await assert.rejects(scanWithClamav(Buffer.alloc(0)));
 await assert.rejects(scanWithClamav(Buffer.alloc(10*1024*1024+1)));
 process.env.DEMO_REGISTRATION="false";try{await assert.rejects(scanWithClamav(Buffer.from("synthetic")));}finally{process.env.DEMO_REGISTRATION="true";}
});
