import "dotenv/config";
import { before,after,test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes,randomUUID } from "node:crypto";
import { readFile,readdir } from "node:fs/promises";
import { Client } from "pg";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "better-auth/crypto";
import { DemoLocalKeyProtector } from "../src/lib/external-secrets/local-keys";
import { openExternalPassword } from "../src/lib/external-secrets/envelope";
import { externalSecretContext } from "../src/lib/external-secrets/storage";
import { prepareNsuhwInTransaction } from "../src/lib/prepare-nsuhw";
import { submitLegacyNsuhw,approveLegacyNsuhw } from "../src/lib/legacy-nsuhw";
import { nsuhwExportView,downloadNsuhwExport,confirmNsuhwExport } from "../src/lib/nsuhw-export";
process.env.DEMO_REGISTRATION="true";
const schema=`delivery_${randomUUID().replaceAll("-","")}`,connection=process.env.DATABASE_URL!,sql=new Client({connectionString:connection});
const db=new PrismaClient({adapter:new PrismaPg({connectionString:connection,options:`-c search_path=${schema}`},{schema})});
const password=`Synthetic-${randomUUID()}`,keys=new DemoLocalKeyProtector({activeVersion:"v1",keys:{v1:randomBytes(32).toString("base64")}});
let hash:string,serial=8500,admin:string;
before(async()=>{await sql.connect();await sql.query(`CREATE SCHEMA "${schema}"`);await sql.query(`SET search_path TO "${schema}"`);for(const m of(await readdir("prisma/migrations")).filter(x=>/^\d/.test(x)).sort())await sql.query(await readFile(`prisma/migrations/${m}/migration.sql`,"utf8"));hash=await hashPassword(password);admin=(await db.user.create({data:{email:`${randomUUID()}@example.test`,name:"Учебный администратор",role:"TECHNICAL_ADMIN",emailVerified:true}})).id;});
after(async()=>{await db.$disconnect();await sql.query('SET search_path TO public');await sql.query(`DROP SCHEMA "${schema}" CASCADE`);await sql.end();});
async function fixture(){
 const edition=await db.olympiadEdition.create({data:{year:serial++,title:"Учебная передача"}}),foreign=await db.olympiadEdition.create({data:{year:serial++,title:"Чужая передача"}});
 const chief=await db.user.create({data:{email:`${randomUUID()}@example.test`,name:"Учебный главный",role:"CHIEF_ORGANIZER",emailVerified:true}});
 await db.account.create({data:{userId:chief.id,accountId:chief.id,providerId:"credential",password:hash}});await db.editionStaffGrant.create({data:{userId:chief.id,editionId:edition.id}});
 const uni=await db.university.create({data:{name:"Учебный вуз",abbreviation:"УВ"}}),course=await db.courseOption.create({data:{label:"Учебный курс"}});
 const participants=[];
 for(let i=0;i<5;i++){
  const user=await db.user.create({data:{email:`${randomUUID()}@example.test`,name:i===0?'Синтетический, "Иван"':`Учебный адресат ${i}`,emailVerified:true}});
  await db.account.create({data:{userId:user.id,accountId:user.id,providerId:"credential",password:hash}});
  const consent=await db.consentRecord.create({data:{userId:user.id,purpose:"synthetic-demo-only",textVersion:"demo",textHash:"a".repeat(64)}});
  const p=await db.participation.create({data:{userId:user.id,editionId:i===3?foreign.id:edition.id,format:"REMOTE",remoteZone:"NSK",status:i===2?"CANCELLED":"REGISTERED",fullName:user.name,universityId:uni.id,universityName:uni.name,universityAbbreviation:uni.abbreviation,courseId:course.id,courseLabel:course.label,consentId:consent.id}});
  if(i===4){await submitLegacyNsuhw(db,user.id,{login:`legacy.${randomUUID()}`,confirmed:true});participants.push({user,p,account:null});}
  else{await db.nsuhwLoginName.create({data:{userId:user.id,firstNameLatin:"Synthetic",lastNameLatin:["Alpha","Beta","Gamma","Delta"][i]}});const account=await db.$transaction(tx=>prepareNsuhwInTransaction(tx,user.id,keys));participants.push({user,p,account});}
 }
 const scope={editionId:edition.id};
 const view=()=>nsuhwExportView(db,chief.id,scope);
 const download=async()=>downloadNsuhwExport(db,chief.id,{...scope,selectionHash:(await view()).selectionHash,password,confirmed:true},keys);
 return {edition,foreign,chief,participants,scope,view,download};
}
test("E05 CSV has exact columns/passwords/snapshot FIO, no unrelated/cancelled/legacy accounts and no plaintext persistence",async()=>{
 const f=await fixture(),view=await f.view();assert.equal(view.count,2);assert.ok(!JSON.stringify(view).includes("secretEnvelope"));
 const exported=await f.download();assert.ok(exported.csv.startsWith('\uFEFF"Логин","пароль","ФИО"\r\n'));assert.ok(exported.csv.includes('Синтетический, ""Иван""'));
 for(const p of f.participants.slice(0,2)){const account=await db.preparedExternalAccount.findUniqueOrThrow({where:{userId:p.user.id}});const secret=await openExternalPassword(account.secretEnvelope,externalSecretContext(account),keys);assert.ok(exported.csv.includes(secret));assert.ok(!JSON.stringify(await db.nsuhwExportBatch.findUniqueOrThrow({where:{id:exported.id}})).includes(secret));assert.ok(!JSON.stringify(await db.auditEvent.findMany()).includes(secret));assert.equal(account.confirmedAt,null);}
 for(const p of f.participants.slice(2,4))assert.ok(!exported.csv.includes(p.account!.login));
 const old=f.participants[4];const claim=await db.legacyNsuhwClaim.findUniqueOrThrow({where:{userId:old.user.id}});assert.equal((await f.view()).pendingLegacyCount,1);
 await approveLegacyNsuhw(db,f.chief.id,{...f.scope,claimId:claim.id,revision:0,password,confirmed:true,ownershipChecked:true});
 assert.equal((await f.view()).existingParticipants[0].login,claim.login);assert.equal((await f.view()).pendingLegacyCount,0);
 assert.ok(!exported.csv.includes(password));assert.equal(await db.outboxEvent.count({where:{editionId:f.edition.id}}),0);
});
test("E05 stale preview, unsafe spreadsheet cell and key outage never return a partial file or batch",async()=>{
 const f=await fixture(),before=await f.view();
 await db.participation.update({where:{id:f.participants[0].p.id},data:{status:"CANCELLED",revision:{increment:1}}});
 await assert.rejects(downloadNsuhwExport(db,f.chief.id,{...f.scope,password,confirmed:true,selectionHash:before.selectionHash},keys));
 await db.participation.update({where:{id:f.participants[1].p.id},data:{fullName:"=SYNTHETIC()",revision:{increment:1}}});
 await assert.rejects(f.download());assert.equal(await db.nsuhwExportBatch.count({where:f.scope}),0);
 await db.participation.update({where:{id:f.participants[1].p.id},data:{fullName:"Учебное безопасное имя",revision:{increment:1}}});
 const broken={activeVersion:"missing",async wrapKey():Promise<never>{throw new Error("Synthetic outage");},async unwrapKey():Promise<never>{throw new Error("Synthetic outage");}};
 await assert.rejects(downloadNsuhwExport(db,f.chief.id,{...f.scope,password,confirmed:true,selectionHash:(await f.view()).selectionHash},broken));assert.equal(await db.nsuhwExportBatch.count({where:f.scope}),0);
});
test("E05 confirmation activates only exported accounts, preserves cancellation and is idempotent across concurrent repeats",async()=>{
 const f=await fixture(),exported=await f.download();
 await db.participation.update({where:{id:f.participants[0].p.id},data:{status:"CANCELLED",revision:{increment:1}}});
 const body={...f.scope,batchId:exported.id,password,confirmed:true,createdOnNsuhw:true};
 await Promise.all([confirmNsuhwExport(db,f.chief.id,body),confirmNsuhwExport(db,f.chief.id,body)]);
 for(const p of f.participants.slice(0,2))assert.ok((await db.preparedExternalAccount.findUniqueOrThrow({where:{userId:p.user.id}})).confirmedAt);
 for(const p of f.participants.slice(2,4))assert.equal((await db.preparedExternalAccount.findUniqueOrThrow({where:{userId:p.user.id}})).confirmedAt,null);
 assert.equal((await db.participation.findUniqueOrThrow({where:{id:f.participants[0].p.id}})).status,"CANCELLED");
 assert.equal(await db.outboxEvent.count({where:{editionId:f.edition.id,kind:"EXTERNAL_ACCOUNT_READY"}}),2);
 assert.equal((await f.view()).count,0);
 assert.equal((await f.view()).existingParticipants.length,1);
 await assert.rejects(db.nsuhwExportBatch.update({where:{id:exported.id},data:{items:[]}}));
});
test("E05 incorrect versions and outbox failure roll the entire creation confirmation back",async()=>{
 const f=await fixture(),exported=await f.download(),body={...f.scope,batchId:exported.id,password,confirmed:true,createdOnNsuhw:true};
 const first=f.participants[0].account!;await db.preparedExternalAccount.update({where:{id:first.id},data:{credentialVersion:2}});
 await assert.rejects(confirmNsuhwExport(db,f.chief.id,body));assert.equal((await db.nsuhwExportBatch.findUniqueOrThrow({where:{id:exported.id}})).confirmedAt,null);
 await db.preparedExternalAccount.update({where:{id:first.id},data:{credentialVersion:1}});
 const broken=db.$extends({query:{outboxEvent:{async create(){throw new Error("Synthetic outbox outage");}}}});
 await assert.rejects(confirmNsuhwExport(broken as unknown as PrismaClient,f.chief.id,body));
 assert.equal(await db.preparedExternalAccount.count({where:{userId:{in:f.participants.map(p=>p.user.id)},confirmedAt:{not:null}}}),0);
 assert.equal(await db.outboxEvent.count({where:{editionId:f.edition.id}}),0);
});
test("E05 requires chief scope/verified email/password and separate import confirmation; revocation and spoofing fail",async()=>{
 const f=await fixture(),view=await f.view(),body={...f.scope,password,confirmed:true,selectionHash:view.selectionHash};
 await assert.rejects(downloadNsuhwExport(db,admin,body,keys));await assert.rejects(downloadNsuhwExport(db,f.participants[0].user.id,body,keys));
 await assert.rejects(nsuhwExportView(db,f.chief.id,{editionId:f.foreign.id}));await assert.rejects(downloadNsuhwExport(db,f.chief.id,{...body,actorId:admin},keys));
 await assert.rejects(downloadNsuhwExport(db,f.chief.id,{...body,password:"wrong"},keys));
 await db.user.update({where:{id:f.chief.id},data:{emailVerified:false}});await assert.rejects(f.download());await db.user.update({where:{id:f.chief.id},data:{emailVerified:true}});
 const exported=await f.download();await assert.rejects(confirmNsuhwExport(db,f.chief.id,{...f.scope,batchId:exported.id,password,confirmed:true,createdOnNsuhw:false}));
 await db.editionStaffGrant.update({where:{userId_editionId:{userId:f.chief.id,editionId:f.edition.id}},data:{revokedAt:new Date()}});await assert.rejects(confirmNsuhwExport(db,f.chief.id,{...f.scope,batchId:exported.id,password,confirmed:true,createdOnNsuhw:true}));
});
test("E06 reveals only a confirmed owner's secret after fresh password proof and never mutates it",async()=>{
 const {revealNsuhwSecret}=await import("../src/lib/reveal-nsuhw");
 const f=await fixture(),owner=f.participants[0].user;
 await assert.rejects(revealNsuhwSecret(db,owner.id,{password,confirmed:true},keys));
 const exported=await f.download();await confirmNsuhwExport(db,f.chief.id,{...f.scope,batchId:exported.id,password,confirmed:true,createdOnNsuhw:true});
 const before=await db.preparedExternalAccount.findUniqueOrThrow({where:{userId:owner.id}});
 await assert.rejects(revealNsuhwSecret(db,owner.id,{password:"wrong",confirmed:true},keys));
 const first=await revealNsuhwSecret(db,owner.id,{password,confirmed:true},keys),second=await revealNsuhwSecret(db,owner.id,{password,confirmed:true},keys);
 assert.deepEqual(first,second);assert.equal(first.password,await openExternalPassword(before.secretEnvelope,externalSecretContext(before),keys));assert.notEqual(first.password,password);
 assert.deepEqual(await db.preparedExternalAccount.findUniqueOrThrow({where:{userId:owner.id}}),before);
 const audit=await db.auditEvent.findMany({where:{actorId:owner.id,action:"NSUHW_SECRET_REVEALED"}});assert.equal(audit.length,2);assert.ok(!JSON.stringify(audit).includes(first.password));
 assert.equal(await db.outboxJob.count({where:{event:{editionId:f.edition.id}}}),2);
});
test("E06 role, ownership substitution, missing confirmation, email verification and throttling are enforced",async()=>{
 const {revealNsuhwSecret}=await import("../src/lib/reveal-nsuhw");
 const f=await fixture(),owner=f.participants[0].user,exported=await f.download();await confirmNsuhwExport(db,f.chief.id,{...f.scope,batchId:exported.id,password,confirmed:true,createdOnNsuhw:true});
 await assert.rejects(revealNsuhwSecret(db,f.chief.id,{password,confirmed:true},keys));await assert.rejects(revealNsuhwSecret(db,admin,{password,confirmed:true},keys));
 await assert.rejects(revealNsuhwSecret(db,owner.id,{password,confirmed:true,userId:f.participants[1].user.id},keys));
 await assert.rejects(revealNsuhwSecret(db,owner.id,{password,confirmed:false},keys));
 await db.user.update({where:{id:owner.id},data:{emailVerified:false}});await assert.rejects(revealNsuhwSecret(db,owner.id,{password,confirmed:true},keys));await db.user.update({where:{id:owner.id},data:{emailVerified:true}});
 for(let i=0;i<5;i++)await assert.rejects(revealNsuhwSecret(db,owner.id,{password:"wrong",confirmed:true},keys));
 await assert.rejects(revealNsuhwSecret(db,owner.id,{password,confirmed:true},keys),e=>(e as Error).constructor.name==="AdminRateLimit");
 assert.equal(await db.auditEvent.count({where:{actorId:owner.id,action:"NSUHW_SECRET_REVEALED"}}),0);
});
test("E06 key/audit failure does not disclose; changing the LK password leaves the external password unchanged",async()=>{
 const {revealNsuhwSecret}=await import("../src/lib/reveal-nsuhw");
 const f=await fixture(),owner=f.participants[0].user,exported=await f.download();await confirmNsuhwExport(db,f.chief.id,{...f.scope,batchId:exported.id,password,confirmed:true,createdOnNsuhw:true});
 const before=await db.preparedExternalAccount.findUniqueOrThrow({where:{userId:owner.id}}),expected=await openExternalPassword(before.secretEnvelope,externalSecretContext(before),keys);
 const brokenKey={activeVersion:"missing",async wrapKey():Promise<never>{throw new Error("Synthetic outage");},async unwrapKey():Promise<never>{throw new Error("Synthetic outage");}};
 await assert.rejects(revealNsuhwSecret(db,owner.id,{password,confirmed:true},brokenKey));
 const brokenAudit=db.$extends({query:{auditEvent:{async create(){throw new Error("Synthetic audit outage");}}}});
 await assert.rejects(revealNsuhwSecret(brokenAudit as unknown as PrismaClient,owner.id,{password,confirmed:true},keys));
 assert.equal(await db.auditEvent.count({where:{actorId:owner.id,action:"NSUHW_SECRET_REVEALED"}}),0);
 const replacement=`Replacement-${randomUUID()}`;await db.account.updateMany({where:{userId:owner.id,providerId:"credential"},data:{password:await hashPassword(replacement)}});
 await assert.rejects(revealNsuhwSecret(db,owner.id,{password,confirmed:true},keys));
 assert.equal((await revealNsuhwSecret(db,owner.id,{password:replacement,confirmed:true},keys)).password,expected);
 assert.deepEqual(await db.preparedExternalAccount.findUniqueOrThrow({where:{userId:owner.id}}),before);
});
