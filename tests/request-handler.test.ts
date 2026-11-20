import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { executeOlympiadRequest, type RequestDependencies } from "../src/lib/request-handler";
import { AccessDenied } from "../src/lib/access";
const session={user:{id:randomUUID(),email:"synthetic@example.test",emailVerified:true}};
function request(){return new Request("http://localhost:3000/api/example",{method:"POST",headers:{origin:process.env.BETTER_AUTH_URL||"http://localhost:3000","Content-Type":"application/json"},body:JSON.stringify({editionId:randomUUID()})});}
test("session outage and denial-audit failure are fixed 503/no-store without executing mutations or leaking errors",async()=>{
 let ran=false;
 const failed:RequestDependencies={session:async()=>{throw new Error("sensitive-sql-credential");},denialAudit:async()=>{}};
 const response=await executeOlympiadRequest(request(),failed,async()=>{ran=true;});
 assert.equal(response.status,503);assert.equal(ran,false);assert.ok(response.headers.get("cache-control")?.includes("no-store"));assert.ok(!(await response.text()).includes("sensitive"));
 const audit=await executeOlympiadRequest(request(),{session:async()=>session,denialAudit:async()=>{throw new Error("private-audit");}},async()=>{throw new AccessDenied("FORBIDDEN");});
 assert.equal(audit.status,503);assert.ok(!(await audit.text()).includes("private-audit"));
 const denied=await executeOlympiadRequest(request(),{session:async()=>session,denialAudit:async()=>{}},async()=>{throw new AccessDenied("FORBIDDEN");});assert.equal(denied.status,403);
});
