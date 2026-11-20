import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "../src/lib/pg-adapter";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { readdir,readFile } from "node:fs/promises";
import { before,after,test } from "node:test";
import assert from "node:assert/strict";
import { AccessDenied } from "../src/lib/access";
import { hashPassword } from "better-auth/crypto";
import { submitLegacyNsuhw,legacyNsuhwView,assertNoLegacyNsuhwClaim,submitLegacyNsuhwInTransaction } from "../src/lib/legacy-nsuhw";
process.env.DEMO_REGISTRATION="true";
const schema=`legacy_${randomUUID().replaceAll("-","")}`,connection=process.env.DATABASE_URL!;
const sql=new Client({connectionString:connection});
const db=new PrismaClient({adapter:new PrismaPg({connectionString:connection,options:`-c search_path=${schema}`},{schema})});
const password=`Synthetic-${randomUUID()}`;
let chief:string,student:string,second:string,edition:string,foreign:string;
before(async()=>{
 await sql.connect();await sql.query(`CREATE SCHEMA "${schema}"`);await sql.query(`SET search_path TO "${schema}"`);
 for(const m of (await readdir("prisma/migrations")).filter(x=>/^\d/.test(x)).sort())await sql.query(await readFile(`prisma/migrations/${m}/migration.sql`,"utf8"));
 const create=async(role:"STUDENT"|"CHIEF_ORGANIZER")=>db.user.create({data:{name:"Учебный аккаунт",email:`${randomUUID()}@example.test`,role,emailVerified:true}});
 chief=(await create("CHIEF_ORGANIZER")).id;student=(await create("STUDENT")).id;second=(await create("STUDENT")).id;
 edition=(await db.olympiadEdition.create({data:{year:8200,title:"Учебная сверка"}})).id;
 foreign=(await db.olympiadEdition.create({data:{year:8201,title:"Другой год"}})).id;
 await db.editionStaffGrant.create({data:{userId:chief,editionId:edition}});
 await db.account.create({data:{userId:chief,accountId:chief,providerId:"credential",password:await hashPassword(password)}});
 const uni=await db.university.create({data:{name:"Учебный вуз",abbreviation:"УВ"}}),course=await db.courseOption.create({data:{label:"Учебный курс"}});
 for(const userId of [student,second]){
  const consent=await db.consentRecord.create({data:{userId,purpose:"synthetic-demo-only",textVersion:"demo",textHash:"a".repeat(64)}});
  await db.participation.create({data:{userId,editionId:edition,format:"REMOTE",remoteZone:"NSK",fullName:"Учебный участник",universityId:uni.id,universityName:uni.name,universityAbbreviation:uni.abbreviation,courseId:course.id,courseLabel:course.label,consentId:consent.id}});
 }
});
after(async()=>{await db.$disconnect();await sql.query('SET search_path TO public');await sql.query(`DROP SCHEMA "${schema}" CASCADE`);await sql.end();});
test("student saves old login immediately without organizer approval; retries and own-only access are enforced", async () => {
 await assertNoLegacyNsuhwClaim(db,student);
 const input={login:"legacy.synthetic"};
 const [a,b]=await Promise.all([submitLegacyNsuhw(db,student,input),submitLegacyNsuhw(db,student,input)]);
 assert.equal(a.id,b.id);assert.equal(a.login,input.login);assert.ok(!("approvedAt" in a));
 await assert.rejects(assertNoLegacyNsuhwClaim(db,student));
 assert.equal(await legacyNsuhwView(db,second),null);
 await assert.rejects(submitLegacyNsuhw(db,student,{...input,userId:second}));
 await assert.rejects(submitLegacyNsuhw(db,student,{...input,login:"different"}));
 await assert.rejects(submitLegacyNsuhw(db,chief,input));
 await assert.rejects(submitLegacyNsuhw(db,second,{login:""}));
 assert.equal(await db.auditEvent.count({where:{action:"NSUHW_LEGACY_LOGIN_SAVED",objectId:a.id}}),1);
});
test("self-reported login survives annual participation without moderation or external password", async () => {
 const claim=await legacyNsuhwView(db,student);assert.ok(claim);
 const p=await db.participation.findUniqueOrThrow({where:{userId_editionId:{userId:student,editionId:edition}}});
 const {id: _id,createdAt: _time,...data}=p;void _id;void _time;
 await db.participation.create({data:{...data,editionId:foreign}});
 assert.equal((await legacyNsuhwView(db,student))?.id,claim.id);
 assert.equal(await db.auditEvent.count({where:{action:"NSUHW_LEGACY_LINK_CONFIRMED",objectId:claim.id}}),0);
});
test("duplicate self-reported logins do not silently replace another student's record", async () => {
 const claim=await submitLegacyNsuhw(db,second,{login:"legacy.synthetic"});
 assert.notEqual(claim.id,(await legacyNsuhwView(db,student))!.id);
 assert.equal((await legacyNsuhwView(db,second))?.login,"legacy.synthetic");
 assert.equal(await db.legacyNsuhwClaim.count({where:{login:"legacy.synthetic"}}),2);
 assert.ok(!JSON.stringify(await db.auditEvent.findMany()).includes("legacy.synthetic"));
 await db.user.update({where:{id:second},data:{emailVerified:false}});
 await assert.rejects(submitLegacyNsuhw(db,second,{login:"other"}),AccessDenied);
 await db.user.update({where:{id:second},data:{emailVerified:true}});
 process.env.DEMO_REGISTRATION="false";
 try { await assert.rejects(submitLegacyNsuhw(db,second,{login:"legacy.synthetic"})); }
 finally { process.env.DEMO_REGISTRATION="true"; }
});
test("signup declaration rolls back with account transaction and does not require an email proof prematurely",async()=>{
 const user=await db.user.create({data:{email:`${randomUUID()}@example.test`,name:"Учебная регистрация"}});
 await assert.rejects(db.$transaction(async tx=>{await submitLegacyNsuhwInTransaction(tx,user.id,"legacy.rollback");throw new Error("Synthetic signup rollback");}));
 assert.equal(await db.legacyNsuhwClaim.count({where:{userId:user.id}}),0);
 await db.$transaction(tx=>submitLegacyNsuhwInTransaction(tx,user.id,"legacy.unverified"));
 await assert.rejects(legacyNsuhwView(db,user.id));
 await assert.rejects(assertNoLegacyNsuhwClaim(db,user.id));
});
test("Latin login names are separate from identity and participation snapshots; races and legacy replacement are blocked",async()=>{
 const {saveNsuhwLoginNames,nsuhwLoginNamesView}=await import("../src/lib/nsuhw-login-names");
 const {nsuhwLoginPreview,nsuhwLoginNamesSchema}=await import("../src/lib/nsuhw-login-name-rules");
 for(const lastNameLatin of ["Петров","Pеtrov","Pet rov","O'Neil","Petrov-Other","😀"])assert.equal(nsuhwLoginNamesSchema.safeParse({firstNameLatin:"Ivan",lastNameLatin}).success,false);
 assert.equal(nsuhwLoginPreview({firstNameLatin:" Ivan ",lastNameLatin:"Petrov"}),"smc.i.petrov");
 const user=await db.user.create({data:{name:"Синтетический Иван Петров",email:`${randomUUID()}@example.test`,emailVerified:true}});
 const original=await db.participation.findUniqueOrThrow({where:{userId_editionId:{userId:student,editionId:edition}}});
 await db.studentProfile.create({data:{userId:user.id,fullName:user.name,universityId:original.universityId,courseId:original.courseId}});
 const consent=await db.consentRecord.create({data:{userId:user.id,purpose:"synthetic-demo-only",textVersion:"demo",textHash:"a".repeat(64)}});
 const {id:_id,createdAt:_time,...data}=original;void _id;void _time;
 const snapshot=await db.participation.create({data:{...data,userId:user.id,consentId:consent.id}});
 const profile=await db.studentProfile.findUniqueOrThrow({where:{userId:user.id}});
 const input={firstNameLatin:"Ivan",lastNameLatin:"Petrov",revision:0};
 const results=await Promise.allSettled([saveNsuhwLoginNames(db,user.id,input),saveNsuhwLoginNames(db,user.id,input)]);
 assert.equal(results.filter(x=>x.status==="fulfilled").length,1);
 assert.equal((await nsuhwLoginNamesView(db,user.id))?.preview,"smc.i.petrov");
 assert.deepEqual(await db.studentProfile.findUniqueOrThrow({where:{userId:user.id}}),profile);
 assert.deepEqual(await db.participation.findUniqueOrThrow({where:{id:snapshot.id}}),snapshot);
 assert.equal((await db.user.findUniqueOrThrow({where:{id:user.id}})).name,user.name);
 await assert.rejects(saveNsuhwLoginNames(db,user.id,{...input,userId:second}));
 await assert.rejects(saveNsuhwLoginNames(db,chief,input));
 await submitLegacyNsuhw(db,user.id,{login:"legacy.not.renamed"});
 await assert.rejects(saveNsuhwLoginNames(db,user.id,{firstNameLatin:"Other",lastNameLatin:"Person",revision:1}));
 assert.equal((await legacyNsuhwView(db,user.id))?.login,"legacy.not.renamed");
 assert.ok(!JSON.stringify(await db.auditEvent.findMany({where:{action:"NSUHW_LOGIN_NAMES_UPDATED"}})).includes("Petrov"));
});
