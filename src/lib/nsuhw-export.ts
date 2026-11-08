import { createHash } from "node:crypto";
import { z } from "zod";
import type { Prisma,PrismaClient } from "@prisma/client";
import { authorizeStaff,AccessDenied } from "./access";
import { assertDemoRegistration } from "./registration-rules";
import { reauthenticateParticipationChief } from "./corrections";
import { OlympiadError } from "./olympiad-rules";
import { loadDemoKeyProtector } from "./external-secrets/local-keys";
import { openExternalPassword,ExternalSecretError,type KeyProtector } from "./external-secrets/envelope";
import { externalSecretContext } from "./external-secrets/storage";
import { enqueueEmail } from "./outbox";
import { csvRow } from "./csv";
const itemSchema=z.object({accountId:z.uuid(),participationId:z.uuid(),credentialVersion:z.int().positive()}).strict();
const itemsSchema=z.array(itemSchema).min(1).max(10000);
const scopeSchema=z.object({editionId:z.uuid()}).strict();
const downloadSchema=scopeSchema.extend({password:z.string().min(1).max(128),confirmed:z.literal(true),selectionHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const confirmationSchema=scopeSchema.extend({batchId:z.uuid(),password:z.string().min(1).max(128),confirmed:z.literal(true),createdOnNsuhw:z.literal(true)}).strict();
async function candidates(tx:Prisma.TransactionClient,editionId:string){
 const rows=await tx.participation.findMany({where:{editionId,status:"REGISTERED",user:{role:"STUDENT",emailVerified:true,preparedExternalAccount:{is:{confirmedAt:null}}}},select:{id:true,userId:true,fullName:true,revision:true,user:{select:{preparedExternalAccount:{select:{id:true,login:true,credentialVersion:true}}}}},orderBy:{id:"asc"},take:10001});
 if(rows.length>10000)throw new OlympiadError("CONFLICT","Выгрузка ограничена 10000 аккаунтами");
 const selectionHash=createHash("sha256").update(JSON.stringify(rows.map(r=>[r.id,r.revision,r.user.preparedExternalAccount!.id,r.user.preparedExternalAccount!.login,r.user.preparedExternalAccount!.credentialVersion]))).digest("hex");
 return {rows,selectionHash};
}
async function authorizeWrite(db:PrismaClient,actorId:string,editionId:string,password:string){await authorizeStaff(db,actorId,"notifications:send",editionId);assertDemoRegistration((await db.user.findUniqueOrThrow({where:{id:actorId}})).email);await reauthenticateParticipationChief(db,actorId,password);}
export async function nsuhwExportView(db:PrismaClient,actorId:string,raw:unknown){
 const {editionId}=scopeSchema.parse(raw);
 return db.$transaction(async tx=>{
  await authorizeStaff(tx,actorId,"notifications:send",editionId);const {rows,selectionHash}=await candidates(tx,editionId);
  const existing=await tx.participation.findMany({where:{editionId,status:"REGISTERED",user:{role:"STUDENT",emailVerified:true,OR:[{preparedExternalAccount:{is:{confirmedAt:{not:null}}}},{legacyNsuhwClaim:{is:{approvedAt:{not:null}}}}]}},select:{id:true,fullName:true,user:{select:{preparedExternalAccount:{select:{login:true,confirmedAt:true}},legacyNsuhwClaim:{select:{login:true}}}}},orderBy:{id:"asc"},take:10001});
  if(existing.length>10000)throw new OlympiadError("CONFLICT","Список ограничен 10000 аккаунтами");
  const pendingLegacyCount=await tx.participation.count({where:{editionId,status:"REGISTERED",user:{role:"STUDENT",emailVerified:true,legacyNsuhwClaim:{is:{approvedAt:null}}}}});
  const batches=await tx.nsuhwExportBatch.findMany({where:{editionId},orderBy:[{createdAt:"desc"},{id:"desc"}],select:{id:true,createdAt:true,confirmedAt:true,items:true}});
  return {selectionHash,count:rows.length,existingParticipants:existing.map(p=>({id:p.id,fullName:p.fullName,login:p.user.preparedExternalAccount?.confirmedAt?p.user.preparedExternalAccount.login:p.user.legacyNsuhwClaim!.login})),pendingLegacyCount,participants:rows.map(r=>({id:r.id,fullName:r.fullName,login:r.user.preparedExternalAccount!.login})),batches:batches.map(b=>({id:b.id,createdAt:b.createdAt,confirmedAt:b.confirmedAt,count:itemsSchema.parse(b.items).length}))};
 },{isolationLevel:"RepeatableRead"});
}
export async function downloadNsuhwExport(db:PrismaClient,actorId:string,raw:unknown,protector?:KeyProtector){
 const input=downloadSchema.parse(raw);await authorizeWrite(db,actorId,input.editionId,input.password);
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT "id" FROM "OlympiadEdition" WHERE "id" = ${input.editionId}::uuid FOR UPDATE`;
  await authorizeStaff(tx,actorId,"notifications:send",input.editionId);
  const selection=await candidates(tx,input.editionId);if(selection.selectionHash!==input.selectionHash||!selection.rows.length)throw new OlympiadError("CONFLICT","Состав выгрузки изменился или пуст. Обновите предпросмотр и подтвердите заново.");
  for(const id of [...new Set(selection.rows.map(r=>r.userId))].sort())await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${id}::uuid FOR UPDATE`;
  const keys=protector??await loadDemoKeyProtector(),items:z.infer<typeof itemSchema>[]=[],lines=["\uFEFF"+csvRow(["Логин","пароль","ФИО"])];
  for(const p of selection.rows){
   const expected=p.user.preparedExternalAccount!,account=await tx.preparedExternalAccount.findUniqueOrThrow({where:{id:expected.id}});
   if(account.userId!==p.userId||account.credentialVersion!==expected.credentialVersion||account.confirmedAt)throw new OlympiadError("CONFLICT","Учётные данные изменились. Обновите предпросмотр.");
   if((account.secretEnvelope as {keyVersion?:unknown})?.keyVersion!==account.keyVersion)throw new ExternalSecretError();
   const password=await openExternalPassword(account.secretEnvelope,externalSecretContext(account),keys);
   const values=[account.login,password,p.fullName];
   if(values.some(v=>/^(?:[\s\u0000-\u001f]*[=+\-@]|[\u0000-\u001f])/u.test(v)))throw new OlympiadError("CONFLICT","Опасное для таблицы начало поля. Исправьте исходные данные, выгрузка не создана.");
   lines.push(csvRow(values));items.push({accountId:account.id,participationId:p.id,credentialVersion:account.credentialVersion});
  }
  const batch=await tx.nsuhwExportBatch.create({data:{editionId:input.editionId,actorId,items},select:{id:true}});
  await tx.auditEvent.create({data:{actorId,action:"NSUHW_EXPORT_DOWNLOADED",objectType:"NsuhwExportBatch",objectId:batch.id,editionId:input.editionId,outcome:"SUCCESS",details:{count:items.length}}});
  const edition=await tx.olympiadEdition.findUniqueOrThrow({where:{id:input.editionId},select:{year:true}});
  return {id:batch.id,filename:`nsuhw-${edition.year}-${batch.id}.csv`,csv:lines.join("")};
 },{timeout:30000});
}
export async function confirmNsuhwExport(db:PrismaClient,actorId:string,raw:unknown){
 const input=confirmationSchema.parse(raw);await authorizeWrite(db,actorId,input.editionId,input.password);
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT "id" FROM "OlympiadEdition" WHERE "id" = ${input.editionId}::uuid FOR UPDATE`;
  await tx.$queryRaw`SELECT "id" FROM "NsuhwExportBatch" WHERE "id" = ${input.batchId}::uuid FOR UPDATE`;
  await authorizeStaff(tx,actorId,"notifications:send",input.editionId);
  const batch=await tx.nsuhwExportBatch.findFirst({where:{id:input.batchId,editionId:input.editionId}});if(!batch)throw new AccessDenied("FORBIDDEN");
  const items=itemsSchema.parse(batch.items);if(batch.confirmedAt)return {id:batch.id,confirmedAt:batch.confirmedAt};
  const targets=[];
  for(const item of items){const p=await tx.participation.findFirst({where:{id:item.participationId,editionId:batch.editionId},select:{userId:true}});if(!p)throw new AccessDenied("FORBIDDEN");targets.push({...item,userId:p.userId});}
  for(const id of [...new Set(targets.map(t=>t.userId))].sort())await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${id}::uuid FOR UPDATE`;
  const confirmedAt=new Date();let created=0;
  for(const item of targets){
   const account=await tx.preparedExternalAccount.findUniqueOrThrow({where:{id:item.accountId}});
   if(account.userId!==item.userId||account.credentialVersion!==item.credentialVersion)throw new OlympiadError("CONFLICT","Состав или версия аккаунтов изменились. Не подтверждайте этот файл.");
   if(account.confirmedAt)continue;
   await tx.preparedExternalAccount.update({where:{id:account.id},data:{confirmedAt,confirmedById:actorId,confirmedEditionId:input.editionId,revision:{increment:1}}});
   await enqueueEmail(tx,actorId,{kind:"EXTERNAL_ACCOUNT_READY",sourceId:account.id,sourceRevision:account.credentialVersion,editionId:input.editionId,editionVenueId:null,subjectTemplate:"Создание аккаунта nsuhw подтверждено",bodyTemplate:"Главный организатор подтвердил создание аккаунта nsuhw. Статус доступен в разделе «Аккаунт nsuhw» личного кабинета. Пароль в письме не передаётся."},[item.participationId]);created++;
  }
  await tx.nsuhwExportBatch.update({where:{id:batch.id},data:{confirmedAt,confirmedById:actorId}});
  await tx.auditEvent.create({data:{actorId,action:"NSUHW_EXPORT_CREATION_CONFIRMED",objectType:"NsuhwExportBatch",objectId:batch.id,editionId:input.editionId,outcome:"SUCCESS",details:{count:items.length,newlyConfirmed:created}}});
  return {id:batch.id,confirmedAt};
 },{timeout:30000});
}
