import { randomUUID } from "node:crypto";
import { verifyPassword } from "better-auth/crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { AccessDenied, authorizeStaff } from "./access";
import { AdminRateLimit } from "./admin";
import { assertDemoRegistration } from "./registration-rules";
import { OlympiadError } from "./olympiad-rules";
const fields = { fullName: z.string().trim().min(3).max(200), universityId: z.uuid(), courseId: z.uuid(), revision: z.int().nonnegative() };
const profileSchema = z.object(fields).strict();
const editSchema = z.object({ ...fields, editionId: z.uuid(), participationId: z.uuid(), reason: z.string().trim().max(1000).optional(), password: z.string().min(1).max(128).optional() }).strict();
type Tx = Prisma.TransactionClient;
async function student(db: PrismaClient | Tx, actorId: string) {
  const user = await db.user.findUnique({ where: { id: actorId } });
  if (!user?.emailVerified || user.role !== "STUDENT") throw new AccessDenied("FORBIDDEN");
  return user;
}
async function catalogs(tx: PrismaClient | Tx, universityId: string, courseId: string) {
  const universities = await tx.university.findMany({ where: { OR: [{ active: true }, { id: universityId }] }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  const courses = await tx.courseOption.findMany({ where: { OR: [{ active: true }, { id: courseId }] }, select: { id: true, label: true }, orderBy: { label: "asc" } });
  return { universities, courses };
}
async function references(tx: Tx, input: { universityId: string; courseId: string }, previous: { universityId: string; courseId: string }) {
  const university = await tx.university.findFirst({ where: { id: input.universityId, ...(input.universityId === previous.universityId ? {} : { active: true }) } });
  const course = await tx.courseOption.findFirst({ where: { id: input.courseId, ...(input.courseId === previous.courseId ? {} : { active: true }) } });
  if (!university || !course) throw new OlympiadError("PROFILE_REQUIRED", "Выберите доступный вуз и курс");
  return { university, course };
}
export async function profileView(db: PrismaClient, actorId: string) {
  await student(db, actorId);
  const profile = await db.studentProfile.findUnique({ where: { userId: actorId } });
  if (!profile) throw new OlympiadError("PROFILE_REQUIRED", "Необходимо заполнить профиль");
  return { fullName: profile.fullName, universityId: profile.universityId, courseId: profile.courseId, revision: profile.revision, ...await catalogs(db, profile.universityId, profile.courseId) };
}
export async function saveProfile(db: PrismaClient, actorId: string, raw: unknown) {
  const input = profileSchema.parse(raw);
  return db.$transaction(async tx => {
    const actor = await student(tx, actorId); assertDemoRegistration(actor.email);
    await tx.$queryRaw`SELECT "userId" FROM "StudentProfile" WHERE "userId" = ${actorId}::uuid FOR UPDATE`;
    const old = await tx.studentProfile.findUniqueOrThrow({ where: { userId: actorId } });
    if (old.revision !== input.revision) throw new OlympiadError("CONFLICT", "Профиль уже изменён. Обновите страницу.");
    await references(tx, input, old);
    await tx.studentProfile.update({ where: { userId: actorId }, data: { ...input, revision: { increment: 1 } } });
    await tx.user.update({ where: { id: actorId }, data: { name: input.fullName } });
    await tx.auditEvent.create({ data: { actorId, action: "PROFILE_UPDATED", objectType: "User", objectId: actorId, outcome: "SUCCESS", details: { revision: old.revision + 1 } } });
    return { status: "ok" };
  });
}
async function editable(tx: PrismaClient | Tx, actorId: string, editionId: string, participationId: string, now: Date) {
  const actor = await tx.user.findUnique({ where: { id: actorId } });
  if (!actor?.emailVerified) throw new AccessDenied("FORBIDDEN");
  const p = await tx.participation.findFirst({ where: { id: participationId, editionId }, include: { edition: true, user: { select: { email: true } } } });
  if (!p || p.status !== "REGISTERED") throw new AccessDenied("FORBIDDEN");
  const closed = p.edition.registrationManuallyClosed || (!!p.edition.registrationClosesAt && now >= p.edition.registrationClosesAt);
  if (actor.role === "STUDENT") {
    if (p.userId !== actorId || closed || !p.edition.registrationClosesAt) throw new AccessDenied("FORBIDDEN");
  } else if (actor.role === "CHIEF_ORGANIZER" && closed) {
    await authorizeStaff(tx, actorId, "registrations:edit", editionId);
  } else throw new AccessDenied("FORBIDDEN");
  return { p, actor };
}
export async function correctionView(db: PrismaClient, actorId: string, editionId: string, participationId: string) {
  z.uuid().parse(editionId); z.uuid().parse(participationId);
  const { p, actor } = await editable(db, actorId, editionId, participationId, new Date());
  return { fullName: p.fullName, universityId: p.universityId, courseId: p.courseId, revision: p.revision,
    editionId, participationId, chief: actor.role === "CHIEF_ORGANIZER", ...await catalogs(db, p.universityId, p.courseId) };
}
async function chiefReauthentication(db: PrismaClient, actorId: string, password: string) {
  const key = `correction-reauth:${actorId}`, now = BigInt(Date.now()), threshold = now - 60000n;
  const [bucket] = await db.$queryRaw<{ count: number }[]>`INSERT INTO "RateLimit" ("id","key","count","lastRequest") VALUES (${randomUUID()}::uuid,${key},1,${now})
    ON CONFLICT ("key") DO UPDATE SET "count" = CASE WHEN "RateLimit"."lastRequest" < ${threshold} THEN 1 ELSE "RateLimit"."count" + 1 END,
    "lastRequest" = CASE WHEN "RateLimit"."lastRequest" < ${threshold} THEN ${now} ELSE "RateLimit"."lastRequest" END RETURNING "count"`;
  if (bucket.count > 5) throw new AdminRateLimit();
  const account = await db.account.findFirst({ where: { userId: actorId, providerId: "credential" } });
  if (!account?.password || !await verifyPassword({ hash: account.password, password })) {
    await db.auditEvent.create({ data: { actorId, action: "CORRECTION_REAUTH_DENIED", objectType: "User", objectId: actorId, outcome: "DENIED" } });
    throw new AccessDenied("FORBIDDEN");
  }
}
export async function correctParticipation(db: PrismaClient, actorId: string, raw: unknown, clock: () => Date = () => new Date()) {
  const input = editSchema.parse(raw);
  const { actor } = await editable(db, actorId, input.editionId, input.participationId, clock());
  if (actor.role === "CHIEF_ORGANIZER") {
    if (!input.reason || !input.password) throw new AccessDenied("FORBIDDEN");
    await chiefReauthentication(db, actorId, input.password);
  } else if (input.reason || input.password) throw new AccessDenied("FORBIDDEN");
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "OlympiadEdition" WHERE "id" = ${input.editionId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "Participation" WHERE "id" = ${input.participationId}::uuid FOR UPDATE`;
    const { p, actor } = await editable(tx, actorId, input.editionId, input.participationId, clock());
    assertDemoRegistration(p.user.email);
    if (p.revision !== input.revision) throw new OlympiadError("CONFLICT", "Регистрация уже изменена. Обновите страницу.");
    if (input.universityId !== p.universityId && await tx.teamMember.findUnique({ where: { participationId: p.id } })) throw new OlympiadError("CONFLICT", "Сначала выйдите из команды, затем меняйте вуз в заявке");
    const { university, course } = await references(tx, input, p);
    await tx.participation.update({ where: { id: p.id }, data: { fullName: input.fullName, universityId: input.universityId, courseId: input.courseId,
      ...(input.universityId !== p.universityId ? { universityName: university.name, universityAbbreviation: university.abbreviation } : {}),
      ...(input.courseId !== p.courseId ? { courseLabel: course.label } : {}), revision: { increment: 1 } } });
    // Own correction also updates the current profile; an organizer's historical correction does not.
    if (actor.role === "STUDENT") {
      await tx.studentProfile.update({ where: { userId: actorId }, data: { fullName: input.fullName, universityId: input.universityId, courseId: input.courseId, revision: { increment: 1 } } });
      await tx.user.update({ where: { id: actorId }, data: { name: input.fullName } });
    }
    const correction = input.reason ? await tx.participationCorrection.create({ data: { participationId: p.id, actorId, reason: input.reason } }) : null;
    await tx.auditEvent.create({ data: { actorId, action: "PARTICIPATION_CORRECTED", objectType: "Participation", objectId: p.id, editionId: p.editionId, outcome: "SUCCESS", details: { revision: p.revision + 1, ...(correction ? { correctionId: correction.id } : {}) } } });
    return { status: "ok" };
  });
}
