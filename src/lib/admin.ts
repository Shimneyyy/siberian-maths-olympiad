import { randomUUID, createHash } from "node:crypto";
import { verifyPassword } from "better-auth/crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { AccessDenied } from "./access";
import { OlympiadError } from "./olympiad-rules";
type DB = PrismaClient | Prisma.TransactionClient;
export async function authorizeAdmin(db: DB, actorId: string) {
  const actor = await db.user.findUnique({ where: { id: actorId } });
  if (!actor?.emailVerified || actor.role !== "TECHNICAL_ADMIN") throw new AccessDenied("FORBIDDEN");
}
export class AdminRateLimit extends Error {}
// Rate counters and denied audits commit outside the mutation transaction.
async function reauthenticate(db: PrismaClient, actorId: string, password: string) {
  try {
    await authorizeAdmin(db, actorId);
    const now = BigInt(Date.now()), threshold = now - 60000n, key = `admin-reauth:${actorId}`;
    const [bucket] = await db.$queryRaw<{ count: number }[]>`
      INSERT INTO "RateLimit" ("id", "key", "count", "lastRequest") VALUES (${randomUUID()}::uuid, ${key}, 1, ${now})
      ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimit"."lastRequest" < ${threshold} THEN 1 ELSE "RateLimit"."count" + 1 END,
      "lastRequest" = CASE WHEN "RateLimit"."lastRequest" < ${threshold} THEN ${now} ELSE "RateLimit"."lastRequest" END
      RETURNING "count"`;
    if (bucket.count > 5) throw new AdminRateLimit();
    const account = await db.account.findFirst({ where: { userId: actorId, providerId: "credential" } });
    if (!account?.password || !await verifyPassword({ hash: account.password, password })) throw new AccessDenied("FORBIDDEN");
  } catch (error) {
    await db.auditEvent.create({ data: { actorId, action: "ADMIN_REAUTH_DENIED", objectType: "User", objectId: actorId, outcome: "DENIED" } });
    throw error;
  }
}
const credentials = { password: z.string().min(1).max(128) };
const createEditionSchema = z.object({ id: z.uuid(), year: z.int().min(1).max(9999),
  title: z.string().trim().min(1).max(200), confirmed: z.literal(true), ...credentials }).strict();
export async function createAdminEdition(db: PrismaClient, actorId: string, raw: unknown) {
  const input = createEditionSchema.parse(raw);
  const creationHash=createHash("sha256").update(JSON.stringify([input.year,input.title])).digest("hex");
  await reauthenticate(db, actorId, input.password);
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(4726, 4)`;
    await authorizeAdmin(tx, actorId);
    const old = await tx.olympiadEdition.findUnique({where:{id:input.id}});
    if (old) {
      const ownCreation = await tx.auditEvent.findFirst({where:{actorId, action:"EDITION_CREATED", objectType:"OlympiadEdition", objectId:old.id, editionId:old.id}});
      if (!ownCreation || old.year !== input.year || !z.object({creationHash:z.literal(creationHash)}).safeParse(ownCreation.details).success) throw new OlympiadError("CONFLICT", "Идентификатор создания уже использован. Обновите список выпусков.");
      return {id:old.id, year:old.year};
    }
    if (await tx.olympiadEdition.findUnique({where:{year:input.year}})) throw new OlympiadError("CONFLICT", "Выпуск этого года уже существует. Обновите список выпусков.");
    const edition = await tx.olympiadEdition.create({data:{id:input.id,year:input.year,title:input.title}});
    await tx.auditEvent.create({data:{actorId,action:"EDITION_CREATED",objectType:"OlympiadEdition",objectId:edition.id,editionId:edition.id,outcome:"SUCCESS",details:{year:edition.year,creationHash}}});
    return {id:edition.id,year:edition.year};
  });
}
const scheduleSchema = z.object({ editionId: z.uuid(), revision: z.int().nonnegative(),
  registrationOpensAt: z.iso.datetime({ offset: true }).transform(x => new Date(x)),
  registrationClosesAt: z.iso.datetime({ offset: true }).transform(x => new Date(x)),
  ...credentials,
}).strict().refine(x => x.registrationOpensAt < x.registrationClosesAt);
export async function saveRegistrationWindow(db: PrismaClient, actorId: string, raw: unknown) {
  const input = scheduleSchema.parse(raw);
  await reauthenticate(db, actorId, input.password);
  return db.$transaction(async tx => {
    await authorizeAdmin(tx, actorId);
    await tx.$queryRaw`SELECT "id" FROM "OlympiadEdition" WHERE "id" = ${input.editionId}::uuid FOR UPDATE`;
    const old = await tx.olympiadEdition.findUniqueOrThrow({ where: { id: input.editionId } });
    if (old.revision !== input.revision) throw new OlympiadError("CONFLICT", "Настройки уже изменены. Обновите страницу.");
    const result = await tx.olympiadEdition.update({ where: { id: old.id }, data: {
      registrationOpensAt: input.registrationOpensAt, registrationClosesAt: input.registrationClosesAt,
      registrationManuallyClosed: false, revision: { increment: 1 },
    } });
    const metadata = (e: typeof old) => ({ opensAt: e.registrationOpensAt?.toISOString() ?? null,
      closesAt: e.registrationClosesAt?.toISOString() ?? null, manuallyClosed: e.registrationManuallyClosed, revision: e.revision });
    await tx.auditEvent.create({ data: { actorId, action: "REGISTRATION_WINDOW_UPDATED", objectType: "OlympiadEdition", objectId: old.id, editionId: old.id, outcome: "SUCCESS", details: { before: metadata(old), after: metadata(result) } } });
    return { revision: result.revision };
  });
}
const chiefSchema = z.object({ editionId: z.uuid(), email: z.email().transform(x => x.toLowerCase()),
  name: z.string().trim().min(3).max(200), operation: z.enum(["assign", "replace", "revoke"]), ...credentials }).strict();
async function manageChiefOperation(db: PrismaClient, actorId: string, raw: unknown) {
  const input = chiefSchema.parse(raw);
  await reauthenticate(db, actorId, input.password);
  if (process.env.NODE_ENV === "production" || !input.email.endsWith("@example.test")) throw new AccessDenied("FORBIDDEN");
  return db.$transaction(async tx => {
    await authorizeAdmin(tx, actorId);
    // One global lock for all chief-account/grant operations, including different years.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(4726, 3)`;
    const editions = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "OlympiadEdition" WHERE "id" = ${input.editionId}::uuid FOR UPDATE`;
    if (!editions.length) throw new OlympiadError("NOT_FOUND", "Выпуск не найден");
    let user = await tx.user.findUnique({ where: { email: input.email } });
    if (user && user.role !== "CHIEF_ORGANIZER") throw new AccessDenied("FORBIDDEN");
    if (input.operation === "revoke") {
      if (!user) throw new AccessDenied("FORBIDDEN");
      await tx.editionStaffGrant.updateMany({ where: { userId: user.id, editionId: input.editionId, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.session.deleteMany({ where: { userId: user.id } });
    } else {
      const previous = await tx.editionStaffGrant.findFirst({
        where: { editionId: input.editionId, revokedAt: null, ...(user ? { userId: { not: user.id } } : {}) },
        select: { userId: true },
      });
      if (previous && input.operation === "assign") {
        throw new OlympiadError("CONFLICT", "У этого выпуска уже есть главный организатор. Выберите «Заменить организатора».");
      }
      user ??= await tx.user.create({ data: { email: input.email, name: input.name, role: "CHIEF_ORGANIZER" } });
      if (previous) {
        await tx.editionStaffGrant.update({
          where: { userId_editionId: { userId: previous.userId, editionId: input.editionId } }, data: { revokedAt: new Date() },
        });
        await tx.session.deleteMany({ where: { userId: previous.userId } });
        await tx.auditEvent.create({ data: { actorId, action: "CHIEF_REVOKED", objectType: "User", objectId: previous.userId,
          editionId: input.editionId, outcome: "SUCCESS" } });
      }
      await tx.editionStaffGrant.upsert({ where: { userId_editionId: { userId: user.id, editionId: input.editionId } },
        create: { userId: user.id, editionId: input.editionId }, update: { revokedAt: null } });
      await tx.session.deleteMany({ where: { userId: user.id } });
    }
    await tx.auditEvent.create({ data: { actorId, action: input.operation === "revoke" ? "CHIEF_REVOKED" : "CHIEF_ASSIGNED", objectType: "User", objectId: user.id, editionId: input.editionId, outcome: "SUCCESS" } });
    return { status: "ok" };
  });
}
export async function adminView(db: PrismaClient, actorId: string) {
  await authorizeAdmin(db, actorId);
  return db.olympiadEdition.findMany({ orderBy: { year: "desc" }, select: { id: true, year: true, title: true, revision: true,
    registrationOpensAt: true, registrationClosesAt: true, registrationManuallyClosed: true,
    staffGrants: { where: { revokedAt: null }, select: { user: { select: { email: true, name: true } } } },
  } });
}

export async function manageChief(db: PrismaClient, actorId: string, raw: unknown) {
  try { return await manageChiefOperation(db, actorId, raw); }
  catch (error) {
    if (error instanceof AccessDenied) {
      const scope = z.object({ editionId: z.uuid() }).safeParse(raw);
      await db.auditEvent.create({ data: { actorId, action: "ADMIN_OPERATION_DENIED", objectType: "OlympiadEdition", objectId: scope.success ? scope.data.editionId : actorId, outcome: "DENIED" } });
    }
    throw error;
  }
}
