import { lockNsuhwNamespace } from "../nsuhw-namespace";
import { stat } from "node:fs/promises";
import { demoKeyringPath,initializeDemoKeyring,ExternalKeyConfigurationError } from "./local-keys";
import { randomUUID } from "node:crypto";
import type { Prisma,PrismaClient,PreparedExternalAccount } from "@prisma/client";
import { legacyNsuhwLogin } from "../legacy-nsuhw-rules";
import { assertDemoRegistration } from "../registration-rules";
import { assertNoLegacyNsuhwClaim } from "../legacy-nsuhw";
import { AccessDenied } from "../access";
import { OlympiadError } from "../olympiad-rules";
import { sealExternalPassword,rewrapExternalPassword,type SecretContext,type KeyProtector,ExternalSecretError } from "./envelope";
export function externalSecretContext(account:Pick<PreparedExternalAccount,"id"|"userId"|"login"|"credentialVersion">):SecretContext{return {accountId:account.id,userId:account.userId,login:account.login,credentialVersion:account.credentialVersion};}
// Internal storage primitive, not a permission to export/reveal or create on nsuhw.
// Future generation calls this in the same transaction after reserving a unique login.
export async function storePreparedExternalAccount(tx:Prisma.TransactionClient,userId:string,login:string,password:string,protector:KeyProtector){
 const checkedLogin=legacyNsuhwLogin.parse(login);
 await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId}::uuid FOR UPDATE`;
 const user=await tx.user.findUniqueOrThrow({where:{id:userId}});
 if(user.role!=="STUDENT")throw new AccessDenied("FORBIDDEN");assertDemoRegistration(user.email);
 await assertNoLegacyNsuhwClaim(tx,userId);
 await lockNsuhwNamespace(tx);
 if(await tx.legacyNsuhwClaim.findFirst({where:{login:{equals:checkedLogin,mode:"insensitive"}},select:{id:true}}))throw new OlympiadError("CONFLICT","Логин указан в заявке на старый аккаунт; выберите другой кандидат");
 const data={id:randomUUID(),userId,login:checkedLogin,credentialVersion:1};
 const secretEnvelope=await sealExternalPassword(password,externalSecretContext(data),protector);
 const account=await tx.preparedExternalAccount.create({data:{...data,keyVersion:secretEnvelope.keyVersion,secretEnvelope},select:{id:true,login:true,revision:true}});
 await tx.auditEvent.create({data:{actorId:userId,action:"EXTERNAL_SECRET_PREPARED",objectType:"PreparedExternalAccount",objectId:account.id,outcome:"SUCCESS"}});
 return account;
}
// Local operator task only. Row-by-row rotation is resumable; no plaintext is returned.
export async function rewrapPreparedExternalAccounts(db:PrismaClient,protector:KeyProtector){
 if(process.env.NODE_ENV==="production"||process.env.DEMO_REGISTRATION!=="true")throw new AccessDenied("FORBIDDEN");
 let count=0;
 for(;;){
  const rows=await db.preparedExternalAccount.findMany({where:{keyVersion:{not:protector.activeVersion}},select:{id:true,userId:true},take:100,orderBy:{id:"asc"}});
  if(!rows.length)return {count};
  for(const item of rows){
   const changed=await db.$transaction(async tx=>{
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${item.userId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "PreparedExternalAccount" WHERE "id" = ${item.id}::uuid FOR UPDATE`;
    const row=await tx.preparedExternalAccount.findUnique({where:{id:item.id}});if(!row||row.keyVersion===protector.activeVersion)return false;
    const owner=await tx.user.findUniqueOrThrow({where:{id:row.userId}});assertDemoRegistration(owner.email);
    const source=row.secretEnvelope as unknown as {keyVersion?:unknown};if(source?.keyVersion!==row.keyVersion)throw new ExternalSecretError();
    const secretEnvelope=await rewrapExternalPassword(row.secretEnvelope,externalSecretContext(row),protector);
    const updated=await tx.preparedExternalAccount.updateMany({where:{id:row.id,revision:row.revision},data:{keyVersion:secretEnvelope.keyVersion,secretEnvelope,revision:{increment:1}}});
    if(updated.count!==1)throw new OlympiadError("CONFLICT","Повторите ротацию ключей");
    await tx.auditEvent.create({data:{action:"EXTERNAL_KEY_REWRAPPED",objectType:"PreparedExternalAccount",objectId:row.id,outcome:"SUCCESS",details:{fromVersion:row.keyVersion,toVersion:secretEnvelope.keyVersion,credentialVersion:row.credentialVersion}}});
    return true;
   });if(changed)count++;
  }
 }
}

// Lost keys must be restored, not replaced under the same version label.
export async function initializeDemoKeyringForDatabase(db:PrismaClient){
 if(process.env.NODE_ENV==="production"||process.env.DEMO_REGISTRATION!=="true")throw new ExternalKeyConfigurationError();
 try{await stat(demoKeyringPath());return initializeDemoKeyring();}catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw new ExternalKeyConfigurationError();}
 return db.$transaction(async tx=>{
  await lockNsuhwNamespace(tx);
  if(await tx.preparedExternalAccount.count())throw new ExternalKeyConfigurationError();
  return initializeDemoKeyring();
 });
}
