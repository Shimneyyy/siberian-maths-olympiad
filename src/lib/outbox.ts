import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Prisma, PrismaClient, OutboxJobStatus } from "@prisma/client";
import { AccessDenied, authorizeStaff } from "./access";
import { OlympiadError } from "./olympiad-rules";
import { assertDemoRegistration } from "./registration-rules";
import { validateMailTemplate, renderMailTemplate } from "./mail-template";
const eventSchema = z.object({ kind: z.enum(["ANNOUNCEMENT", "MAIL_BATCH", "TRANSFER", "EXTERNAL_ACCOUNT_READY", "RESULTS_PUBLISHED"]), sourceId: z.uuid(), sourceRevision: z.int().nonnegative(),
  editionId: z.uuid(), editionVenueId: z.uuid().nullable().default(null), subjectTemplate: z.string().min(1).max(200).refine(s => !/[\r\n]/.test(s)), bodyTemplate: z.string().min(1).max(5000) }).strict();
// Called inside the domain transaction. actorId comes from the server session; targets from an authorized query.
export async function enqueueEmail(tx: Prisma.TransactionClient, actorId: string, raw: unknown, participationIds: string[]) {
  const input = eventSchema.parse(raw);
  const ids = [...new Set(z.array(z.uuid()).max(10000).parse(participationIds))];
  validateMailTemplate(input.subjectTemplate); validateMailTemplate(input.bodyTemplate);
  await authorizeStaff(tx, actorId, "notifications:send", input.editionId, input.editionVenueId ?? undefined);
  const author = await tx.user.findUniqueOrThrow({ where: { id: actorId }, select: { email: true } });
  assertDemoRegistration(author.email);
  const existing = await tx.outboxEvent.findUnique({ where: { kind_sourceId_sourceRevision: { kind: input.kind, sourceId: input.sourceId, sourceRevision: input.sourceRevision } } });
  if (existing) {
    if (existing.editionId !== input.editionId || existing.editionVenueId !== input.editionVenueId || existing.subjectTemplate !== input.subjectTemplate || existing.bodyTemplate !== input.bodyTemplate) throw new OlympiadError("CONFLICT", "Источник уведомления уже изменён");
    return { eventId: existing.id, count: await tx.outboxJob.count({ where: { eventId: existing.id } }) };
  }
  const count = await tx.participation.count({ where: { id: { in: ids }, editionId: input.editionId, ...(input.editionVenueId ? { editionVenueId: input.editionVenueId } : {}) } });
  if (count !== ids.length) throw new AccessDenied("FORBIDDEN");
  const event = await tx.outboxEvent.create({ data: { ...input, actorId } });
  for (let offset=0; offset<ids.length; offset+=500) await tx.outboxJob.createMany({ data: ids.slice(offset,offset+500).map(participationId => ({ eventId: event.id, editionId: input.editionId, participationId })) });
  return { eventId: event.id, count };
}
export const OUTBOX_MAX_ATTEMPTS = 5;
export const OUTBOX_LEASE_MS = 90000;
export async function claimEmail(db: PrismaClient, now = new Date()) {
  return db.$transaction(async tx => {
    await tx.outboxJob.updateMany({ where: { status: "PROCESSING", leaseUntil: { lt: now }, attempts: { gte: OUTBOX_MAX_ATTEMPTS } },
      data: { status: "FAILED", lastErrorCode: "LEASE_EXHAUSTED", leaseUntil: null, leaseToken: null } });
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "OutboxJob" WHERE "attempts" < ${OUTBOX_MAX_ATTEMPTS}
      AND (("status" = 'READY' AND "availableAt" <= ${now}) OR ("status" = 'PROCESSING' AND "leaseUntil" < ${now}))
      ORDER BY "availableAt", "id" FOR UPDATE SKIP LOCKED LIMIT 1`;
    if (!rows.length) return null;
    return tx.outboxJob.update({ where: { id: rows[0].id }, data: { status: "PROCESSING", attempts: { increment: 1 }, leaseUntil: new Date(now.getTime()+OUTBOX_LEASE_MS), leaseToken: randomUUID() }, select: { id: true, attempts: true, leaseToken: true, leaseUntil: true } });
  });
}
type Claim = NonNullable<Awaited<ReturnType<typeof claimEmail>>>;
type Completion = { status: Exclude<OutboxJobStatus,"PROCESSING">; availableAt?: Date; lastErrorCode?: string | null; providerMessageId?: string };
export async function settleEmail(db: PrismaClient, claim: Claim, data: Completion) {
  const result = await db.outboxJob.updateMany({ where: { id: claim.id, status: "PROCESSING", leaseToken: claim.leaseToken }, data: { ...data, leaseUntil: null, leaseToken: null } });
  return result.count === 1;
}
export type QueuedMail = { to: string; subject: string; text: string; messageId: string };
export async function processEmail(db: PrismaClient, send: (mail: QueuedMail) => Promise<{ messageId?: string }>, clock: () => Date = () => new Date()) {
  if (process.env.DEMO_REGISTRATION !== "true" || process.env.NODE_ENV === "production") throw new Error("MAIL_WORKER_DEMO_CONFIGURATION_REQUIRED");
  const claim = await claimEmail(db, clock());
  if (!claim) return "EMPTY" as const;
  const job = await db.outboxJob.findUniqueOrThrow({ where: { id: claim.id }, include: { event: true, participation: { select: {
    editionVenueId: true, fullName: true, universityName: true, format: true, remoteZone: true,
    user: { select: { email: true, emailVerified: true } }, edition: { select: { year: true } },
    teamMembership: { select: { team: { select: { name: true } } } }, editionVenue: { select: { label: true, venue: { select: { name: true } } } },
  } } } });
  if (job.leaseToken !== claim.leaseToken || !job.leaseUntil || job.leaseUntil <= clock()) return "STALE" as const;
  const finish = async (data: Completion) => await settleEmail(db, claim, data) ? data.status : "STALE" as const;
  try { await authorizeStaff(db, job.event.actorId, "notifications:send", job.editionId, job.event.editionVenueId ?? undefined); }
  catch (error) { if (error instanceof AccessDenied) return finish({ status: "CANCELLED", lastErrorCode: "ACCESS_REVOKED" }); throw error; }
  const p = job.participation;
  if (!p.user.emailVerified || !z.email().safeParse(p.user.email).success) return finish({ status: "CANCELLED", lastErrorCode: "RECIPIENT_NOT_VERIFIED" });
  if (job.event.editionVenueId && p.editionVenueId !== job.event.editionVenueId) return finish({ status: "CANCELLED", lastErrorCode: "AUDIENCE_CHANGED" });
  try { assertDemoRegistration(p.user.email); } catch { return finish({ status: "CANCELLED", lastErrorCode: "DEMO_ONLY" }); }
  let mail: QueuedMail;
  try {
    const values = { name: p.fullName, year: String(p.edition.year), university: p.universityName, team: p.teamMembership?.team.name ?? "",
      venue: p.editionVenue ? (p.editionVenue.label || p.editionVenue.venue.name) : `Дистанционно: ${p.remoteZone === "MSK" ? "МСК UTC+3" : "НСК UTC+7"}` };
    mail = { to: p.user.email, subject: renderMailTemplate(job.event.subjectTemplate, values, true), text: renderMailTemplate(job.event.bodyTemplate, values), messageId: `<smo-${job.id}@notifications.invalid>` };
  } catch { return finish({ status: "FAILED", lastErrorCode: "INVALID_TEMPLATE" }); }
  let delivered: { messageId?: string };
  try { delivered = await send(mail); }
  catch {
    return finish({ status: claim.attempts >= OUTBOX_MAX_ATTEMPTS ? "FAILED" : "READY", lastErrorCode: "SMTP_FAILURE", availableAt: new Date(clock().getTime()+Math.min(300000,5000*2**(claim.attempts-1))) });
  }
  return finish({ status: "SENT", lastErrorCode: null, providerMessageId: delivered.messageId?.slice(0,500) ?? mail.messageId });
}
