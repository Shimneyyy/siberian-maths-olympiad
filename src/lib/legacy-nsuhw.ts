import { z } from "zod";
import type { Prisma, PrismaClient } from "@prisma/client";
import { AccessDenied, authorizeStaff } from "./access";
import { assertDemoRegistration } from "./registration-rules";
import { legacyNsuhwLogin } from "./legacy-nsuhw-rules";
import { OlympiadError } from "./olympiad-rules";
import { reauthenticateParticipationChief } from "./corrections";
type DB = PrismaClient | Prisma.TransactionClient;
const ownSelect = { id: true, login: true, revision: true, approvedAt: true } as const;
export async function legacyNsuhwView(db: DB, actorId: string) {
  const user = await db.user.findUnique({where:{id:actorId}});
  if (!user?.emailVerified || user.role !== "STUDENT") throw new AccessDenied("FORBIDDEN");
  return db.legacyNsuhwClaim.findUnique({where:{userId:actorId},select:ownSelect});
}
// For future generation paths: a pending OR confirmed old account prohibits replacement.
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
  const existing = await tx.legacyNsuhwClaim.findUnique({where:{userId},select:ownSelect});
  if(existing) {
    if(existing.login !== login) throw new OlympiadError("CONFLICT","Заявка уже существует. Обратитесь к главному организатору для сверки");
    return existing;
  }
  const claim = await tx.legacyNsuhwClaim.create({data:{userId,login},select:ownSelect});
  await tx.auditEvent.create({data:{actorId:userId,action:"NSUHW_LEGACY_CLAIM_SUBMITTED",objectType:"LegacyNsuhwClaim",objectId:claim.id,outcome:"SUCCESS"}});
  return claim;
}
export async function submitLegacyNsuhw(db: PrismaClient, actorId: string, raw: unknown) {
  const input = z.object({login:legacyNsuhwLogin,confirmed:z.literal(true)}).strict().parse(raw);
  await legacyNsuhwView(db,actorId);
  return db.$transaction(tx => submitLegacyNsuhwInTransaction(tx,actorId,input.login));
}
export async function legacyNsuhwReviewList(db: PrismaClient, actorId: string, raw: unknown) {
  const {editionId} = z.object({editionId:z.uuid()}).strict().parse(raw);
  return db.$transaction(async tx => {
    await authorizeStaff(tx,actorId,"registrations:edit",editionId);
    const rows = await tx.legacyNsuhwClaim.findMany({where:{user:{emailVerified:true,role:"STUDENT",participations:{some:{editionId}}}},orderBy:[{createdAt:"asc"},{id:"asc"}],select:{...ownSelect,userId:true,user:{select:{participations:{where:{editionId},select:{id:true,fullName:true}}}}}});
    return rows.map(x=>({id:x.id,userId:x.userId,login:x.login,revision:x.revision,approvedAt:x.approvedAt,participationId:x.user.participations[0].id,fullName:x.user.participations[0].fullName}));
  },{isolationLevel:"RepeatableRead"});
}
export async function approveLegacyNsuhw(db: PrismaClient, actorId: string, raw: unknown) {
  const input = z.object({editionId:z.uuid(),claimId:z.uuid(),revision:z.int().nonnegative(),password:z.string().min(1).max(128),confirmed:z.literal(true),ownershipChecked:z.literal(true)}).strict().parse(raw);
  await authorizeStaff(db,actorId,"registrations:edit",input.editionId);
  assertDemoRegistration((await db.user.findUniqueOrThrow({where:{id:actorId}})).email);
  await reauthenticateParticipationChief(db,actorId,input.password);
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "OlympiadEdition" WHERE "id" = ${input.editionId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "LegacyNsuhwClaim" WHERE "id" = ${input.claimId}::uuid FOR UPDATE`;
    await authorizeStaff(tx,actorId,"registrations:edit",input.editionId);
    const claim = await tx.legacyNsuhwClaim.findFirst({where:{id:input.claimId,user:{role:"STUDENT",emailVerified:true,participations:{some:{editionId:input.editionId}}}}});
    if(!claim) throw new AccessDenied("FORBIDDEN");
    if(claim.approvedAt) return {id:claim.id,approvedAt:claim.approvedAt};
    if(claim.revision !== input.revision) throw new OlympiadError("CONFLICT","Заявка уже изменилась. Обновите список");
    const updated = await tx.legacyNsuhwClaim.update({where:{id:claim.id},data:{approvedAt:new Date(),approvedById:actorId,approvedEditionId:input.editionId,revision:{increment:1}},select:{id:true,approvedAt:true}});
    await tx.auditEvent.create({data:{actorId,action:"NSUHW_LEGACY_LINK_CONFIRMED",objectType:"LegacyNsuhwClaim",objectId:claim.id,editionId:input.editionId,outcome:"SUCCESS",details:{userId:claim.userId,ownershipChecked:true}}});
    return updated;
  });
}
