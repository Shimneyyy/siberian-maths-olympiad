import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Prisma, PrismaClient } from "@prisma/client";
import { AccessDenied } from "./access";
import { assertDemoRegistration } from "./registration-rules";
const requestFields = { id: true, createdAt: true, reviewedAt: true } as const;
async function owner(db: Prisma.TransactionClient | PrismaClient, actorId: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: actorId } });
  if (user.role !== "STUDENT" || !user.emailVerified) throw new AccessDenied("FORBIDDEN");
  assertDemoRegistration(user.email);
}
export async function ownWithdrawalRequests(db: PrismaClient, actorId: string) {
  await owner(db, actorId);
  return db.consentWithdrawalRequest.findMany({ where: { userId: actorId }, select: requestFields, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 25 });
}
export async function requestConsentWithdrawal(db: PrismaClient, actorId: string, raw: unknown) {
  const input = z.object({ id: z.uuid(), confirmed: z.literal(true) }).strict().parse(raw);
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${actorId}::uuid FOR UPDATE`;
    await owner(tx, actorId);
    const old = await tx.consentWithdrawalRequest.findUnique({ where: { id: input.id } });
    if (old && old.userId !== actorId) throw new AccessDenied("FORBIDDEN");
    if (old) return { id: old.id, createdAt: old.createdAt, reviewedAt: old.reviewedAt };
    const pending = await tx.consentWithdrawalRequest.findFirst({ where: { userId: actorId, reviewedAt: null }, select: requestFields });
    if (pending) return pending;
    const request = await tx.consentWithdrawalRequest.create({ data: { id: input.id, userId: actorId }, select: requestFields });
    await tx.auditEvent.create({ data: { actorId, action: "CONSENT_WITHDRAWAL_REQUESTED", objectType: "ConsentWithdrawalRequest", objectId: request.id, outcome: "SUCCESS" } });
    return request;
  });
}
// Local synthetic operator only; never grants this power to an application role.
export function requireDemoOperator() {
  if (process.env.NODE_ENV === "production" || process.env.DEMO_REGISTRATION !== "true") throw new AccessDenied("FORBIDDEN");
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (!["127.0.0.1", "localhost"].includes(url.hostname)) throw new AccessDenied("FORBIDDEN");
}
export async function markWithdrawalReviewed(db: PrismaClient, id: string) {
  requireDemoOperator(); z.uuid().parse(id);
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "ConsentWithdrawalRequest" WHERE "id" = ${id}::uuid FOR UPDATE`;
    const item = await tx.consentWithdrawalRequest.findUniqueOrThrow({ where: { id } });
    assertDemoRegistration((await tx.user.findUniqueOrThrow({ where: { id: item.userId } })).email);
    if (item.reviewedAt) return { id: item.id, reviewedAt: item.reviewedAt };
    const updated = await tx.consentWithdrawalRequest.update({ where: { id }, data: { reviewedAt: new Date() }, select: { id: true, reviewedAt: true } });
    await tx.auditEvent.create({ data: { action: "CONSENT_REQUEST_REVIEWED_EXTERNALLY", objectType: "ConsentWithdrawalRequest", objectId: id, outcome: "SUCCESS" } });
    return updated;
  });
}
export function auditCutoff(now: Date) {
  const result = new Date(now); result.setUTCFullYear(result.getUTCFullYear() - 1); return result;
}
export async function auditRetention(db: PrismaClient, apply: boolean, now = new Date()) {
  requireDemoOperator();
  if (!Number.isFinite(now.getTime()) || now.getTime() > Date.now() + 60000) throw new Error("Invalid retention clock");
  const cutoff = auditCutoff(now);
  return db.$transaction(async tx => {
    const where = { createdAt: { lt: cutoff } }, count = await tx.auditEvent.count({ where });
    if (!apply) return { cutoff, count, applied: false };
    const removed = await tx.auditEvent.deleteMany({ where });
    await tx.auditEvent.create({ data: { action: "AUDIT_RETENTION_APPLIED", objectType: "Maintenance", objectId: randomUUID(), outcome: "SUCCESS", details: { count: removed.count, cutoff: cutoff.toISOString() } } });
    return { cutoff, count: removed.count, applied: true };
  });
}
