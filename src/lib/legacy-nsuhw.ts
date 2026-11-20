import { lockNsuhwNamespace } from "./nsuhw-namespace";
import { z } from "zod";
import type { Prisma, PrismaClient } from "@prisma/client";
import { AccessDenied } from "./access";
import { assertDemoRegistration } from "./registration-rules";
import { legacyNsuhwLogin } from "./legacy-nsuhw-rules";
import { OlympiadError } from "./olympiad-rules";
type DB = PrismaClient | Prisma.TransactionClient;
const ownSelect = { id: true, login: true, revision: true } as const;
export async function legacyNsuhwView(db: DB, actorId: string) {
  const user = await db.user.findUnique({where:{id:actorId}});
  if (!user?.emailVerified || user.role !== "STUDENT") throw new AccessDenied("FORBIDDEN");
  return db.legacyNsuhwClaim.findUnique({where:{userId:actorId},select:ownSelect});
}
// A self-reported old login prevents generating a replacement account.
export async function assertNoLegacyNsuhwClaim(db: DB, userId: string) {
  if (await db.legacyNsuhwClaim.findUnique({where:{userId},select:{id:true}})) throw new OlympiadError("CONFLICT","Для участника заявлен старый аккаунт nsuhw; новые данные не генерируются");
}
// Only called in the signup transaction; a declaration is not proof of ownership.
export async function submitLegacyNsuhwInTransaction(tx: Prisma.TransactionClient, userId: string, raw: string) {
  const login = legacyNsuhwLogin.parse(raw);
  const user = await tx.user.findUniqueOrThrow({where:{id:userId}});
  if(user.role !== "STUDENT") throw new AccessDenied("FORBIDDEN");
  assertDemoRegistration(user.email);
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId}::uuid FOR UPDATE`;
  await lockNsuhwNamespace(tx);
  if(await tx.preparedExternalAccount.findUnique({where:{userId},select:{id:true}}))throw new OlympiadError("CONFLICT","Новые данные nsuhw уже подготовлены; заменить их старым логином нельзя");
  const existing = await tx.legacyNsuhwClaim.findUnique({where:{userId},select:ownSelect});
  if(existing) {
    if(existing.login !== login) throw new OlympiadError("CONFLICT","Старый логин уже сохранён; повтор не меняет существующий логин");
    return existing;
  }
  const claim = await tx.legacyNsuhwClaim.create({data:{userId,login},select:ownSelect});
  await tx.auditEvent.create({data:{actorId:userId,action:"NSUHW_LEGACY_LOGIN_SAVED",objectType:"LegacyNsuhwClaim",objectId:claim.id,outcome:"SUCCESS"}});
  return claim;
}
export async function submitLegacyNsuhw(db: PrismaClient, actorId: string, raw: unknown) {
  const input = z.object({login:legacyNsuhwLogin}).strict().parse(raw);
  await legacyNsuhwView(db,actorId);
  return db.$transaction(tx => submitLegacyNsuhwInTransaction(tx,actorId,input.login));
}
