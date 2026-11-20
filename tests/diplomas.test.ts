import "dotenv/config";
import { before,after,test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir,readFile,mkdtemp,rm,writeFile,utimes,access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "../src/lib/pg-adapter";
import { hashPassword } from "better-auth/crypto";
import { PDFDocument } from "pdf-lib";
import { ZipFile } from "yazl";
import { stageOrphanFiles } from "../src/lib/private-files/orphan-staging";
import { DemoQuarantine } from "../src/lib/private-files/quarantine";
import { prepareDiplomaBatch,diplomaBatchView,applyDiplomaBatch,publishDiplomaBatch,ownDiplomas,downloadDiploma } from "../src/lib/diplomas";
process.env.DEMO_REGISTRATION="true";
const schema=`diploma_${randomUUID().replaceAll("-","")}`,connection=process.env.DATABASE_URL!,sql=new Client({connectionString:connection});
const db=new PrismaClient({adapter:new PrismaPg({connectionString:connection,options:`-c search_path=${schema}`},{schema})});
const password=`Synthetic-${randomUUID()}`;let hash:string,year=9100;const roots:string[]=[];
before(async()=>{await sql.connect();await sql.query(`CREATE SCHEMA "${schema}"`);await sql.query(`SET search_path TO "${schema}"`);for(const m of(await readdir("prisma/migrations")).filter(m=>/^\d/.test(m)).sort())await sql.query(await readFile(`prisma/migrations/${m}/migration.sql`,"utf8"));hash=await hashPassword(password);});
after(async()=>{await db.$disconnect();await sql.query('SET search_path TO public');await sql.query(`DROP SCHEMA "${schema}" CASCADE`);await sql.end();for(const root of roots)await rm(root,{recursive:true,force:true});});
async function archive(files:[string,Uint8Array][]){const zip=new ZipFile();for(const [name,bytes]of files)zip.addBuffer(Buffer.from(bytes),name);zip.end();const chunks:Buffer[]=[];for await(const c of zip.outputStream)chunks.push(Buffer.from(c));return Buffer.concat(chunks);}
async function pdf(text="Synthetic diploma"){const doc=await PDFDocument.create();doc.addPage().drawText(text);return Buffer.from(await doc.save());}
async function fixture(){
 const edition=await db.olympiadEdition.create({data:{year:year++,title:"Учебные дипломы"}}),foreign=await db.olympiadEdition.create({data:{year:year++,title:"Чужой год"}});
 const chief=await db.user.create({data:{email:`${randomUUID()}@example.test`,name:"Учебный главный",role:"CHIEF_ORGANIZER",emailVerified:true}});
 await db.account.create({data:{userId:chief.id,accountId:chief.id,providerId:"credential",password:hash}});await db.editionStaffGrant.create({data:{userId:chief.id,editionId:edition.id}});
 const uni=await db.university.create({data:{name:"Учебный вуз",abbreviation:"УВ"}}),course=await db.courseOption.create({data:{label:"Учебный курс"}}),people=[];
 for(let i=0;i<3;i++){const user=await db.user.create({data:{email:`${randomUUID()}@example.test`,name:`Синтетический участник ${i}`,emailVerified:true}});const consent=await db.consentRecord.create({data:{userId:user.id,purpose:"synthetic-demo-only",textVersion:"demo",textHash:"a".repeat(64)}});const p=await db.participation.create({data:{editionId:i===2?foreign.id:edition.id,userId:user.id,format:"REMOTE",remoteZone:"NSK",fullName:user.name,universityId:uni.id,universityName:uni.name,universityAbbreviation:uni.abbreviation,courseId:course.id,courseLabel:course.label,consentId:consent.id}});const login=`legacy.${randomUUID()}`;await db.legacyNsuhwClaim.create({data:{userId:user.id,login}});people.push({user,p,login});}
 const root=await mkdtemp(join(tmpdir(),"synthetic-diplomas-"));roots.push(root);const store=new DemoQuarantine(root,50*1024*1024);
 const scope={editionId:edition.id};
 const prepare=async(files:[string,Uint8Array][])=>prepareDiplomaBatch(db,chief.id,{...scope,id:randomUUID(),password,confirmed:true,bytes:await archive(files)},store);
 const view=(batchId:string)=>diplomaBatchView(db,chief.id,{...scope,batchId});
 const selection=async(batchId:string)=>(await view(batchId)).items.filter(i=>!i.error).map(i=>({itemId:i.id,documentId:null as string|null,revision:0}));
 const apply=async(batchId:string)=>applyDiplomaBatch(db,chief.id,{...scope,batchId,password,confirmed:true,selection:await selection(batchId)});
 const publish=(batchId:string)=>publishDiplomaBatch(db,chief.id,{...scope,batchId,password,confirmed:true},store);
 const reset=()=>db.rateLimit.deleteMany({where:{key:{contains:chief.id}}});
 return {edition,foreign,chief,people,root,store,scope,prepare,view,selection,apply,publish,reset};
}
test("E10 real PDF/AV ZIP preview assigns only year owners; apply and publication are separate, private and idempotent",async()=>{
 const f=await fixture(),bytes=await pdf();
 const upload={...f.scope,id:randomUUID(),password,confirmed:true,bytes:await archive([[`${f.people[0].login}.pdf`,bytes],[`${f.people[2].login}.pdf`,bytes],["unknown.pdf",bytes],["invalid.pdf",Buffer.from("%PDF-1.7\ninvalid\n%%EOF")]])};
 const attempts=await Promise.allSettled([prepareDiplomaBatch(db,f.chief.id,upload,f.store),prepareDiplomaBatch(db,f.chief.id,upload,f.store)]);
 assert.equal(attempts.filter(r=>r.status==="fulfilled").length,1);
 const batch=await prepareDiplomaBatch(db,f.chief.id,upload,f.store);assert.equal((await readdir(f.root)).length,1);
 const view=await f.view(batch.id);assert.equal(view.items.filter(i=>!i.error).length,1);assert.equal(view.items.filter(i=>i.error).length,3);
 for(const name of ["fileKey","fileHash","archiveHash","userId"])assert.ok(!JSON.stringify(view).includes(`"${name}"`));
 assert.equal((await ownDiplomas(db,f.people[0].user.id)).length,0);
 await f.apply(batch.id);const doc=await db.diplomaDocument.findFirstOrThrow({where:f.scope});
 await assert.rejects(downloadDiploma(db,f.people[0].user.id,{documentId:doc.id},f.store));
 await f.publish(batch.id);await f.publish(batch.id);
 assert.deepEqual((await downloadDiploma(db,f.people[0].user.id,{documentId:doc.id},f.store)).bytes,bytes);
 assert.equal((await ownDiplomas(db,f.people[1].user.id)).length,0);await assert.rejects(downloadDiploma(db,f.people[1].user.id,{documentId:doc.id},f.store));
 assert.equal(await db.outboxJob.count({where:f.scope}),1);
 const audit=await db.auditEvent.findMany({where:f.scope});assert.ok(!JSON.stringify(audit).includes(f.people[0].login));
 await assert.rejects(db.diplomaItem.update({where:{id:view.items[0].id},data:{fileKey:randomUUID()}}));
 await assert.rejects(db.diplomaItem.create({data:{batchId:batch.id,editionId:f.edition.id,ordinal:888,fileName:"synthetic.pdf",participationId:f.people[0].p.id,fileKey:randomUUID(),fileHash:"a".repeat(64),pages:1,inspectedAt:new Date()}}));
 await assert.rejects(db.diplomaItem.create({data:{batchId:batch.id,editionId:f.foreign.id,ordinal:889,fileName:"synthetic.pdf",error:"TEST"}}));
});
test("E10 replacement leaves old available until publication, then closes its version; separate batches can add documents",async()=>{
 const f=await fixture(),owner=f.people[0],old=await pdf("Synthetic original"),next=await pdf("Synthetic replacement");
 const first=await f.prepare([[`${owner.login}.pdf`,old]]);await f.apply(first.id);await f.publish(first.id);await f.reset();
 const doc=await db.diplomaDocument.findFirstOrThrow({where:f.scope});
 const second=await f.prepare([[`${owner.login}.pdf`,next]]),selection=await f.selection(second.id);selection[0].documentId=doc.id;selection[0].revision=1;
 await applyDiplomaBatch(db,f.chief.id,{...f.scope,batchId:second.id,password,confirmed:true,selection});
 assert.deepEqual((await downloadDiploma(db,owner.user.id,{documentId:doc.id},f.store)).bytes,old);
 await f.publish(second.id);await f.publish(first.id);assert.deepEqual((await downloadDiploma(db,owner.user.id,{documentId:doc.id},f.store)).bytes,next);
 assert.equal((await ownDiplomas(db,owner.user.id)).length,1);assert.equal(await db.diplomaVersion.count({where:{documentId:doc.id}}),2);
 await assert.rejects(downloadDiploma(db,owner.user.id,{documentId:doc.id,versionId:doc.currentVersionId},f.store));
 await f.reset();const third=await f.prepare([[`${owner.login}.pdf`,old]]);await f.apply(third.id);await f.publish(third.id);assert.equal((await ownDiplomas(db,owner.user.id)).length,2);
 // Cleanup must retain superseded and current published PDFs, regardless of age.
 const files=await readdir(f.root);for(const name of files)await utimes(join(f.root,name),new Date(0),new Date(0));
 const cleanup=await stageOrphanFiles(db,{directory:f.root,minAgeHours:24,apply:true,confirmedQuiesced:true});
 assert.equal(cleanup.candidates,0);assert.equal(cleanup.staged,0);
 for(const name of files)await access(join(f.root,name));

});
test("E10 rejects wrong year, role, missing verified email/password/confirmation and cross-owner replacement",async()=>{
 const f=await fixture(),bytes=await pdf(),batch=await f.prepare([[`${f.people[0].login}.pdf`,bytes]]),command={...f.scope,batchId:batch.id,password,confirmed:true};
 const deniedUsers:string[]=[];
 for(const role of ["STUDENT","VENUE_ORGANIZER","TECHNICAL_ADMIN"] as const){const user=await db.user.create({data:{email:`${randomUUID()}@example.test`,name:"Учебная роль",role,emailVerified:true}});deniedUsers.push(user.id);await assert.rejects(diplomaBatchView(db,user.id,{...f.scope,batchId:batch.id}));await assert.rejects(publishDiplomaBatch(db,user.id,command,f.store));}
 await assert.rejects(publishDiplomaBatch(db,f.chief.id,{...command,editionId:f.foreign.id},f.store));
 await assert.rejects(applyDiplomaBatch(db,f.chief.id,{...command,password:"wrong",selection:await f.selection(batch.id)}));
 await assert.rejects(applyDiplomaBatch(db,f.chief.id,{...command,confirmed:false,selection:await f.selection(batch.id)}));
 await db.user.update({where:{id:f.chief.id},data:{emailVerified:false}});await assert.rejects(f.apply(batch.id));await db.user.update({where:{id:f.chief.id},data:{emailVerified:true}});
 await f.apply(batch.id);await f.publish(batch.id);await f.reset();const foreignDoc=await db.diplomaDocument.findFirstOrThrow({where:f.scope});
 for(const id of deniedUsers)await assert.rejects(downloadDiploma(db,id,{documentId:foreignDoc.id},f.store));
 const second=await f.prepare([[`${f.people[1].login}.pdf`,bytes]]);const selection=await f.selection(second.id);selection[0].documentId=foreignDoc.id;selection[0].revision=1;
 await assert.rejects(applyDiplomaBatch(db,f.chief.id,{...f.scope,batchId:second.id,password,confirmed:true,selection}));
 await db.editionStaffGrant.update({where:{userId_editionId:{userId:f.chief.id,editionId:f.edition.id}},data:{revokedAt:new Date()}});await assert.rejects(f.view(batch.id));
});
test("E10 preparation compensates file writes on audit failure; publication/outbox and download audit fail closed",async()=>{
 const f=await fixture(),bytes=await pdf();
 const broken=db.$extends({query:{auditEvent:{async create(){throw new Error("Synthetic audit outage");}}}});
 await assert.rejects(prepareDiplomaBatch(broken as unknown as PrismaClient,f.chief.id,{...f.scope,id:randomUUID(),password,confirmed:true,bytes:await archive([[`${f.people[0].login}.pdf`,bytes]])},f.store));
 assert.deepEqual(await readdir(f.root),[]);assert.equal(await db.diplomaBatch.count({where:f.scope}),0);
 const batch=await f.prepare([[`${f.people[0].login}.pdf`,bytes]]);await f.apply(batch.id);
 const brokenOutbox=db.$extends({query:{outboxEvent:{async create(){throw new Error("Synthetic outbox outage");}}}});
 await assert.rejects(publishDiplomaBatch(brokenOutbox as unknown as PrismaClient,f.chief.id,{...f.scope,batchId:batch.id,password,confirmed:true},f.store));
 assert.equal((await db.diplomaBatch.findUniqueOrThrow({where:{id:batch.id}})).publishedAt,null);assert.equal((await ownDiplomas(db,f.people[0].user.id)).length,0);
 await f.reset();await f.publish(batch.id);const doc=await db.diplomaDocument.findFirstOrThrow({where:f.scope});
 await assert.rejects(downloadDiploma(broken as unknown as PrismaClient,f.people[0].user.id,{documentId:doc.id},f.store));
 const item=await db.diplomaItem.findFirstOrThrow({where:{batchId:batch.id,error:null}});await writeFile(join(f.root,`${item.fileKey}.quarantine`),"modified synthetic file");
 await assert.rejects(downloadDiploma(db,f.people[0].user.id,{documentId:doc.id},f.store));
});
