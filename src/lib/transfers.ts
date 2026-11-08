import { z } from "zod";
import type { PrismaClient, Prisma } from "@prisma/client";
import { authorizeStaff, AccessDenied } from "./access";
import { reauthenticateParticipationChief } from "./corrections";
import { assertDemoRegistration } from "./registration-rules";
import { OlympiadError } from "./olympiad-rules";
import { enqueueEmail } from "./outbox";
const schema = z.object({ editionId: z.uuid(), participationId: z.uuid(), editionVenueId: z.uuid(), revision: z.int().nonnegative(),
  reason: z.string().trim().min(1).max(1000), password: z.string().min(1).max(128), confirmed: z.literal(true) }).strict();
async function transferable(db: PrismaClient | Prisma.TransactionClient, actorId: string, editionId: string, participationId: string) {
  await authorizeStaff(db, actorId, "registrations:edit", editionId);
  const p = await db.participation.findFirst({ where: { id: participationId, editionId } });
  if (!p || p.status !== "REGISTERED" || p.format !== "ONSITE") throw new AccessDenied("FORBIDDEN");
  return p;
}
export async function transferView(db: PrismaClient, actorId: string, editionId: string, participationId: string) {
  const p = await transferable(db, actorId, editionId, participationId);
  const venues = await db.editionVenue.findMany({ where: { editionId, active: true, id: { not: p.editionVenueId! } }, select: { id: true, label: true, venue: { select: { name: true } } }, orderBy: { id: "asc" } });
  return { editionId, participationId, fullName: p.fullName, revision: p.revision, venues: venues.map(v => ({ id: v.id, name: v.label || v.venue.name })) };
}
export async function transferParticipation(db: PrismaClient, actorId: string, raw: unknown) {
  const input = schema.parse(raw);
  await transferable(db, actorId, input.editionId, input.participationId);
  assertDemoRegistration((await db.user.findUniqueOrThrow({ where: { id: actorId } })).email);
  await reauthenticateParticipationChief(db, actorId, input.password);
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "OlympiadEdition" WHERE "id" = ${input.editionId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "Participation" WHERE "id" = ${input.participationId}::uuid FOR UPDATE`;
    const p = await transferable(tx, actorId, input.editionId, input.participationId);
    if (p.revision !== input.revision) throw new OlympiadError("CONFLICT", "Заявка уже изменена. Обновите страницу.");
    const target = await tx.editionVenue.findFirst({ where: { id: input.editionVenueId, editionId: input.editionId, active: true } });
    if (!target || target.id === p.editionVenueId) throw new OlympiadError("INVALID_VENUE", "Выберите другую действующую очную площадку этого года");
    const result = await tx.participation.update({ where: { id: p.id }, data: { editionVenueId: target.id, revision: { increment: 1 } } });
    const correction = await tx.participationCorrection.create({ data: { participationId: p.id, actorId, reason: input.reason } });
    await enqueueEmail(tx, actorId, { kind: "TRANSFER", sourceId: correction.id, sourceRevision: result.revision, editionId: p.editionId, editionVenueId: null, subjectTemplate: "Изменение площадки СМО {{year}}", bodyTemplate: "Ваша очная площадка изменена: {{venue}}. Подробности доступны в личном кабинете." }, [p.id]);
    await tx.auditEvent.create({ data: { actorId, action: "PARTICIPATION_TRANSFERRED", objectType: "Participation", objectId: p.id, editionId: p.editionId, outcome: "SUCCESS", details: { fromVenueId: p.editionVenueId, toVenueId: target.id, correctionId: correction.id, revision: result.revision } } });
    return { revision: result.revision };
  });
}
