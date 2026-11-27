import "dotenv/config";
import { test,after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "../src/lib/pg-adapter";
import { hashPassword } from "better-auth/crypto";
import { consumeRateLimit,limitAuthRequest } from "../src/lib/atomic-rate-limit";
import { AdminRateLimit } from "../src/lib/admin";
import { withPreparationLease } from "../src/lib/private-files/preparation-lease";
import { saveCatalog,deleteCatalog,catalogsView } from "../src/lib/catalogs";
const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});
process.env.DEMO_REGISTRATION="true";
after(()=>db.$disconnect());
test("atomic limit admits exactly five concurrent requests and account-address buckets do not share availability or expose email",async()=>{
 const key=`regression:${randomUUID()}`;
 try{
 const race=await Promise.allSettled(Array.from({length:20},()=>consumeRateLimit(db,key,5)));
 assert.equal(race.filter(x=>x.status==="fulfilled").length,5);
 assert.ok(race.filter(x=>x.status==="rejected").every(x=>x.reason instanceof AdminRateLimit));
 const email=`limit-${randomUUID()}@example.test`;
 for(let i=0;i<3;i++)await limitAuthRequest(db,"request-password-reset",{email});
 await assert.rejects(limitAuthRequest(db,"request-password-reset",{email}),AdminRateLimit);
 await limitAuthRequest(db,"request-password-reset",{email:`other-${email}`});
 const token=randomUUID();
 for(let i=0;i<5;i++)await limitAuthRequest(db,"reset-password",{token,email:`${i}@example.test`});
 await assert.rejects(limitAuthRequest(db,"reset-password",{token,email:"bypass@example.test"}),AdminRateLimit);
 const oldMax=process.env.AUTH_IP_MAX_PER_MINUTE;process.env.AUTH_IP_MAX_PER_MINUTE="2";
 try{await limitAuthRequest(db,"sign-in/email",{email:`ip-a-${randomUUID()}@example.test`},"192.0.2.1");await limitAuthRequest(db,"sign-in/email",{email:`ip-b-${randomUUID()}@example.test`},"192.0.2.1");await assert.rejects(limitAuthRequest(db,"sign-in/email",{email:`ip-c-${randomUUID()}@example.test`},"192.0.2.1"),AdminRateLimit);await limitAuthRequest(db,"sign-in/email",{email:`ip-d-${randomUUID()}@example.test`},"192.0.2.2");}finally{if(oldMax===undefined)delete process.env.AUTH_IP_MAX_PER_MINUTE;else process.env.AUTH_IP_MAX_PER_MINUTE=oldMax;}
 const rows=await db.rateLimit.findMany({where:{key:{startsWith:"auth-v1:"}},select:{key:true}});assert.ok(!JSON.stringify(rows).includes(email));
 }finally{await db.rateLimit.deleteMany({where:{OR:[{key},{key:{startsWith:"auth-v1:"}},{key:{startsWith:"auth-ip-v1:"}}]}});}
});
test("preparation leases coordinate independent clients, bound global work and release after failure",async()=>{
 const other=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});
 let release!:()=>void,entered!:()=>void;const started=new Promise<void>(r=>entered=r),hold=new Promise<void>(r=>release=r),actor=randomUUID();
 const pending=withPreparationLease(db,actor,async()=>{entered();await hold;});
 try{await started;await assert.rejects(withPreparationLease(other,actor,async()=>{}),/Предыдущая загрузка/);await withPreparationLease(other,randomUUID(),async()=>{await assert.rejects(withPreparationLease(db,randomUUID(),async()=>{}),/другие пакеты/);});}
 finally{release();await pending;await other.$disconnect();}
 await assert.rejects(withPreparationLease(db,actor,async()=>{throw new Error("failure");}));await withPreparationLease(db,actor,async()=>{});
});
test("chief manages shared catalogs with password/revision, disables referenced entries, deletes unused entries and rejects other roles",async()=>{
 const password=`Synthetic-${randomUUID()}`,chief=await db.user.create({data:{email:`${randomUUID()}@example.test`,name:"Учебный каталог",emailVerified:true,role:"CHIEF_ORGANIZER"}});
 const edition=await db.olympiadEdition.create({data:{year:9250,title:"Учебный каталог"}});
 let university:string|undefined,course:string|undefined;
 try{
 await db.editionStaffGrant.create({data:{userId:chief.id,editionId:edition.id}});await db.account.create({data:{userId:chief.id,accountId:chief.id,providerId:"credential",password:await hashPassword(password)}});
 const scope={editionId:edition.id,password,active:true};const name=`Учебный вуз ${randomUUID()}`;
 const uni=await saveCatalog(db,chief.id,{...scope,kind:"university",name,abbreviation:"УВ"});university=uni.id;
 const c=await saveCatalog(db,chief.id,{...scope,kind:"course",name:`Курс ${randomUUID()}`});course=c.id;
 await assert.rejects(saveCatalog(db,chief.id,{...scope,kind:"university",name,abbreviation:"УВ"}));
 await saveCatalog(db,chief.id,{...scope,kind:"university",name,abbreviation:"УВ",id:uni.id,revision:uni.revision,active:false});
 assert.equal((await catalogsView(db,chief.id,{editionId:edition.id})).universities.find(x=>x.id===uni.id)?.active,false);
 await assert.rejects(saveCatalog(db,chief.id,{...scope,kind:"university",name,abbreviation:"УВ",id:uni.id,revision:0}));
 await db.rateLimit.deleteMany({where:{key:`correction-reauth:${chief.id}`}});
 const remove={editionId:edition.id,password,kind:"course",id:c.id,revision:c.revision};
 await assert.rejects(deleteCatalog(db,chief.id,{...remove,revision:1}),/уже изменён/);
 const student=await db.user.create({data:{email:`${randomUUID()}@example.test`,name:"Учебный студент",emailVerified:true}});
 try {
  await db.studentProfile.create({data:{userId:student.id,fullName:student.name,universityId:uni.id,courseId:c.id}});
  await assert.rejects(deleteCatalog(db,chief.id,remove),/уже используется/);
  await assert.rejects(deleteCatalog(db,student.id,remove));
 }finally{
  await db.auditEvent.deleteMany({where:{actorId:student.id}});
  await db.studentProfile.deleteMany({where:{userId:student.id}});
  await db.user.delete({where:{id:student.id}});
 }
 await deleteCatalog(db,chief.id,remove);
 await deleteCatalog(db,chief.id,{...remove,kind:"university",id:uni.id,revision:1});
 assert.equal(await db.courseOption.count({where:{id:c.id}}),0);
 assert.equal(await db.university.count({where:{id:uni.id}}),0);
 assert.equal(await db.auditEvent.count({where:{actorId:chief.id,action:"CATALOG_DELETED"}}),2);
 await db.user.update({where:{id:chief.id},data:{role:"VENUE_ORGANIZER"}});await assert.rejects(catalogsView(db,chief.id,{editionId:edition.id}));
 }finally{
 await db.auditEvent.deleteMany({where:{actorId:chief.id}});await db.rateLimit.deleteMany({where:{key:`correction-reauth:${chief.id}`}});await db.editionStaffGrant.deleteMany({where:{userId:chief.id}});await db.user.delete({where:{id:chief.id}});await db.olympiadEdition.delete({where:{id:edition.id}});
 if(university)await db.university.deleteMany({where:{id:university}});if(course)await db.courseOption.deleteMany({where:{id:course}});
 }
});

test("orphan staging is dry-run first, moves only old unreferenced files recoverably",async()=>{
 const {mkdtemp,mkdir,writeFile,utimes,access,rm}=await import("node:fs/promises");
 const {tmpdir}=await import("node:os");const {join}=await import("node:path");
 const {stageOrphanFiles}=await import("../src/lib/private-files/orphan-staging");
 const root=await mkdtemp(join(tmpdir(),"smo-orphans-")),dir=join(root,"diplomas");await mkdir(dir,{mode:0o700});
 const old=`${randomUUID()}.quarantine`,young=`${randomUUID()}.quarantine`;await writeFile(join(dir,old),"synthetic",{mode:0o600});await writeFile(join(dir,young),"new",{mode:0o600});await utimes(join(dir,old),new Date(0),new Date(0));
 try{
 const plan=await stageOrphanFiles(db,{directory:dir,minAgeHours:24,apply:false,confirmedQuiesced:false});assert.equal(plan.candidates,1);await access(join(dir,old));
 await assert.rejects(stageOrphanFiles(db,{directory:dir,minAgeHours:24,apply:true,confirmedQuiesced:false}));
 const applied=await stageOrphanFiles(db,{directory:dir,minAgeHours:24,apply:true,confirmedQuiesced:true});assert.equal(applied.staged,1);await assert.rejects(access(join(dir,old)));await access(join(dir,young));
 const {readdir}=await import("node:fs/promises");const batches=await readdir(join(root,"orphan-staging"));assert.equal(batches.length,1);await access(join(root,"orphan-staging",batches[0],old));
 }finally{await rm(root,{recursive:true,force:true});await db.auditEvent.deleteMany({where:{action:"ORPHAN_FILE_STAGED"}});}
});
