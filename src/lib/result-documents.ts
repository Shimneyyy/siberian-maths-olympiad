import { z } from "zod";
import type { Prisma, PrismaClient } from "@prisma/client";
import { authorizeStaff, AccessDenied } from "./access";
import { reauthenticateParticipationChief } from "./corrections";
import { assertDemoRegistration } from "./registration-rules";
import { OlympiadError } from "./olympiad-rules";
import { enqueueEmail } from "./outbox";
import { registrationsScope } from "./registrations";
const scope=z.object({editionId:z.uuid()}).strict();
const score=z.int().min(0).max(2147483647).nullable();
const proof={password:z.string().min(1).max(128),confirmed:z.literal(true)};
const documentInput=scope.extend({documentId:z.uuid(),revision:z.int().nonnegative()});
export async function resultChief(tx:PrismaClient|Prisma.TransactionClient,actorId:string,editionId:string){
 await authorizeStaff(tx,actorId,"results:publish",editionId);
 assertDemoRegistration((await tx.user.findUniqueOrThrow({where:{id:actorId}})).email);
}
// Runs in the original import transaction; original imported rows remain immutable.
export async function createIndividualDocuments(tx:Prisma.TransactionClient,editionId:string,batchId:string){
 await tx.$executeRaw`INSERT INTO "ResultDocument" ("id","editionId","sourceResultId","kind") SELECT r."id",r."editionId",r."id",r."kind" FROM "IndividualResult" r WHERE r."editionId"=${editionId}::uuid AND r."batchId"=${batchId}::uuid ON CONFLICT ("sourceResultId") DO NOTHING`;
 await tx.$executeRaw`INSERT INTO "ResultVersion" ("id","documentId","editionId","actorId","number","scores","total","prize") SELECT gen_random_uuid(),r."id",r."editionId",b."actorId",1,(SELECT jsonb_agg(s."score" ORDER BY p."ordinal") FROM "ResultProblemScore" s JOIN "EditionProblem" p ON p."id"=s."problemId" WHERE s."resultId"=r."id"),r."total",r."prize" FROM "IndividualResult" r JOIN "ResultImportBatch" b ON b."id"=r."batchId" WHERE r."editionId"=${editionId}::uuid AND r."batchId"=${batchId}::uuid AND NOT EXISTS(SELECT 1 FROM "ResultVersion" v WHERE v."documentId"=r."id")`;
 await tx.$executeRaw`INSERT INTO "ResultRecipient" ("documentId","editionId","participationId","fullName","courseLabel","universityName") SELECT r."id",r."editionId",p."id",p."fullName",p."courseLabel",p."universityName" FROM "IndividualResult" r JOIN "Participation" p ON p."id"=r."participationId" WHERE r."editionId"=${editionId}::uuid AND r."batchId"=${batchId}::uuid ON CONFLICT DO NOTHING`;
}
export async function releaseOriginalBatch(tx:Prisma.TransactionClient,actorId:string,editionId:string,batchId:string){
 const conflict=await tx.resultDocument.findFirst({where:{editionId,sourceResult:{batchId},OR:[{currentVersionId:{not:null}},{revision:{not:0}}]},select:{id:true}});
 if(conflict)throw new OlympiadError("CONFLICT","Результат уже изменён. Публикуйте выбранную версию отдельно.");
 await tx.$executeRaw`INSERT INTO "ResultRelease" ("id","documentId","editionId","versionId","actorId","revision","action") SELECT gen_random_uuid(),d."id",d."editionId",v."id",${actorId}::uuid,1,'PUBLISH' FROM "ResultDocument" d JOIN "IndividualResult" r ON r."id"=d."sourceResultId" JOIN "ResultVersion" v ON v."documentId"=d."id" AND v."number"=1 WHERE d."editionId"=${editionId}::uuid AND r."batchId"=${batchId}::uuid`;
 await tx.$executeRaw`UPDATE "ResultDocument" d SET "currentVersionId"=v."id","revision"=1 FROM "ResultVersion" v,"IndividualResult" r WHERE v."documentId"=d."id" AND v."number"=1 AND r."id"=d."sourceResultId" AND d."editionId"=${editionId}::uuid AND r."batchId"=${batchId}::uuid`;
}
export async function resultDocuments(db:PrismaClient,actorId:string,raw:unknown){
 const input=scope.extend({page:z.int().min(1).max(10000).default(1)}).strict().parse(raw);
 return db.$transaction(async tx=>{
  await resultChief(tx,actorId,input.editionId);
  const where={editionId:input.editionId};
  const total=await tx.resultDocument.count({where});
  const documents=await tx.resultDocument.findMany({where,orderBy:{id:"asc"},skip:(input.page-1)*25,take:25,include:{recipients:{orderBy:{participationId:"asc"}},versions:{orderBy:{number:"desc"},take:50},releases:{orderBy:{revision:"desc"},take:50}}});
  return {total,page:input.page,documents};
 },{isolationLevel:"RepeatableRead"});
}
export async function amendResult(db:PrismaClient,actorId:string,raw:unknown){
 const input=documentInput.extend({...proof,id:z.uuid(),scores:z.array(score).min(1).max(50),total:score,prize:z.string().max(200).nullable(),reason:z.string().trim().min(3).max(2000)}).strict().parse(raw);
 await resultChief(db,actorId,input.editionId);await reauthenticateParticipationChief(db,actorId,input.password);
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT "id" FROM "OlympiadEdition" WHERE "id"=${input.editionId}::uuid FOR UPDATE`;
  await resultChief(tx,actorId,input.editionId);
  const doc=await tx.resultDocument.findFirst({where:{id:input.documentId,editionId:input.editionId},include:{versions:{orderBy:{number:"desc"},take:1}}});
  if(!doc)throw new AccessDenied("FORBIDDEN");
  if(doc.sourceResultId&&!await tx.resultPublication.findUnique({where:{batchId:(await tx.individualResult.findUniqueOrThrow({where:{id:doc.sourceResultId}})).batchId}}))throw new OlympiadError("CONFLICT","Сначала опубликуйте исходный пакет");
  const old=await tx.resultVersion.findUnique({where:{id:input.id}});
  if(old){if(old.actorId!==actorId||old.documentId!==doc.id||JSON.stringify(old.scores)!==JSON.stringify(input.scores)||old.total!==input.total||old.prize!==input.prize||old.reason!==input.reason)throw new OlympiadError("CONFLICT","Идентификатор версии уже использован");return {id:old.id};}
  if(doc.revision!==input.revision||doc.versions[0].scores instanceof Array&&doc.versions[0].scores.length!==input.scores.length)throw new OlympiadError("CONFLICT","Результат изменён. Обновите данные.");
  const version=await tx.resultVersion.create({data:{id:input.id,documentId:doc.id,editionId:doc.editionId,actorId,number:doc.versions[0].number+1,scores:input.scores,total:input.total,prize:input.prize,reason:input.reason}});
  await tx.resultDocument.update({where:{id:doc.id},data:{revision:{increment:1}}});
  await tx.auditEvent.create({data:{actorId,editionId:doc.editionId,action:"RESULT_VERSION_CREATED",objectType:"ResultDocument",objectId:doc.id,outcome:"SUCCESS",details:{versionId:version.id,number:version.number}}});
  return {id:version.id};
 });
}
export async function releaseResult(db:PrismaClient,actorId:string,raw:unknown){
 const input=documentInput.extend({...proof,id:z.uuid(),versionId:z.uuid(),action:z.enum(["PUBLISH","REVOKE"]),reason:z.string().trim().min(3).max(2000).optional()}).strict().parse(raw);
 if(input.action==="REVOKE"&&!input.reason)throw new OlympiadError("CONFLICT","Укажите причину отзыва");
 await resultChief(db,actorId,input.editionId);await reauthenticateParticipationChief(db,actorId,input.password);
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT "id" FROM "OlympiadEdition" WHERE "id"=${input.editionId}::uuid FOR UPDATE`;
  await resultChief(tx,actorId,input.editionId);
  const doc=await tx.resultDocument.findFirst({where:{id:input.documentId,editionId:input.editionId},include:{recipients:true}});
  if(!doc)throw new AccessDenied("FORBIDDEN");
  const old=await tx.resultRelease.findUnique({where:{id:input.id}});
  if(old){if(old.documentId!==doc.id||old.actorId!==actorId||old.versionId!==input.versionId||old.action!==input.action||old.reason!==(input.reason??null))throw new OlympiadError("CONFLICT","Идентификатор публикации уже использован");return {id:old.id};}
  if(doc.revision!==input.revision)throw new OlympiadError("CONFLICT","Результат изменён. Обновите данные.");
  const version=await tx.resultVersion.findFirst({where:{id:input.versionId,documentId:doc.id}});
  if(!version)throw new AccessDenied("FORBIDDEN");
  if(input.action==="REVOKE"&&(!doc.currentVersionId||doc.withdrawn||doc.currentVersionId!==version.id))throw new OlympiadError("CONFLICT","Отозвать можно только текущую публикацию");
  if(input.action==="PUBLISH"){
   const latest=await tx.resultVersion.findFirstOrThrow({where:{documentId:doc.id},orderBy:{number:"desc"}});
   if(latest.id!==version.id||doc.currentVersionId===version.id&&!doc.withdrawn)throw new OlympiadError("CONFLICT","Выберите последнюю неопубликованную версию");
   if(doc.sourceResultId&&!await tx.resultPublication.findUnique({where:{batchId:(await tx.individualResult.findUniqueOrThrow({where:{id:doc.sourceResultId}})).batchId}}))throw new OlympiadError("CONFLICT","Сначала опубликуйте исходный пакет");
  }
  const revision=doc.revision+1;
  const release=await tx.resultRelease.create({data:{id:input.id,documentId:doc.id,editionId:doc.editionId,versionId:version.id,actorId,revision,action:input.action,reason:input.reason??null}});
  await tx.resultDocument.update({where:{id:doc.id},data:{currentVersionId:version.id,withdrawn:input.action==="REVOKE",revision}});
  await enqueueEmail(tx,actorId,{kind:"RESULTS_PUBLISHED",sourceId:doc.id,sourceRevision:revision,editionId:doc.editionId,subjectTemplate:input.action==="REVOKE"?"Публикация результата отозвана":"Результат олимпиады обновлён",bodyTemplate:input.action==="REVOKE"?"Публикация вашего результата олимпиады {{year}} отозвана организатором. Подробности доступны у организатора.":"Ваш результат олимпиады {{year}} опубликован. Откройте личный кабинет."},doc.recipients.map(r=>r.participationId));
  await tx.auditEvent.create({data:{actorId,editionId:doc.editionId,action:input.action==="REVOKE"?"RESULT_REVOKED":"RESULT_VERSION_PUBLISHED",objectType:"ResultDocument",objectId:doc.id,outcome:"SUCCESS",details:{versionId:version.id,revision}}});
  return {id:release.id};
 });
}
export async function publishedResultDocuments(db:PrismaClient,actorId:string,editionId:string|undefined,page:number){
 return db.$transaction(async tx=>{
  const actor=await tx.user.findUniqueOrThrow({where:{id:actorId}});if(!actor.emailVerified)throw new AccessDenied("FORBIDDEN");assertDemoRegistration(actor.email);
  let participation:Prisma.ParticipationWhereInput;
  if(actor.role==="STUDENT"){
   participation={userId:actorId,...(editionId?{editionId}:{})};
   if(editionId&&!await tx.participation.count({where:participation}))throw new AccessDenied("FORBIDDEN");
  }else{if(!editionId)throw new AccessDenied("FORBIDDEN");participation=await registrationsScope(tx,actorId,editionId);}
  const published:Prisma.ResultDocumentWhereInput={...(editionId?{editionId}:{}),currentVersionId:{not:null},withdrawn:false,recipients:{some:{participation}}};
  let where=published;
  if(actor.role==="STUDENT"){
   const finals=await tx.resultDocument.findMany({where:{...published,kind:"FINAL"},select:{teamKey:true,recipients:{select:{participationId:true}}}});
   const people=finals.filter(d=>!d.teamKey).flatMap(d=>d.recipients.map(r=>r.participationId)),teams=finals.flatMap(d=>d.teamKey?[d.teamKey]:[]);
   where={...published,OR:[{kind:"FINAL"},{kind:"PRELIMINARY",sourceResultId:{not:null},recipients:{none:{participationId:{in:people}}}},{kind:"PRELIMINARY",teamKey:{not:null,notIn:teams}}]};
  }
  const total=await tx.resultDocument.count({where});
  const rows=await tx.resultDocument.findMany({where,orderBy:[{edition:{year:"desc"}},{id:"asc"}],skip:(page-1)*25,take:25,include:{currentVersion:true,edition:{select:{year:true}},recipients:{where:actor.role==="VENUE_ORGANIZER"?{participation}:undefined,orderBy:{participationId:"asc"}}}});
  return {total,page,rows:rows.map(d=>({id:d.id,kind:d.kind,year:d.edition.year,fullName:d.teamName??d.recipients[0]?.fullName??"",teamName:d.teamName,members:d.recipients.map(r=>({fullName:r.fullName,courseLabel:r.courseLabel,universityName:r.universityName})),total:d.currentVersion!.total,prize:d.currentVersion!.prize,scores:(d.currentVersion!.scores as (number|null)[]).map((score,i)=>({ordinal:i+1,score}))}))};
 },{isolationLevel:"RepeatableRead"});
}
