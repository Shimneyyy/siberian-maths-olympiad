import { createHmac, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Prisma, PrismaClient } from "@prisma/client";
import { parseResultCsv } from "./result-csv";
import { resultChief } from "./result-documents";
import { reauthenticateParticipationChief } from "./corrections";
import { OlympiadError } from "./olympiad-rules";
const scope=z.object({editionId:z.uuid()}).strict();
const source=scope.extend({kind:z.enum(["PRELIMINARY","FINAL"]),csv:z.string().max(524288)}).strict();
function fingerprint(value:unknown){const key=process.env.BETTER_AUTH_SECRET;if(!key)throw new Error("Auth configuration required");return createHmac("sha256",key).update("team-results-v1\0").update(JSON.stringify(value)).digest("hex");}
async function inspect(tx:Prisma.TransactionClient,input:z.infer<typeof source>){
 const parsed=parseResultCsv(input.csv,"team");
 for(const row of parsed.rows)row.login=row.login.toLowerCase();
 const tasks=await tx.editionProblem.count({where:{editionId:input.editionId}});
 if(tasks&&tasks!==parsed.taskCount)throw new OlympiadError("CONFLICT","Число задач не совпадает с задачами этого года");
 const ids=parsed.rows.flatMap(r=>z.uuid().safeParse(r.login).success?[r.login]:[]);
 const teams=await tx.team.findMany({where:{id:{in:ids},editionId:input.editionId},include:{members:{orderBy:{participationId:"asc"},include:{participation:true}}}});
 const existing=await tx.resultDocument.findMany({where:{editionId:input.editionId,kind:input.kind,teamKey:{in:ids}},select:{teamKey:true}});
 const counts=new Map<string,number>();for(const r of parsed.rows)counts.set(r.login,(counts.get(r.login)||0)+1);
 const rows=parsed.rows.map(r=>{
  const team=teams.find(t=>t.id===r.login);
  const error=r.error??(!z.uuid().safeParse(r.login).success?"INVALID_TEAM_ID":(counts.get(r.login)||0)>1?"DUPLICATE":!team||!team.members.length?"TEAM_UNAVAILABLE":existing.some(e=>e.teamKey===team.id)?"ALREADY_EXISTS":null);
  return {...r,error,teamId:team?.id??null,teamName:team?.name??null,members:team?.members.map(m=>({participationId:m.participationId,revision:m.participation.revision,fullName:m.participation.fullName,courseLabel:m.participation.courseLabel,universityName:m.participation.universityName}))??[]};
 });
 return {taskCount:parsed.taskCount,rows,validCount:rows.filter(r=>!r.error).length,rejectedCount:rows.filter(r=>!!r.error).length,selectionHash:fingerprint({input,rows})};
}
export async function teamResultRoster(db:PrismaClient,actorId:string,raw:unknown){
 const input=scope.extend({page:z.int().min(1).max(10000).default(1)}).strict().parse(raw);
 return db.$transaction(async tx=>{await resultChief(tx,actorId,input.editionId);const where={editionId:input.editionId};return {total:await tx.team.count({where}),page:input.page,teams:await tx.team.findMany({where,orderBy:{id:"asc"},skip:(input.page-1)*25,take:25,select:{id:true,name:true,members:{select:{participation:{select:{fullName:true,courseLabel:true,universityName:true}}}}}})};},{isolationLevel:"RepeatableRead"});
}
export async function previewTeamResults(db:PrismaClient,actorId:string,raw:unknown){
 const input=source.parse(raw);return db.$transaction(async tx=>{await resultChief(tx,actorId,input.editionId);return inspect(tx,input);},{isolationLevel:"RepeatableRead",timeout:30000});
}
export async function applyTeamResults(db:PrismaClient,actorId:string,raw:unknown){
 const input=source.extend({id:z.uuid(),selectionHash:z.string().regex(/^[a-f0-9]{64}$/),password:z.string().min(1).max(128),confirmed:z.literal(true)}).strict().parse(raw);
 await resultChief(db,actorId,input.editionId);await reauthenticateParticipationChief(db,actorId,input.password);
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT "id" FROM "OlympiadEdition" WHERE "id"=${input.editionId}::uuid FOR UPDATE`;
  await resultChief(tx,actorId,input.editionId);
  const original={editionId:input.editionId,kind:input.kind,csv:input.csv};const sourceHash=fingerprint(original);
  const old=await tx.teamResultImport.findUnique({where:{id:input.id}});
  if(old){if(old.editionId!==input.editionId||old.actorId!==actorId||old.kind!==input.kind||old.sourceHash!==sourceHash)throw new OlympiadError("CONFLICT","Идентификатор импорта уже использован");return {id:old.id,importedCount:old.importedCount,rejectedCount:old.rejectedCount};}
  const preview=await inspect(tx,original);
  if(preview.selectionHash!==input.selectionHash)throw new OlympiadError("CONFLICT","Состав команды или результаты изменились. Повторите предпросмотр.");
  if(!preview.validCount)throw new OlympiadError("CONFLICT","Нет верных строк");
  await tx.teamResultImport.create({data:{id:input.id,editionId:input.editionId,actorId,kind:input.kind,sourceHash,importedCount:preview.validCount,rejectedCount:preview.rejectedCount,report:preview.rows.map(r=>({line:r.line,error:r.error}))}});
  if(!await tx.editionProblem.count({where:{editionId:input.editionId}}))await tx.editionProblem.createMany({data:Array.from({length:preview.taskCount},(_,i)=>({editionId:input.editionId,ordinal:i+1}))});
  const ready=preview.rows.filter(r=>!r.error).map(row=>({row,id:randomUUID(),versionId:randomUUID()}));
  for(let at=0;at<ready.length;at+=100){
   const chunk=ready.slice(at,at+100);
   await tx.resultDocument.createMany({data:chunk.map(({row,id})=>({id,editionId:input.editionId,kind:input.kind,teamKey:row.teamId!,teamName:row.teamName!,teamBatchId:input.id}))});
   await tx.resultVersion.createMany({data:chunk.map(({row,id,versionId})=>({id:versionId,documentId:id,editionId:input.editionId,actorId,number:1,scores:row.scores,total:row.total,prize:row.prize}))});
   await tx.resultRecipient.createMany({data:chunk.flatMap(({row,id})=>row.members.map(m=>({documentId:id,editionId:input.editionId,participationId:m.participationId,fullName:m.fullName,courseLabel:m.courseLabel,universityName:m.universityName})))});
  }
  await tx.auditEvent.create({data:{actorId,editionId:input.editionId,action:"TEAM_RESULTS_IMPORTED",objectType:"TeamResultImport",objectId:input.id,outcome:"SUCCESS",details:{importedCount:preview.validCount,rejectedCount:preview.rejectedCount}}});
  return {id:input.id,importedCount:preview.validCount,rejectedCount:preview.rejectedCount};
 },{timeout:30000});
}
