import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { authorizeStaff } from "./access";
import { assertDemoRegistration } from "./registration-rules";
import { reauthenticateParticipationChief } from "./corrections";
import { OlympiadError } from "./olympiad-rules";
import { validateMailTemplate } from "./mail-template";
import { enqueueEmail } from "./outbox";
const schema = z.object({ id: z.uuid(), editionId: z.uuid(), editionVenueId: z.uuid().nullable(),
  subjectTemplate: z.string().trim().min(1).max(200).refine(s => !/[\r\n]/.test(s)), bodyTemplate: z.string().trim().min(1).max(5000),
  repeatOf: z.uuid().nullable().default(null), confirm: z.literal(true), confirmRepeat: z.boolean().default(false), password: z.string().min(1).max(128) }).strict();
export async function mailBatchesView(db: PrismaClient, actorId: string, raw: unknown) {
  const { editionId } = z.object({ editionId: z.uuid() }).strict().parse(raw);
  await authorizeStaff(db, actorId, "notifications:send", editionId);
  return db.mailBatch.findMany({ where: { editionId }, orderBy: [{ publishedAt: "desc" }, { id: "desc" }], select: { id: true, editionId: true, editionVenueId: true, subjectTemplate: true, bodyTemplate: true, repeatOf: true, publishedAt: true } });
}
export async function sendMailBatch(db: PrismaClient, actorId: string, raw: unknown) {
  const input = schema.parse(raw);
  validateMailTemplate(input.subjectTemplate); validateMailTemplate(input.bodyTemplate);
  if (input.repeatOf && !input.confirmRepeat) throw new OlympiadError("CONFLICT", "Отдельно подтвердите повторную отправку актуальной аудитории");
  await authorizeStaff(db, actorId, "notifications:send", input.editionId, input.editionVenueId ?? undefined);
  assertDemoRegistration((await db.user.findUniqueOrThrow({ where: { id: actorId } })).email);
  await reauthenticateParticipationChief(db, actorId, input.password);
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "OlympiadEdition" WHERE "id" = ${input.editionId}::uuid FOR UPDATE`;
    await authorizeStaff(tx, actorId, "notifications:send", input.editionId, input.editionVenueId ?? undefined);
    const data = { editionId: input.editionId, editionVenueId: input.editionVenueId, subjectTemplate: input.subjectTemplate, bodyTemplate: input.bodyTemplate, repeatOf: input.repeatOf };
    const existing = await tx.mailBatch.findUnique({ where: { id: input.id } });
    if (existing) {
      if (existing.actorId !== actorId || Object.entries(data).some(([key,value]) => existing[key as keyof typeof existing] !== value)) throw new OlympiadError("CONFLICT", "Идентификатор уже использован другой рассылкой");
      const event = await tx.outboxEvent.findUniqueOrThrow({ where: { kind_sourceId_sourceRevision: { kind: "MAIL_BATCH", sourceId: input.id, sourceRevision: 0 } } });
      return { id: input.id, count: await tx.outboxJob.count({ where: { eventId: event.id } }) };
    }
    if (input.repeatOf) {
      const previous = await tx.mailBatch.findFirst({ where: { id: input.repeatOf, ...{ editionId: data.editionId, editionVenueId: data.editionVenueId, subjectTemplate: data.subjectTemplate, bodyTemplate: data.bodyTemplate } } });
      if (!previous) throw new OlympiadError("CONFLICT", "Повтор должен сохранять шаблон и область исходной рассылки");
    }
    await tx.mailBatch.create({ data: { id: input.id, ...data, actorId } });
    const targets = await tx.participation.findMany({ where: { editionId: data.editionId, ...(data.editionVenueId ? { editionVenueId: data.editionVenueId } : {}) }, select: { id: true } });
    const event = await enqueueEmail(tx, actorId, { kind: "MAIL_BATCH", sourceId: input.id, sourceRevision: 0, editionId: data.editionId, editionVenueId: data.editionVenueId, subjectTemplate: data.subjectTemplate, bodyTemplate: data.bodyTemplate }, targets.map(x => x.id));
    await tx.auditEvent.create({ data: { actorId, action: input.repeatOf ? "MAIL_BATCH_REPEATED" : "MAIL_BATCH_CREATED", objectType: "MailBatch", objectId: input.id, editionId: data.editionId, outcome: "SUCCESS", details: { count: event.count, repeatOf: input.repeatOf } } });
    return { id: input.id, count: event.count };
  });
}
