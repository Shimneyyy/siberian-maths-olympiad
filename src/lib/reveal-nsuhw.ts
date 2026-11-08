import type { PrismaClient } from "@prisma/client";
import { authorizeNsuhwSecretRead } from "./nsuhw-secret-auth";
import { AccessDenied } from "./access";
import { assertNoLegacyNsuhwClaim } from "./legacy-nsuhw";
import { OlympiadError } from "./olympiad-rules";
import { openExternalPassword,ExternalSecretError,type KeyProtector } from "./external-secrets/envelope";
import { loadDemoKeyProtector } from "./external-secrets/local-keys";
import { externalSecretContext } from "./external-secrets/storage";
// Repeated disclosure is permitted, but each call requires fresh password proof.
export async function revealNsuhwSecret(db:PrismaClient,actorId:string,raw:unknown,protector?:KeyProtector){
 await authorizeNsuhwSecretRead(db,actorId,raw);
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${actorId}::uuid FOR UPDATE`;
  const user=await tx.user.findUniqueOrThrow({where:{id:actorId}});if(!user.emailVerified||user.role!=="STUDENT")throw new AccessDenied("FORBIDDEN");
  await assertNoLegacyNsuhwClaim(tx,actorId);
  const account=await tx.preparedExternalAccount.findUnique({where:{userId:actorId}});
  if(!account?.confirmedAt)throw new OlympiadError("CONFLICT","Создание аккаунта nsuhw ещё не подтверждено главным организатором");
  if((account.secretEnvelope as {keyVersion?:unknown})?.keyVersion!==account.keyVersion)throw new ExternalSecretError();
  const password=await openExternalPassword(account.secretEnvelope,externalSecretContext(account),protector??await loadDemoKeyProtector());
  await tx.auditEvent.create({data:{actorId,action:"NSUHW_SECRET_REVEALED",objectType:"PreparedExternalAccount",objectId:account.id,outcome:"SUCCESS",details:{credentialVersion:account.credentialVersion}}});
  return {login:account.login,password};
 });
}
