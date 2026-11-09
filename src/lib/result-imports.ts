import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Prisma, PrismaClient } from "@prisma/client";
import { AccessDenied, authorizeStaff } from "./access";
import { assertDemoRegistration } from "./registration-rules";
import { reauthenticateParticipationChief } from "./corrections";
import { OlympiadError } from "./olympiad-rules";
import { parseResultCsv, RESULT_CSV_LIMIT } from "./result-csv";
const inputSchema = z.object({ editionId: z.uuid(), kind: z.enum(["PRELIMINARY", "FINAL"]), csv: z.string().min(1).max(RESULT_CSV_LIMIT) }).strict();
const applySchema = inputSchema.extend({ id: z.uuid(), selectionHash: z.string().regex(/^[a-f0-9]{64}$/), confirmed: z.literal(true), password: z.string().min(1).max(128) }).strict();
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function guard(tx: PrismaClient | Prisma.TransactionClient, actorId: string, editionId: string) {
  await authorizeStaff(tx, actorId, "results:publish", editionId);
  assertDemoRegistration((await tx.user.findUniqueOrThrow({ where: { id: actorId }, select: { email: true } })).email);
}
export async function resultImportOptions(db: PrismaClient, actorId: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: actorId } });
  if (!user.emailVerified || user.role !== "CHIEF_ORGANIZER") throw new AccessDenied("FORBIDDEN");
  assertDemoRegistration(user.email);
  return db.olympiadEdition.findMany({ where: { staffGrants: { some: { userId: actorId, revokedAt: null } } }, orderBy: { year: "desc" }, select: { id: true, year: true } });
}
async function inspect(tx: Prisma.TransactionClient, input: z.infer<typeof inputSchema>) {
  const parsed = parseResultCsv(input.csv);
  const problems = await tx.editionProblem.findMany({ where: { editionId: input.editionId }, orderBy: { ordinal: "asc" }, select: { id: true, ordinal: true } });
  if (problems.length && (problems.length !== parsed.taskCount || problems.some((p, i) => p.ordinal !== i + 1))) throw new OlympiadError("CONFLICT", "Число задач не совпадает с задачами выпуска.");
  const logins = [...new Set(parsed.rows.map(r => r.login))];
  // Never load auth, key material, or unrelated-year participants. Exact login
  // spelling is deliberate: legacy case normalization has not been agreed.
  const participants = await tx.participation.findMany({ where: { editionId: input.editionId, user: { role: "STUDENT", emailVerified: true, OR: [
    { preparedExternalAccount: { is: { login: { in: logins }, confirmedAt: { not: null } } } },
    { legacyNsuhwClaim: { is: { login: { in: logins }, approvedAt: { not: null } } } },
  ] } }, select: { id: true, revision: true, user: { select: { email: true, preparedExternalAccount: { select: { login: true, confirmedAt: true } }, legacyNsuhwClaim: { select: { login: true, approvedAt: true } } } }, individualResults: { where: { kind: input.kind }, select: { id: true } } } });
  const byLogin = new Map<string, typeof participants>();
  for (const p of participants) {
    // Synthetic-only boundary also protects imports into a contaminated demo DB.
    if (!p.user.email.endsWith("@example.test")) continue;
    const logins = new Set([...(p.user.preparedExternalAccount?.confirmedAt ? [p.user.preparedExternalAccount.login] : []), ...(p.user.legacyNsuhwClaim?.approvedAt ? [p.user.legacyNsuhwClaim.login] : [])]);
    for (const login of logins) byLogin.set(login, [...(byLogin.get(login) ?? []), p]);
  }
  const counts = new Map<string, number>(), owners = new Map<string, number>();
  for (const r of parsed.rows) {
    counts.set(r.login, (counts.get(r.login) ?? 0) + 1);
    const matches = byLogin.get(r.login) ?? [];
    if (matches.length === 1) owners.set(matches[0].id, (owners.get(matches[0].id) ?? 0) + 1);
  }
  const rows = parsed.rows.map(row => {
    const matches = byLogin.get(row.login) ?? [], p = matches.length === 1 ? matches[0] : null;
    const error = (counts.get(row.login)! > 1 || (p && owners.get(p.id)! > 1)) ? "DUPLICATE" : row.error ?? (!p ? "PARTICIPANT_UNAVAILABLE" : p.individualResults.length ? "ALREADY_EXISTS" : null);
    return { ...row, error, participationId: p?.id ?? null, revision: p?.revision ?? null };
  });
  const selectionHash = hash({ editionId: input.editionId, kind: input.kind, sourceHash: hash(input.csv), problems, rows });
  return { taskCount: parsed.taskCount, rows, selectionHash, validCount: rows.filter(r => !r.error).length, rejectedCount: rows.filter(r => !!r.error).length };
}
function view(value: Awaited<ReturnType<typeof inspect>>) {
  return { ...value, rows: value.rows.map(({ line, login, scores, total, prize, error }) => ({ line, login, scores, total, prize, error })) };
}
export async function previewResultImport(db: PrismaClient, actorId: string, raw: unknown) {
  const input = inputSchema.parse(raw);
  return db.$transaction(async tx => { await guard(tx, actorId, input.editionId); return view(await inspect(tx, input)); }, { isolationLevel: "RepeatableRead", timeout: 30000 });
}
export async function applyResultImport(db: PrismaClient, actorId: string, raw: unknown) {
  const input = applySchema.parse(raw);
  await guard(db, actorId, input.editionId);
  await reauthenticateParticipationChief(db, actorId, input.password);
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "OlympiadEdition" WHERE "id" = ${input.editionId}::uuid FOR UPDATE`;
    await guard(tx, actorId, input.editionId);
    const sourceHash = hash(input.csv);
    const old = await tx.resultImportBatch.findUnique({ where: { id: input.id }, select: { id: true, editionId: true, actorId: true, kind: true, sourceHash: true, importedCount: true, rejectedCount: true, report: true } });
    if (old) {
      if (old.editionId !== input.editionId || old.actorId !== actorId || old.kind !== input.kind || old.sourceHash !== sourceHash) throw new OlympiadError("CONFLICT", "Идентификатор уже использован для другой загрузки.");
      return { id: old.id, importedCount: old.importedCount, rejectedCount: old.rejectedCount, report: old.report };
    }
    const preview = await inspect(tx, input);
    if (preview.selectionHash !== input.selectionHash) throw new OlympiadError("CONFLICT", "Данные изменились. Повторите предпросмотр и подтверждение.");
    if (!preview.validCount) throw new OlympiadError("CONFLICT", "Нет верных строк для загрузки.");
    // All business validation errors are already isolated per record. Storage or
    // audit failure rolls back the batch, rather than silently losing valid rows.
    const report = preview.rows.map(r => ({ line: r.line, error: r.error }));
    const batch = await tx.resultImportBatch.create({ data: { id: input.id, editionId: input.editionId, actorId, kind: input.kind, sourceHash, importedCount: preview.validCount, rejectedCount: preview.rejectedCount, report } });
    if (!await tx.editionProblem.count({ where: { editionId: input.editionId } })) await tx.editionProblem.createMany({ data: Array.from({ length: preview.taskCount }, (_, i) => ({ editionId: input.editionId, ordinal: i + 1 })) });
    const problems = await tx.editionProblem.findMany({ where: { editionId: input.editionId }, orderBy: { ordinal: "asc" } });
    const valid = preview.rows.filter(r => !r.error).map(row => ({ row, id: randomUUID() }));
    // Bounded chunks avoid a query per participant and oversized bind lists.
    for (let offset = 0; offset < valid.length; offset += 100) {
      const chunk = valid.slice(offset, offset + 100);
      await tx.individualResult.createMany({ data: chunk.map(({ row, id }) => ({ id, editionId: input.editionId, participationId: row.participationId!, batchId: batch.id, kind: input.kind, total: row.total, prize: row.prize })) });
      await tx.resultProblemScore.createMany({ data: chunk.flatMap(({ row, id }) => problems.map((p, i) => ({ resultId: id, editionId: input.editionId, problemId: p.id, score: row.scores[i] }))) });
    }
    await tx.auditEvent.create({ data: { actorId, action: "RESULTS_IMPORTED", objectType: "ResultImportBatch", objectId: batch.id, editionId: input.editionId, outcome: "SUCCESS", details: { kind: input.kind, importedCount: batch.importedCount, rejectedCount: batch.rejectedCount } } });
    return { id: batch.id, importedCount: batch.importedCount, rejectedCount: batch.rejectedCount, report };
  }, { timeout: 30000 });
}

// Chief-only review of stored imports. This is deliberately separate from the
// future published-result reader: students and venue staff cannot read drafts.
export async function reviewResultImports(db: PrismaClient, actorId: string, raw: unknown) {
  const input = z.object({ editionId: z.uuid(), batchId: z.uuid().optional(), page: z.int().min(1).max(10000).default(1) }).strict().parse(raw);
  return db.$transaction(async tx => {
    await guard(tx, actorId, input.editionId);
    if (!input.batchId) {
      const total = await tx.resultImportBatch.count({ where: { editionId: input.editionId } });
      const batches = await tx.resultImportBatch.findMany({ where: { editionId: input.editionId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (input.page - 1) * 25, take: 25,
        select: { publication: { select: { publishedAt: true } }, id: true, kind: true, createdAt: true, importedCount: true, rejectedCount: true } });
      return { total, batches, publication: null, results: [] };
    }
    const batch = await tx.resultImportBatch.findFirst({ where: { id: input.batchId, editionId: input.editionId }, select: { id: true, kind: true, publication: { select: { publishedAt: true } } } });
    if (!batch) throw new AccessDenied("FORBIDDEN");
    const where = { batchId: batch.id, editionId: input.editionId };
    const total = await tx.individualResult.count({ where });
    const rows = await tx.individualResult.findMany({ where, orderBy: { id: "asc" }, skip: (input.page - 1) * 25, take: 25,
      select: { id: true, total: true, prize: true, participation: { select: { fullName: true } }, scores: { orderBy: { problem: { ordinal: "asc" } }, select: { score: true, problem: { select: { ordinal: true } } } } } });
    return { total, batches: [], publication: batch.publication, results: rows.map(r => ({ id: r.id, fullName: r.participation.fullName, total: r.total, prize: r.prize, scores: r.scores.map(s => ({ ordinal: s.problem.ordinal, score: s.score })) })) };
  }, { isolationLevel: "RepeatableRead" });
}
