import { randomUUID, createHmac } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { AdminRateLimit } from "./admin";
export async function consumeRateLimit(db:PrismaClient,key:string,max:number,windowMs=60000,clock=Date.now()) {
  const now=BigInt(clock), threshold=now-BigInt(windowMs);
  const [bucket]=await db.$queryRaw<{count:number}[]>`INSERT INTO "RateLimit" ("id","key","count","lastRequest") VALUES (${randomUUID()}::uuid,${key},1,${now})
    ON CONFLICT ("key") DO UPDATE SET "count"=CASE WHEN "RateLimit"."lastRequest" <= ${threshold} THEN 1 ELSE "RateLimit"."count"+1 END,
    "lastRequest"=CASE WHEN "RateLimit"."lastRequest" <= ${threshold} THEN ${now} ELSE "RateLimit"."lastRequest" END RETURNING "count"`;
  if(bucket.count>max)throw new AdminRateLimit();
}
export async function limitAuthRequest(db:PrismaClient,path:string,body:unknown,identity?:string) {
  const limits:Record<string,number>={"sign-in/email":5,"sign-up/email":5,"request-password-reset":3,"reset-password":5,"email-otp/send-verification-otp":3,"email-otp/verify-email":5};
  if(!limits[path]) return;
  const value=body && typeof body==="object" ? body as Record<string,unknown> : {};
  const subject=path==="reset-password"
    ? typeof value.token==="string"?value.token:"invalid-body"
    : typeof value.email==="string"?value.email.trim().toLowerCase():"invalid-body";
  const secret=process.env.BETTER_AUTH_SECRET;if(!secret)throw new Error("Auth configuration unavailable");
  const digest=createHmac("sha256",secret).update("auth-rate-v1\0").update(subject).digest("hex");
  if(identity){
    const max=Number(process.env.AUTH_IP_MAX_PER_MINUTE||300);
    if(!Number.isInteger(max)||max<1||max>10000)throw new Error("Invalid auth limit configuration");
    const ipHash=createHmac("sha256",secret).update("auth-ip-v1\0").update(identity).digest("hex");
    await consumeRateLimit(db,`auth-ip-v1:${ipHash}`,max);
  }
  await consumeRateLimit(db,`auth-v1:${path}:${digest}`,limits[path]);
}
