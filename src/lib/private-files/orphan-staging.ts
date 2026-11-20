import { constants } from "node:fs";
import { open,readdir,stat,realpath,mkdir,rename } from "node:fs/promises";
import { resolve,join,dirname } from "node:path";
import { randomUUID,createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { requireDemoOperator } from "../data-lifecycle";
// Recoverable staging only, never unlink. Caller must quiesce writers explicitly.
export async function stageOrphanFiles(db:PrismaClient,input:{directory:string;minAgeHours:number;apply:boolean;confirmedQuiesced:boolean},now=new Date()) {
 requireDemoOperator();
 if(!Number.isFinite(input.minAgeHours)||input.minAgeHours<1||!Number.isFinite(now.getTime())||now.getTime()>Date.now()+60000)throw new Error("Invalid orphan policy");
 if(input.apply&&!input.confirmedQuiesced)throw new Error("Stop writers first");
 const root=resolve(input.directory);
 for(const publicRoot of [resolve("public"),resolve(".next"),resolve("out")])if(root===publicRoot||root.startsWith(publicRoot+"/"))throw new Error("Private storage required");
 const safeDirectory=async(path:string)=>{const info=await stat(path);if(!info.isDirectory()||(info.mode&0o077)||await realpath(path)!==path)throw new Error("Unsafe private directory");};
 try{await safeDirectory(root);}catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return {candidates:0,staged:0,skipped:0};throw e;}
 const moved:{from:string;to:string}[]=[];
 try { return await db.$transaction(async tx=>{
  for(let slot=0;slot<2;slot++) {const [lock]=await tx.$queryRaw<{ok:boolean}[]>`SELECT pg_try_advisory_xact_lock(4731,${slot}::int) AS ok`;if(!lock.ok)throw new Error("File preparation in progress");}
  let candidates=0,staged=0,skipped=0;
  const destination=join(dirname(root),"orphan-staging",randomUUID());
  for(const name of await readdir(root)) {
   const match=/^([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.quarantine$/.exec(name);
   if(!match){skipped++;continue;}
   if(await tx.diplomaItem.count({where:{fileKey:match[1]}}))continue;
   const path=join(root,name),file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
   try {
    const info=await file.stat();if(!info.isFile()||info.nlink!==1||(info.mode&0o077)||info.size<1||info.size>10485760)throw new Error("Unsafe orphan file");
    if(now.getTime()-info.mtimeMs<input.minAgeHours*3600000)continue;
    candidates++;
    if(input.apply){
     const bytes=await file.readFile();if(bytes.length!==info.size)throw new Error("File changed");
     const current=await stat(path);if(current.ino!==info.ino||current.size!==info.size||current.mtimeMs!==info.mtimeMs)throw new Error("File changed");
     await mkdir(dirname(destination),{recursive:true,mode:0o700});await safeDirectory(dirname(destination));await mkdir(destination,{recursive:true,mode:0o700});await safeDirectory(destination);
     // Keep the original opaque key/name so an operator can restore it. No PDF or paths in the audit.
     const target=join(destination,name);await rename(path,target);moved.push({from:path,to:target});staged++;
     await tx.auditEvent.create({data:{action:"ORPHAN_FILE_STAGED",objectType:"Maintenance",objectId:randomUUID(),outcome:"SUCCESS",details:{size:info.size,sha256:createHash("sha256").update(bytes).digest("hex")}}});
    }
   }finally{await file.close();}
  }
  return {candidates,staged,skipped};
 },{timeout:60000});
 }catch(error){for(const move of moved.reverse())await rename(move.to,move.from).catch(()=>{});throw error;}
}
