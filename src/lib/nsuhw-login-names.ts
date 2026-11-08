import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { AccessDenied } from "./access";
import { assertDemoRegistration } from "./registration-rules";
import { assertNoLegacyNsuhwClaim } from "./legacy-nsuhw";
import { nsuhwLoginNamesSchema, nsuhwLoginPreview } from "./nsuhw-login-name-rules";
import { OlympiadError } from "./olympiad-rules";
async function student(db:PrismaClient,actorId:string){const user=await db.user.findUnique({where:{id:actorId}});if(!user?.emailVerified||user.role!=="STUDENT")throw new AccessDenied("FORBIDDEN");return user;}
export async function nsuhwLoginNamesView(db:PrismaClient,actorId:string){await student(db,actorId);const draft=await db.nsuhwLoginName.findUnique({where:{userId:actorId},select:{firstNameLatin:true,lastNameLatin:true,revision:true}});return draft?{...draft,preview:nsuhwLoginPreview({firstNameLatin:draft.firstNameLatin,lastNameLatin:draft.lastNameLatin})}:null;}
export async function saveNsuhwLoginNames(db:PrismaClient,actorId:string,raw:unknown){
 const input=nsuhwLoginNamesSchema.extend({revision:z.int().nonnegative()}).strict().parse(raw);
 assertDemoRegistration((await student(db,actorId)).email);
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${actorId}::uuid FOR UPDATE`;
  const actor=await tx.user.findUniqueOrThrow({where:{id:actorId}});if(!actor.emailVerified||actor.role!=="STUDENT")throw new AccessDenied("FORBIDDEN");
  await assertNoLegacyNsuhwClaim(tx,actorId);
  const old=await tx.nsuhwLoginName.findUnique({where:{userId:actorId}});
  if((old?.revision??0)!==input.revision)throw new OlympiadError("CONFLICT","Данные уже изменены. Обновите форму.");
  const data={firstNameLatin:input.firstNameLatin,lastNameLatin:input.lastNameLatin,revision:input.revision+1};
  await tx.nsuhwLoginName.upsert({where:{userId:actorId},create:{userId:actorId,...data},update:data});
  await tx.auditEvent.create({data:{actorId,action:"NSUHW_LOGIN_NAMES_UPDATED",objectType:"User",objectId:actorId,outcome:"SUCCESS",details:{revision:data.revision}}});
  return {revision:data.revision,preview:nsuhwLoginPreview({firstNameLatin:data.firstNameLatin,lastNameLatin:data.lastNameLatin})};
 });
}
