import { randomUUID } from "node:crypto";
import { verifyPassword } from "better-auth/crypto";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { AccessDenied } from "./access";
import { AdminRateLimit } from "./admin";
import { assertDemoRegistration } from "./registration-rules";
import { OlympiadError } from "./olympiad-rules";
const schema=z.object({password:z.string().min(1).max(128),confirmed:z.literal(true)}).strict();
// Own verified student only. No account/user identifiers can be supplied by a caller.
export async function authorizeNsuhwSecretRead(db:PrismaClient,actorId:string,raw:unknown){
 const input=schema.parse(raw),user=await db.user.findUnique({where:{id:actorId}});
 if(!user?.emailVerified||user.role!=="STUDENT")throw new AccessDenied("FORBIDDEN");assertDemoRegistration(user.email);
 const account=await db.preparedExternalAccount.findUnique({where:{userId:actorId},select:{confirmedAt:true}});
 if(!account?.confirmedAt)throw new OlympiadError("CONFLICT","Создание аккаунта nsuhw ещё не подтверждено главным организатором");
 try{
  const now=BigInt(Date.now()),threshold=now-60000n,key=`nsuhw-secret-reauth:${actorId}`;
  const [bucket]=await db.$queryRaw<{count:number}[]>`INSERT INTO "RateLimit" ("id","key","count","lastRequest") VALUES (${randomUUID()}::uuid,${key},1,${now})
   ON CONFLICT ("key") DO UPDATE SET "count"=CASE WHEN "RateLimit"."lastRequest" < ${threshold} THEN 1 ELSE "RateLimit"."count"+1 END,
   "lastRequest"=CASE WHEN "RateLimit"."lastRequest" < ${threshold} THEN ${now} ELSE "RateLimit"."lastRequest" END RETURNING "count"`;
  if(bucket.count>5)throw new AdminRateLimit();
  const credential=await db.account.findFirst({where:{userId:actorId,providerId:"credential"},select:{password:true}});
  if(!credential?.password||!await verifyPassword({hash:credential.password,password:input.password}))throw new AccessDenied("FORBIDDEN");
 }catch(error){await db.auditEvent.create({data:{actorId,action:"NSUHW_SECRET_REAUTH_DENIED",objectType:"User",objectId:actorId,outcome:"DENIED"}});throw error;}
}
