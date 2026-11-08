import { z } from "zod";
import type { Prisma, PrismaClient } from "@prisma/client";
import { authorizeStaff, AccessDenied } from "./access";
import { assertDemoRegistration } from "./registration-rules";
import { reauthenticateParticipationChief } from "./corrections";
import { enqueueEmail } from "./outbox";
import { registrationsScope } from "./registrations";
const scope = z.object({ editionId: z.uuid() }).strict();
export async function publishResults(db: PrismaClient, actorId: string, raw: unknown) {
  const input = scope.extend({ batchId: z.uuid(), confirmed: z.literal(true), password: z.string().min(1).max(128) }).strict().parse(raw);
  await authorizeStaff(db, actorId, "results:publish", input.editionId);
  assertDemoRegistration((await db.user.findUniqueOrThrow({ where: { id: actorId } })).email);
  await reauthenticateParticipationChief(db, actorId, input.password);
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "OlympiadEdition" WHERE "id" = ${input.editionId}::uuid FOR UPDATE`;
    await authorizeStaff(tx, actorId, "results:publish", input.editionId);
    const batch = await tx.resultImportBatch.findFirst({ where: { id: input.batchId, editionId: input.editionId }, select: { id: true, kind: true, publication: true, results: { select: { participationId: true } } } });
    if (!batch) throw new AccessDenied("FORBIDDEN");
    if (batch.publication) return batch.publication;
    const publication = await tx.resultPublication.create({ data: { batchId: batch.id, actorId } });
    await enqueueEmail(tx, actorId, { kind: "RESULTS_PUBLISHED", sourceId: batch.id, sourceRevision: 1, editionId: input.editionId, editionVenueId: null,
      subjectTemplate: batch.kind === "FINAL" ? "Опубликованы итоговые результаты" : "Опубликованы предварительные результаты",
      bodyTemplate: "Ваши результаты олимпиады {{year}} опубликованы. Откройте раздел «Результаты» личного кабинета." }, batch.results.map(r => r.participationId));
    await tx.auditEvent.create({ data: { actorId, action: "RESULTS_PUBLISHED", objectType: "ResultImportBatch", objectId: batch.id, editionId: input.editionId, outcome: "SUCCESS", details: { kind: batch.kind, count: batch.results.length } } });
    return publication;
  }, { timeout: 30000 });
}
export async function resultsView(db: PrismaClient, actorId: string, raw: unknown) {
  const input = scope.extend({ page: z.int().min(1).max(10000).default(1) }).strict().parse(raw);
  return db.$transaction(async tx => {
    const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId } });
    if (!actor.emailVerified) throw new AccessDenied("FORBIDDEN");
    assertDemoRegistration(actor.email);
    let participation: Prisma.ParticipationWhereInput;
    if (actor.role === "STUDENT") {
      if (!await tx.participation.count({ where: { editionId: input.editionId, userId: actorId } })) throw new AccessDenied("FORBIDDEN");
      participation = { editionId: input.editionId, userId: actorId };
    } else participation = await registrationsScope(tx, actorId, input.editionId);
    const where: Prisma.IndividualResultWhereInput = { editionId: input.editionId, participation, batch: { publication: { isNot: null } },
      // A student's published final replaces their preliminary display only.
      ...(actor.role === "STUDENT" ? { OR: [{ kind: "FINAL" }, { kind: "PRELIMINARY", participation: { individualResults: { none: { kind: "FINAL", batch: { publication: { isNot: null } } } } } }] } : {}) };
    const total = await tx.individualResult.count({ where });
    const rows = await tx.individualResult.findMany({ where, orderBy: { id: "asc" }, skip: (input.page - 1) * 25, take: 25, select: { id: true, kind: true, total: true, prize: true, participation: { select: { fullName: true } }, scores: { orderBy: { problem: { ordinal: "asc" } }, select: { score: true, problem: { select: { ordinal: true } } } } } });
    return { total, rows: rows.map(r => ({ id: r.id, kind: r.kind, fullName: r.participation.fullName, total: r.total, prize: r.prize, scores: r.scores.map(s => ({ ordinal: s.problem.ordinal, score: s.score })) })) };
  }, { isolationLevel: "RepeatableRead" });
}
