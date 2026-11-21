import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Prisma, PrismaClient } from "@prisma/client";
import { authorizeStaff, AccessDenied } from "./access";
import { assertDemoRegistration } from "./registration-rules";
import { reauthenticateParticipationChief } from "./corrections";
import { OlympiadError } from "./olympiad-rules";
import { DemoQuarantine } from "./private-files/quarantine";
import { previewDiplomaZip, DIPLOMA_ZIP_LIMITS } from "./private-files/zip-preview";
import { readVerifiedZipEntry } from "./private-files/zip-entry";
import { inspectDiplomaPdf, PdfRejected } from "./private-files/pdf-inspection";
import { enqueueEmail } from "./outbox";
const scope=z.object({editionId:z.uuid()}).strict();
const batchSchema=scope.extend({batchId:z.uuid()}).strict();
const proof={password:z.string().min(1).max(128),confirmed:z.literal(true)};
const selectionSchema=z.array(z.object({itemId:z.uuid(),documentId:z.uuid().nullable(),revision:z.int().nonnegative()}).strict()).min(1).max(1000);
export function diplomaStorage(){return new DemoQuarantine(process.env.DIPLOMA_DIRECTORY||".local/diplomas",50*1024*1024);}
export async function diplomaChief(db:PrismaClient|Prisma.TransactionClient,actorId:string,editionId:string){await authorizeStaff(db,actorId,"diplomas:publish",editionId);assertDemoRegistration((await db.user.findUniqueOrThrow({where:{id:actorId}})).email);}
import { withPreparationLease } from "./private-files/preparation-lease";
export async function prepareDiplomaBatch(db: PrismaClient, actorId: string, raw: unknown, store=diplomaStorage()) {
 return withPreparationLease(db,actorId,()=>prepareDiplomaBatchInternal(db,actorId,raw,store));
}
// The HTTP adapter must acquire the same lease before allocating multipart bytes.
export async function prepareDiplomaUpload(db: PrismaClient, actorId: string, decode: () => Promise<unknown>, store=diplomaStorage()) {
 return withPreparationLease(db,actorId,async()=>prepareDiplomaBatchInternal(db,actorId,await decode(),store));
}
async function prepareDiplomaBatchInternal(db:PrismaClient,actorId:string,raw:unknown,store=diplomaStorage()){
 const input=scope.extend({...proof,id:z.uuid(),bytes:z.instanceof(Uint8Array)}).strict().parse(raw);
 await diplomaChief(db,actorId,input.editionId);await reauthenticateParticipationChief(db,actorId,input.password);
 if(input.bytes.length>50*1024*1024)throw new OlympiadError("CONFLICT","ZIP больше 50 МиБ");
 const buffer=Buffer.from(input.bytes),archiveHash=createHash("sha256").update(buffer).digest("hex");
 const retry=await db.diplomaBatch.findUnique({where:{id:input.id}});
 if(retry){if(retry.editionId!==input.editionId||retry.actorId!==actorId||retry.archiveHash!==archiveHash)throw new OlympiadError("CONFLICT","Идентификатор загрузки уже использован");return {id:retry.id};}
 const rows=await previewDiplomaZip(buffer,DIPLOMA_ZIP_LIMITS);
 const people=await db.participation.findMany({where:{editionId:input.editionId,user:{role:"STUDENT",emailVerified:true}},select:{id:true,user:{select:{email:true,preparedExternalAccount:{select:{login:true,confirmedAt:true}},legacyNsuhwClaim:{select:{login:true}}}}}});
 const owners=new Map<string,string[]>();for(const p of people){if(!p.user.email.endsWith("@example.test"))continue;for(const login of new Set([...(p.user.preparedExternalAccount?.confirmedAt?[p.user.preparedExternalAccount.login]:[]),...(p.user.legacyNsuhwClaim?[p.user.legacyNsuhwClaim.login]:[])]))owners.set(login,[...(owners.get(login)||[]),p.id]);}
 const created:{key:string;sha256:string}[]=[];const items:Prisma.DiplomaItemCreateManyInput[]=[];const deadline=Date.now()+300000;
 await store.initialize();
 try{
  for(const row of rows){
   if(Date.now()>deadline)throw new OlympiadError("CONFLICT","Обработка пакета превысила время. Разделите ZIP на меньшие пакеты.");
   await diplomaChief(db,actorId,input.editionId);
   const matches=row.login?owners.get(row.login)||[]:[];let error:string|null=row.error;const participationId=matches.length===1?matches[0]:null;
   if(!error&&!participationId)error="PARTICIPANT_UNAVAILABLE";
   const item:Prisma.DiplomaItemCreateManyInput={id:randomUUID(),batchId:input.id,editionId:input.editionId,ordinal:row.index,fileName:row.fileName.length>258?row.fileName.slice(0,258)+"…":row.fileName,participationId,error};
   if(!error){
    const bytes=await readVerifiedZipEntry(buffer,row.index,row.sha256!);
    try{const inspected=await inspectDiplomaPdf(bytes,"application/pdf");const file=await store.put(bytes);created.push(file);Object.assign(item,{fileKey:file.key,fileHash:inspected.sha256,size:file.size,pages:inspected.pages,inspectedAt:new Date()});}
    catch(e){if(e instanceof PdfRejected)item.error="PDF_REJECTED";else throw e;}
   }
   items.push(item);
  }
  await db.$transaction(async tx=>{
   await tx.$queryRaw`SELECT "id" FROM "OlympiadEdition" WHERE "id"=${input.editionId}::uuid FOR UPDATE`;
   await diplomaChief(tx,actorId,input.editionId);
   await tx.diplomaBatch.create({data:{id:input.id,editionId:input.editionId,actorId,archiveHash}});
   await tx.diplomaItem.createMany({data:items});
   await tx.auditEvent.create({data:{actorId,action:"DIPLOMA_BATCH_PREPARED",objectType:"DiplomaBatch",objectId:input.id,editionId:input.editionId,outcome:"SUCCESS",details:{count:items.length,ready:items.filter(i=>!i.error).length}}});
  },{timeout:30000});
  return {id:input.id};
 }catch(error){for(const file of created)await store.remove(file.key,file.sha256).catch(()=>{});throw error;}
}
export async function diplomaBatchView(db:PrismaClient,actorId:string,raw:unknown){
 const input=scope.extend({batchId:z.uuid().optional(),page:z.int().min(1).max(10000).default(1)}).strict().parse(raw);
 return db.$transaction(async tx=>{
  await diplomaChief(tx,actorId,input.editionId);
  const batches=await tx.diplomaBatch.findMany({where:{editionId:input.editionId},orderBy:[{createdAt:"desc"},{id:"desc"}],skip:(input.page-1)*25,take:25,select:{id:true,createdAt:true,appliedAt:true,publishedAt:true}});
  const total=await tx.diplomaBatch.count({where:{editionId:input.editionId}});
  if(!input.batchId)return {total,batches,batch:null,items:[]};
  const batch=await tx.diplomaBatch.findFirst({where:{id:input.batchId,editionId:input.editionId},select:{id:true,appliedAt:true,publishedAt:true}});if(!batch)throw new AccessDenied("FORBIDDEN");
  const rows=await tx.diplomaItem.findMany({where:{batchId:batch.id,editionId:input.editionId},orderBy:{ordinal:"asc"},select:{id:true,ordinal:true,fileName:true,error:true,participationId:true,participation:{select:{fullName:true,diplomaDocuments:{where:{currentVersionId:{not:null}},select:{id:true,revision:true,currentVersion:{select:{item:{select:{batch:{select:{publishedAt:true}}}}}}}}}}}});
  return {total,batches,batch,items:rows.map(r=>({id:r.id,ordinal:r.ordinal,fileName:r.fileName,error:r.error,fullName:r.participation?.fullName??null,documents:r.participation?.diplomaDocuments??[]}))};
 },{isolationLevel:"RepeatableRead"});
}
export async function applyDiplomaBatch(db:PrismaClient,actorId:string,raw:unknown){
 const input=batchSchema.extend({...proof,selection:selectionSchema}).strict().parse(raw);
 const canonical=[...input.selection].sort((a,b)=>a.itemId.localeCompare(b.itemId));const selectionHash=createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
 await diplomaChief(db,actorId,input.editionId);await reauthenticateParticipationChief(db,actorId,input.password);
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT "id" FROM "OlympiadEdition" WHERE "id"=${input.editionId}::uuid FOR UPDATE`;
  await diplomaChief(tx,actorId,input.editionId);
  const batch=await tx.diplomaBatch.findFirst({where:{id:input.batchId,editionId:input.editionId}});if(!batch)throw new AccessDenied("FORBIDDEN");
  if(batch.appliedAt){if(batch.selectionHash!==selectionHash)throw new OlympiadError("CONFLICT","Загрузка уже подтверждена с другим составом");return {id:batch.id};}
  const items=await tx.diplomaItem.findMany({where:{batchId:batch.id,error:null}});
  if(!items.length||items.length!==canonical.length||new Set(canonical.map(s=>s.itemId)).size!==items.length)throw new OlympiadError("CONFLICT","Подтвердите все корректные файлы");
  const selectedDocs=canonical.flatMap(s=>s.documentId?[s.documentId]:[]);if(new Set(selectedDocs).size!==selectedDocs.length)throw new OlympiadError("CONFLICT","Повтор документа в замене");
  await tx.diplomaBatch.update({where:{id:batch.id},data:{appliedAt:new Date(),selectionHash}});
  for(const item of items){
   const choice=canonical.find(c=>c.itemId===item.id);if(!choice||!item.participationId)throw new AccessDenied("FORBIDDEN");
   const owner=await tx.participation.findFirst({where:{id:item.participationId,editionId:input.editionId,user:{role:"STUDENT",emailVerified:true}},select:{id:true}});if(!owner)throw new AccessDenied("FORBIDDEN");
   const document=choice.documentId?await tx.diplomaDocument.findFirst({where:{id:choice.documentId,editionId:input.editionId,participationId:item.participationId,currentVersionId:{not:null}}}):await tx.diplomaDocument.create({data:{editionId:input.editionId,participationId:item.participationId}});
   if(!document||document.revision!==choice.revision)throw new OlympiadError("CONFLICT","Диплом изменился. Обновите предпросмотр.");
   await tx.diplomaVersion.create({data:{editionId:input.editionId,documentId:document.id,itemId:item.id,baseRevision:document.revision}});
  }
  await tx.auditEvent.create({data:{actorId,action:"DIPLOMA_BATCH_APPLIED",objectType:"DiplomaBatch",objectId:batch.id,editionId:input.editionId,outcome:"SUCCESS",details:{count:items.length}}});return {id:batch.id};
 },{timeout:30000});
}
export async function publishDiplomaBatch(db:PrismaClient,actorId:string,raw:unknown,store=diplomaStorage()){
 const input=batchSchema.extend(proof).strict().parse(raw);await diplomaChief(db,actorId,input.editionId);await reauthenticateParticipationChief(db,actorId,input.password);
 const staged=await db.diplomaBatch.findFirst({where:{id:input.batchId,editionId:input.editionId},include:{items:{where:{error:null}}}});
 if(!staged)throw new AccessDenied("FORBIDDEN");
 if(!staged.publishedAt)for(const item of staged.items){if(!item.fileKey||!item.fileHash)throw new AccessDenied("FORBIDDEN");await store.read(item.fileKey,item.fileHash);}

 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT "id" FROM "OlympiadEdition" WHERE "id"=${input.editionId}::uuid FOR UPDATE`;
  await diplomaChief(tx,actorId,input.editionId);
  const batch=await tx.diplomaBatch.findFirst({where:{id:input.batchId,editionId:input.editionId},include:{items:{where:{error:null},include:{version:{include:{document:true}}}}}});if(!batch)throw new AccessDenied("FORBIDDEN");
  if(batch.publishedAt)return {id:batch.id};if(!batch.appliedAt)throw new OlympiadError("CONFLICT","Сначала подтвердите корректные файлы");
  await tx.diplomaBatch.update({where:{id:batch.id},data:{publishedAt:new Date()}});
  for(const item of batch.items){const version=item.version;if(!version||version.document.revision!==version.baseRevision)throw new OlympiadError("CONFLICT","Опубликована другая версия. Не заменяйте её старой командой.");await tx.diplomaDocument.update({where:{id:version.documentId},data:{currentVersionId:version.id,revision:{increment:1}}});}
  await enqueueEmail(tx,actorId,{kind:"DIPLOMAS_PUBLISHED",sourceId:batch.id,sourceRevision:1,editionId:input.editionId,editionVenueId:null,subjectTemplate:"Диплом доступен в личном кабинете",bodyTemplate:"В разделе «Дипломы» опубликован ваш документ олимпиады {{year}}. Откройте личный кабинет."},batch.items.map(i=>i.participationId!));
  await tx.auditEvent.create({data:{actorId,action:"DIPLOMA_BATCH_PUBLISHED",objectType:"DiplomaBatch",objectId:batch.id,editionId:input.editionId,outcome:"SUCCESS",details:{count:batch.items.length}}});return {id:batch.id};
 },{timeout:30000});
}
export async function ownDiplomas(db:PrismaClient,actorId:string){
 const user=await db.user.findUniqueOrThrow({where:{id:actorId}});if(user.role!=="STUDENT"||!user.emailVerified)throw new AccessDenied("FORBIDDEN");assertDemoRegistration(user.email);
 return db.diplomaDocument.findMany({where:{currentVersionId:{not:null},participation:{userId:actorId}},orderBy:{id:"asc"},select:{id:true,revision:true,edition:{select:{year:true}},currentVersion:{select:{item:{select:{batch:{select:{publishedAt:true}}}}}}}});
}
export async function downloadDiploma(db:PrismaClient,actorId:string,raw:unknown,store=diplomaStorage()){
 const {documentId}=z.object({documentId:z.uuid()}).strict().parse(raw);
 const doc=await db.diplomaDocument.findUnique({where:{id:documentId},include:{participation:{select:{userId:true}},currentVersion:{include:{item:{include:{batch:true}}}}}});
 const user=await db.user.findUniqueOrThrow({where:{id:actorId}});if(!user.emailVerified||!doc?.currentVersion||!doc.currentVersion.item.batch.publishedAt)throw new AccessDenied("FORBIDDEN");assertDemoRegistration(user.email);
 if(user.role==="STUDENT"){if(doc.participation.userId!==actorId)throw new AccessDenied("FORBIDDEN");}else await diplomaChief(db,actorId,doc.editionId);
 const item=doc.currentVersion.item;if(item.error||!item.fileKey||!item.fileHash||!item.inspectedAt)throw new AccessDenied("FORBIDDEN");
 const bytes=await store.read(item.fileKey,item.fileHash);
 // Re-check current version after disk read; a superseded version is never returned.
 await db.$transaction(async tx=>{
  const fresh=await tx.user.findUniqueOrThrow({where:{id:actorId}});if(!fresh.emailVerified)throw new AccessDenied("FORBIDDEN");assertDemoRegistration(fresh.email);
  if(fresh.role==="STUDENT"){if(doc.participation.userId!==actorId)throw new AccessDenied("FORBIDDEN");}else await diplomaChief(tx,actorId,doc.editionId);
  const current=await tx.diplomaDocument.findUniqueOrThrow({where:{id:doc.id},select:{currentVersionId:true}});if(current.currentVersionId!==doc.currentVersionId)throw new OlympiadError("CONFLICT","Диплом заменён. Обновите список.");
  await tx.auditEvent.create({data:{actorId,action:"DIPLOMA_DOWNLOADED",objectType:"DiplomaDocument",objectId:doc.id,editionId:doc.editionId,outcome:"SUCCESS",details:{revision:doc.revision}}});
 });
 return {id:doc.id,bytes};
}
