import { z } from "zod";
import type { PrismaClient, Prisma } from "@prisma/client";
import { AccessDenied, authorizeStaff } from "./access";
import { OlympiadError } from "./olympiad-rules";
import { reauthenticateParticipationChief } from "./corrections";
import { assertDemoRegistration } from "./registration-rules";
import { enqueueEmail } from "./outbox";
const fields = { editionId: z.uuid(), editionVenueId: z.uuid().nullable(), title: z.string().trim().min(1).max(200).refine(s => !/[\r\n]/.test(s)), body: z.string().trim().min(1).max(5000), important: z.boolean() };
const saveSchema = z.object({ ...fields, id: z.uuid().optional(), revision: z.int().nonnegative().optional(), password: z.string().min(1).max(128) }).strict();
const publishSchema = z.object({ editionId: z.uuid(), id: z.uuid(), revision: z.int().nonnegative(), confirm: z.literal(true), password: z.string().min(1).max(128) }).strict();
const dto = { id: true, editionId: true, editionVenueId: true, title: true, body: true, important: true, revision: true, publishedAt: true } as const;
async function author(db: PrismaClient | Prisma.TransactionClient, actorId: string, editionId: string, venueId?: string | null) {
  await authorizeStaff(db, actorId, "notifications:send", editionId, venueId ?? undefined);
}
export async function announcementOptions(db: PrismaClient, actorId: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: actorId } });
  if (!user.emailVerified || user.role !== "CHIEF_ORGANIZER") throw new AccessDenied("FORBIDDEN");
  return db.olympiadEdition.findMany({ where: { staffGrants: { some: { userId: actorId, revokedAt: null } } }, orderBy: { year: "desc" }, select: { id: true, year: true, venues: { select: { id: true, label: true, venue: { select: { name: true } } } } } });
}
export async function announcementsView(db: PrismaClient, actorId: string, raw: unknown) {
  const { editionId } = z.object({ editionId: z.uuid() }).strict().parse(raw);
  return db.$transaction(async tx => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: actorId } });
    if (!user.emailVerified) throw new AccessDenied("FORBIDDEN");
    if (user.role === "CHIEF_ORGANIZER") {
      await author(tx, actorId, editionId);
      return tx.announcement.findMany({ where: { editionId }, select: dto, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    }
    if (user.role !== "STUDENT") throw new AccessDenied("FORBIDDEN");
    const participation = await tx.participation.findUnique({ where: { userId_editionId: { userId: actorId, editionId } }, select: { editionVenueId: true } });
    if (!participation) throw new AccessDenied("FORBIDDEN");
    return tx.announcement.findMany({ where: { editionId, publishedAt: { not: null }, OR: [{ editionVenueId: null }, ...(participation.editionVenueId ? [{ editionVenueId: participation.editionVenueId }] : [])] }, select: dto, orderBy: [{ publishedAt: "desc" }, { id: "desc" }] });
  }, { isolationLevel: "RepeatableRead" });
}
export async function saveAnnouncement(db: PrismaClient, actorId: string, raw: unknown) {
  const input = saveSchema.parse(raw);
  await author(db, actorId, input.editionId, input.editionVenueId);
  const actor = await db.user.findUniqueOrThrow({ where: { id: actorId } }); assertDemoRegistration(actor.email);
  await reauthenticateParticipationChief(db, actorId, input.password);
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "OlympiadEdition" WHERE "id" = ${input.editionId}::uuid FOR UPDATE`;
    await author(tx, actorId, input.editionId, input.editionVenueId);
    const data = { editionId: input.editionId, editionVenueId: input.editionVenueId, title: input.title, body: input.body, important: input.important };
    let result;
    if (input.id) {
      const old = await tx.announcement.findFirst({ where: { id: input.id, editionId: input.editionId } });
      if (!old || old.publishedAt || input.revision !== old.revision) throw new OlympiadError("CONFLICT", "Объявление опубликовано или уже изменено");
      result = await tx.announcement.update({ where: { id: old.id }, data: { ...data, revision: { increment: 1 } }, select: dto });
    } else {
      if (input.revision !== undefined) throw new OlympiadError("CONFLICT", "Обновите форму");
      result = await tx.announcement.create({ data: { ...data, authorId: actorId }, select: dto });
    }
    await tx.auditEvent.create({ data: { actorId, action: "ANNOUNCEMENT_SAVED", objectType: "Announcement", objectId: result.id, editionId: input.editionId, outcome: "SUCCESS", details: { revision: result.revision } } });
    return result;
  });
}
export async function publishAnnouncement(db: PrismaClient, actorId: string, raw: unknown) {
  const input = publishSchema.parse(raw);
  await author(db, actorId, input.editionId);
  const actor = await db.user.findUniqueOrThrow({ where: { id: actorId } }); assertDemoRegistration(actor.email);
  await reauthenticateParticipationChief(db, actorId, input.password);
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "OlympiadEdition" WHERE "id" = ${input.editionId}::uuid FOR UPDATE`;
    const old = await tx.announcement.findFirst({ where: { id: input.id, editionId: input.editionId } });
    if (!old) throw new OlympiadError("NOT_FOUND", "Объявление недоступно");
    await author(tx, actorId, input.editionId, old.editionVenueId);
    if (old.publishedAt) return { id: old.id, publishedAt: old.publishedAt }; // retry cannot enqueue twice
    if (old.revision !== input.revision) throw new OlympiadError("CONFLICT", "Черновик уже изменён");
    const result = await tx.announcement.update({ where: { id: old.id }, data: { publishedAt: new Date(), revision: { increment: 1 } } });
    if (old.important) {
      const targets = await tx.participation.findMany({ where: { editionId: old.editionId, ...(old.editionVenueId ? { editionVenueId: old.editionVenueId } : {}) }, select: { id: true } });
      await enqueueEmail(tx, actorId, { kind: "ANNOUNCEMENT", sourceId: old.id, sourceRevision: result.revision, editionId: old.editionId, editionVenueId: old.editionVenueId, subjectTemplate: "Важное объявление СМО", bodyTemplate: "В личном кабинете опубликовано важное объявление олимпиады {{year}}. Откройте раздел «Объявления»." }, targets.map(x => x.id));
    }
    await tx.auditEvent.create({ data: { actorId, action: "ANNOUNCEMENT_PUBLISHED", objectType: "Announcement", objectId: old.id, editionId: old.editionId, outcome: "SUCCESS", details: { revision: result.revision, important: old.important } } });
    return { id: result.id, publishedAt: result.publishedAt };
  });
}
