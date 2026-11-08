import { randomInt } from "node:crypto";
import { z } from "zod";
import type { Prisma,PrismaClient } from "@prisma/client";
import { AccessDenied } from "./access";
import { assertDemoRegistration } from "./registration-rules";
import { assertNoLegacyNsuhwClaim } from "./legacy-nsuhw";
import { nsuhwLoginPreview } from "./nsuhw-login-name-rules";
import { lockNsuhwNamespace } from "./nsuhw-namespace";
import { OlympiadError } from "./olympiad-rules";
import { loadDemoKeyProtector } from "./external-secrets/local-keys";
import { storePreparedExternalAccount } from "./external-secrets/storage";
import type { KeyProtector } from "./external-secrets/envelope";
const metadata={id:true,login:true,createdAt:true} as const;
function newPassword(){const chars="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";for(;;){const value=Array.from({length:24},()=>chars[randomInt(chars.length)]).join("");if(/[A-Z]/.test(value)&&/[a-z]/.test(value)&&/[0-9]/.test(value))return value;}}
// Trusted signup/internal transaction only. No plaintext leaves this function.
export async function prepareNsuhwInTransaction(tx:Prisma.TransactionClient,userId:string,protector?:KeyProtector,expectedNameRevision?:number){
 await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId}::uuid FOR UPDATE`;
 const user=await tx.user.findUniqueOrThrow({where:{id:userId}});if(user.role!=="STUDENT")throw new AccessDenied("FORBIDDEN");assertDemoRegistration(user.email);
 await assertNoLegacyNsuhwClaim(tx,userId);
 const existing=await tx.preparedExternalAccount.findUnique({where:{userId},select:metadata});if(existing)return existing;
 const names=await tx.nsuhwLoginName.findUnique({where:{userId}});
 if(!names)throw new OlympiadError("PROFILE_REQUIRED","Заполните отдельные имя и фамилию латиницей");
 if(expectedNameRevision!==undefined&&expectedNameRevision!==names.revision)throw new OlympiadError("CONFLICT","Данные имени изменились. Загрузите актуальный предпросмотр.");
 const stem=nsuhwLoginPreview({firstNameLatin:names.firstNameLatin,lastNameLatin:names.lastNameLatin});if(!stem)throw new OlympiadError("PROFILE_REQUIRED","Проверьте латинское написание имени и фамилии");
 const keys=protector??await loadDemoKeyProtector();
 await lockNsuhwNamespace(tx);
 const prepared=await tx.preparedExternalAccount.findMany({where:{login:{startsWith:stem,mode:"insensitive"}},select:{login:true}});
 const legacy=await tx.legacyNsuhwClaim.findMany({where:{login:{startsWith:stem,mode:"insensitive"}},select:{login:true}});
 const occupied=new Set([...prepared,...legacy].map(x=>x.login.toLowerCase()));
 let index=1,login=stem;while(occupied.has(login)){index++;login=`${stem}${index}`;}
 const stored=await storePreparedExternalAccount(tx,userId,login,newPassword(),keys);
 await tx.auditEvent.create({data:{actorId:userId,action:"NSUHW_ACCOUNT_PREPARED",objectType:"PreparedExternalAccount",objectId:stored.id,outcome:"SUCCESS",details:{suffix:index}}});
 return tx.preparedExternalAccount.findUniqueOrThrow({where:{id:stored.id},select:metadata});
}
export async function preparedNsuhwView(db:PrismaClient,actorId:string){
 const user=await db.user.findUnique({where:{id:actorId}});if(!user?.emailVerified||user.role!=="STUDENT")throw new AccessDenied("FORBIDDEN");
 return db.preparedExternalAccount.findUnique({where:{userId:actorId},select:metadata});
}
export async function prepareNsuhw(db:PrismaClient,actorId:string,raw:unknown){
 const input=z.object({confirmed:z.literal(true),nameRevision:z.int().nonnegative()}).strict().parse(raw);
 await preparedNsuhwView(db,actorId);
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${actorId}::uuid FOR UPDATE`;
  const user=await tx.user.findUniqueOrThrow({where:{id:actorId}});if(!user.emailVerified||user.role!=="STUDENT")throw new AccessDenied("FORBIDDEN");
  return prepareNsuhwInTransaction(tx,actorId,undefined,input.nameRevision);
 });
}
