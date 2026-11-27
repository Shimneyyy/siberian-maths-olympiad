import "dotenv/config";
import { before,after,test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID,createHash } from "node:crypto";
import { readdir,readFile } from "node:fs/promises";
import { Client } from "pg";
import { PrismaClient, type User, type Participation } from "@prisma/client";
import { PrismaPg } from "../src/lib/pg-adapter";
import { hashPassword } from "better-auth/crypto";
import { previewResultImport,applyResultImport } from "../src/lib/result-imports";
import { publishResults,resultsView } from "../src/lib/results";
import { resultDocuments,amendResult,releaseResult } from "../src/lib/result-documents";
import { previewTeamResults,applyTeamResults,teamResultRoster } from "../src/lib/team-results";
import { correctLegacyNsuhw } from "../src/lib/legacy-nsuhw";
import { personalHistory } from "../src/lib/personal-history";
import { createTeam } from "../src/lib/teams";
process.env.DEMO_REGISTRATION="true";
const schema=`versions_${randomUUID().replaceAll("-","")}`,connection=process.env.DATABASE_URL!,sql=new Client({connectionString:connection});
const db=new PrismaClient({adapter:new PrismaPg({connectionString:connection,options:`-c search_path=${schema}`},{schema})});
const password=`Synthetic-${randomUUID()}`;let hash:string,year=9600;
before(async()=>{await sql.connect();await sql.query(`CREATE SCHEMA "${schema}"`);await sql.query(`SET search_path TO "${schema}"`);for(const m of(await readdir("prisma/migrations")).filter(m=>/^\d/.test(m)).sort())await sql.query(await readFile(`prisma/migrations/${m}/migration.sql`,"utf8"));hash=await hashPassword(password);});
after(async()=>{await db.$disconnect();await sql.query('SET search_path TO public');await sql.query(`DROP SCHEMA "${schema}" CASCADE`);await sql.end();});
async function fixture(){
 const edition=await db.olympiadEdition.create({data:{year:year++,title:"Учебные версии",registrationOpensAt:new Date(0),registrationClosesAt:new Date(Date.now()+86400000)}});
 const chief=await db.user.create({data:{email:`${randomUUID()}@example.test`,name:"Учебный главный",emailVerified:true,role:"CHIEF_ORGANIZER"}});
 await db.account.create({data:{userId:chief.id,providerId:"credential",accountId:chief.id,password:hash}});await db.editionStaffGrant.create({data:{userId:chief.id,editionId:edition.id}});
 const uni=await db.university.create({data:{name:"Учебный вуз",abbreviation:"УВ"}}),course=await db.courseOption.create({data:{label:"Учебный курс"}});const people:{user:User;p:Participation;login:string}[]=[];
 for(let i=0;i<3;i++){const user=await db.user.create({data:{email:`${randomUUID()}@example.test`,name:`Учебный участник ${i}`,emailVerified:true}});const consent=await db.consentRecord.create({data:{userId:user.id,purpose:"synthetic-demo-only",textVersion:"demo",textHash:"a".repeat(64)}});const p=await db.participation.create({data:{editionId:edition.id,userId:user.id,format:"REMOTE",remoteZone:"NSK",fullName:user.name,universityId:uni.id,universityName:uni.name,universityAbbreviation:uni.abbreviation,courseId:course.id,courseLabel:String(i+1),consentId:consent.id}});const login=`Legacy.${randomUUID()}`;await db.legacyNsuhwClaim.create({data:{userId:user.id,login}});people.push({user,p,login});}
 const scope={editionId:edition.id},proof={password,confirmed:true};const reset=()=>db.rateLimit.deleteMany({where:{key:`correction-reauth:${chief.id}`}});
 const original=async()=>{const source={...scope,kind:"PRELIMINARY",csv:`Логин,Задача 1,Задача 2,Сумма\n${people[0].login},0,,7`};const preview=await previewResultImport(db,chief.id,source);const batch=await applyResultImport(db,chief.id,{...source,...proof,id:randomUUID(),selectionHash:preview.selectionHash});await publishResults(db,chief.id,{...scope,...proof,batchId:batch.id});return batch;};
 return {edition,chief,uni,people,scope,proof,reset,original};
}
test("versions publish separately, retain immutable originals, revoke with audit/outbox, retry without reviving old batches",async()=>{
 const f=await fixture(),batch=await f.original();let doc=(await resultDocuments(db,f.chief.id,f.scope)).documents[0];const originalId=doc.currentVersionId!;
 const change={...f.scope,...f.proof,documentId:doc.id,revision:doc.revision,id:randomUUID(),scores:[3,null],total:9,prize:"Учебный приз",reason:"Исправление учебной оценки"};
 const version=await amendResult(db,f.chief.id,change);await amendResult(db,f.chief.id,change);
 assert.equal((await resultsView(db,f.people[0].user.id,f.scope)).rows[0].total,7);
 assert.equal((await db.individualResult.findUniqueOrThrow({where:{id:doc.sourceResultId!}})).total,7);
 doc=(await resultDocuments(db,f.chief.id,f.scope)).documents[0];await f.reset();
 const publish={...f.scope,...f.proof,id:randomUUID(),documentId:doc.id,revision:doc.revision,versionId:version.id,action:"PUBLISH"};
 await releaseResult(db,f.chief.id,publish);await releaseResult(db,f.chief.id,publish);
 assert.equal((await resultsView(db,f.people[0].user.id,f.scope)).rows[0].total,9);
 assert.equal((await personalHistory(db,f.people[0].user.id)).rows[0].total,9);
 assert.equal((await resultsView(db,f.people[1].user.id,f.scope)).total,0);
 await assert.rejects(releaseResult(db,f.chief.id,{...publish,id:randomUUID(),versionId:originalId}));
 await f.reset();doc=(await resultDocuments(db,f.chief.id,f.scope)).documents[0];const revoke={...publish,id:randomUUID(),revision:doc.revision,action:"REVOKE",reason:"Учебный отзыв результата"};
 await releaseResult(db,f.chief.id,revoke);await releaseResult(db,f.chief.id,revoke);
 assert.equal((await resultsView(db,f.people[0].user.id,f.scope)).total,0);assert.equal((await personalHistory(db,f.people[0].user.id)).total,0);
 await publishResults(db,f.chief.id,{...f.scope,...f.proof,batchId:batch.id});assert.equal((await resultsView(db,f.people[0].user.id,f.scope)).total,0);
 assert.equal(await db.resultVersion.count({where:{documentId:doc.id}}),2);assert.equal(await db.resultRelease.count({where:{documentId:doc.id}}),3);
 await assert.rejects(db.resultVersion.update({where:{id:version.id},data:{total:99}}));await assert.rejects(db.resultRelease.delete({where:{id:revoke.id}}));
 await assert.rejects(db.resultDocument.update({where:{id:doc.id},data:{withdrawn:false,revision:{increment:1}}}));
 const audit=await db.auditEvent.findMany({where:{editionId:f.edition.id}});assert.ok(!JSON.stringify(audit).includes(change.reason));
});
test("owner login correction preserves personal history, rejects stale/spoofing and never changes prepared credentials",async()=>{
 const f=await fixture();await f.original();const owner=f.people[0];const claim=await db.legacyNsuhwClaim.findUniqueOrThrow({where:{userId:owner.user.id}});
 const next=`Corrected.${randomUUID()}`;await correctLegacyNsuhw(db,owner.user.id,{login:next,revision:claim.revision});
 assert.equal((await personalHistory(db,owner.user.id)).rows[0].total,7);
 await assert.rejects(correctLegacyNsuhw(db,owner.user.id,{login:"stale",revision:claim.revision}));
 await assert.rejects(correctLegacyNsuhw(db,f.chief.id,{login:next,revision:0}));
 await assert.rejects(correctLegacyNsuhw(db,owner.user.id,{login:next,revision:1,userId:f.people[1].user.id}));
 assert.equal((await db.legacyNsuhwClaim.findUniqueOrThrow({where:{userId:f.people[1].user.id}})).login,f.people[1].login);
 assert.equal(await db.preparedExternalAccount.count({where:{userId:owner.user.id}}),0);
 const preparedOwner=await db.user.create({data:{email:`${randomUUID()}@example.test`,name:"Учебный подготовленный",emailVerified:true}});
 await db.nsuhwLoginName.create({data:{userId:preparedOwner.id,firstNameLatin:"Ivan",lastNameLatin:"Synthetic"}});
 const {prepareNsuhwInTransaction}=await import("../src/lib/prepare-nsuhw");
 await db.$transaction(tx=>prepareNsuhwInTransaction(tx,preparedOwner.id));
 const before=await db.preparedExternalAccount.findUniqueOrThrow({where:{userId:preparedOwner.id}});
 await assert.rejects(correctLegacyNsuhw(db,preparedOwner.id,{login:next,revision:0}));
 assert.equal(createHash("sha256").update(JSON.stringify(await db.preparedExternalAccount.findUniqueOrThrow({where:{userId:preparedOwner.id}}))).digest("hex"),createHash("sha256").update(JSON.stringify(before)).digest("hex"));

});
test("team CSV snapshots members and courses, rejects stale rosters/duplicates, publishes separately and survives team deletion",async()=>{
 const f=await fixture();const team=await createTeam(db,f.people[0].user.id,{...f.scope,coachName:"Учебный тренер"});
 await db.teamMember.create({data:{teamId:team.id,participationId:f.people[1].p.id,editionId:f.edition.id,universityId:f.uni.id}});
 const teamName=(await db.team.findUniqueOrThrow({where:{id:team.id}})).name;
 const legacy={...f.scope,kind:"FINAL",csv:`ID команды,Курсы участников,Задача 1,Задача 2,Сумма баллов,Приз
${team.id},"1; 2",4,,12,Учебный командный приз`};
 const duplicate=await previewTeamResults(db,f.chief.id,{...legacy,csv:legacy.csv+`
${team.id.toUpperCase()},"1; 2",4,,12,Дубль`});assert.equal(duplicate.validCount,0);
 assert.equal((await previewTeamResults(db,f.chief.id,legacy)).validCount,1);
 const source={...f.scope,kind:"FINAL",csv:`Название команды,Курс,Логины,ФИО,Задача 1,Задача 2,Сумма,Приз
"${teamName}","2; 1","${f.people[1].login}; ${f.people[0].login}","Участник 2; Участник 1",4,,12,Золото`};
 let preview=await previewTeamResults(db,f.chief.id,source);assert.equal(preview.validCount,1);assert.deepEqual(preview.rows[0].members.map(m=>m.courseLabel).sort(),["1","2"]);
 assert.equal((await teamResultRoster(db,f.chief.id,f.scope)).total,1);
 const wrong=await previewTeamResults(db,f.chief.id,{...source,csv:source.csv.replace(f.people[0].login,f.people[2].login)});
 assert.equal(wrong.rows[0].error,"TEAM_UNAVAILABLE");
 assert.equal((await previewTeamResults(db,f.chief.id,{...source,csv:source.csv+"\n"+source.csv.split("\n")[1]})).validCount,0);
 const stale=preview.selectionHash;await db.participation.update({where:{id:f.people[0].p.id},data:{courseLabel:"Изменённый курс",revision:{increment:1}}});
 await assert.rejects(applyTeamResults(db,f.chief.id,{...source,...f.proof,id:randomUUID(),selectionHash:stale}));preview=await previewTeamResults(db,f.chief.id,source);
 const command={...source,...f.proof,id:randomUUID(),selectionHash:preview.selectionHash};await applyTeamResults(db,f.chief.id,command);await applyTeamResults(db,f.chief.id,command);
 assert.equal((await resultsView(db,f.people[0].user.id,f.scope)).total,0);
 const doc=(await resultDocuments(db,f.chief.id,f.scope)).documents[0];await f.reset();const pub={...f.scope,...f.proof,id:randomUUID(),documentId:doc.id,revision:doc.revision,versionId:doc.versions[0].id,action:"PUBLISH"};await releaseResult(db,f.chief.id,pub);await releaseResult(db,f.chief.id,pub);
 assert.equal((await resultsView(db,f.people[0].user.id,f.scope)).rows[0].total,12);assert.equal((await resultsView(db,f.people[1].user.id,f.scope)).rows[0].total,12);assert.equal((await resultsView(db,f.people[2].user.id,f.scope)).total,0);
 await db.team.delete({where:{id:team.id}});await db.participation.update({where:{id:f.people[1].p.id},data:{courseLabel:"Новый курс",revision:{increment:1}}});
 const history=await personalHistory(db,f.people[1].user.id);assert.equal(history.rows[0].members.find(m=>m.fullName===f.people[1].user.name)?.courseLabel,"2");
 await assert.rejects(previewTeamResults(db,f.people[0].user.id,source));await assert.rejects(resultDocuments(db,f.people[0].user.id,f.scope));
 await assert.rejects(amendResult(db,f.people[1].user.id,{...pub,id:randomUUID(),scores:[1,2],total:3,prize:null,reason:"Чужое исправление"}));
 await db.editionStaffGrant.update({where:{userId_editionId:{userId:f.chief.id,editionId:f.edition.id}},data:{revokedAt:new Date()}});await assert.rejects(resultDocuments(db,f.chief.id,f.scope));
});
test("concurrent corrections serialize revisions; audit/outbox failures roll release and pointer back",async()=>{
 const f=await fixture();await f.original();const doc=(await resultDocuments(db,f.chief.id,f.scope)).documents[0];
 const change={...f.scope,...f.proof,documentId:doc.id,revision:doc.revision,scores:[1,null],total:2,prize:null,reason:"Учебная конкурентная правка"};
 const race=await Promise.allSettled([amendResult(db,f.chief.id,{...change,id:randomUUID()}),amendResult(db,f.chief.id,{...change,id:randomUUID(),total:3})]);assert.equal(race.filter(r=>r.status==="fulfilled").length,1);
 const current=(await resultDocuments(db,f.chief.id,f.scope)).documents[0];
 const command={...f.scope,...f.proof,id:randomUUID(),documentId:doc.id,revision:current.revision,versionId:current.versions[0].id,action:"PUBLISH"};
 for(const broken of [db.$extends({query:{outboxEvent:{async create(){throw new Error("Synthetic failure");}}}}),db.$extends({query:{auditEvent:{async create(){throw new Error("Synthetic failure");}}}})]){
  await f.reset();await assert.rejects(releaseResult(broken as unknown as PrismaClient,f.chief.id,command));
  assert.equal((await db.resultDocument.findUniqueOrThrow({where:{id:doc.id}})).currentVersionId,doc.currentVersionId);assert.equal(await db.resultRelease.count({where:{id:command.id}}),0);assert.equal((await resultsView(db,f.people[0].user.id,f.scope)).rows[0].total,7);
 }
});
