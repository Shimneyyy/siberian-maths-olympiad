import { createHmac } from "node:crypto";
import { z } from "zod";
import type { Prisma, PrismaClient } from "@prisma/client";
import { authorizeStaff } from "./access";
import { assertDemoRegistration } from "./registration-rules";
import { reauthenticateParticipationChief } from "./corrections";
import { OlympiadError } from "./olympiad-rules";
import { parseAccountCsv, ACCOUNT_CSV_LIMIT } from "./account-import-csv";
import { lockNsuhwNamespace } from "./nsuhw-namespace";
import { loadDemoKeyProtector } from "./external-secrets/local-keys";
import { storePreparedExternalAccount } from "./external-secrets/storage";
import { enqueueEmail } from "./outbox";
const inputSchema = z.object({ editionId: z.uuid(), csv: z.string().min(1).max(ACCOUNT_CSV_LIMIT) }).strict();
const applySchema = inputSchema.extend({ id: z.uuid(), selectionHash: z.string().regex(/^[a-f0-9]{64}$/), password: z.string().min(1).max(128), confirmed: z.literal(true) }).strict();
function mac(value: unknown) {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("Import fingerprint key unavailable");
  return createHmac("sha256", secret).update("nsuhw-import-v1\0").update(JSON.stringify(value)).digest("hex");
}
async function guard(tx: Prisma.TransactionClient | PrismaClient, actorId: string, editionId: string) {
  await authorizeStaff(tx, actorId, "notifications:send", editionId);
  assertDemoRegistration((await tx.user.findUniqueOrThrow({ where: { id: actorId } })).email);
}
async function inspect(tx: Prisma.TransactionClient, editionId: string, csv: string) {
  const parsed = parseAccountCsv(csv), ids = parsed.map(r => r.userId).filter(id => z.uuid().safeParse(id).success);
  const participants = await tx.participation.findMany({ where: { editionId, userId: { in: ids }, user: { role: "STUDENT", emailVerified: true } }, select: { id: true, userId: true, revision: true, fullName: true, user: { select: { email: true, preparedExternalAccount: { select: { id: true } }, legacyNsuhwClaim: { select: { id: true } } } } } });
  const people = new Map(participants.filter(p => p.user.email.endsWith("@example.test")).map(p => [p.userId, p]));
  const occupied = new Set((await tx.preparedExternalAccount.findMany({ select: { login: true } })).map(a => a.login.toLowerCase()));
  for (const claim of await tx.legacyNsuhwClaim.findMany({ select: { login: true } })) occupied.add(claim.login.toLowerCase());
  const users = new Map<string, number>(), logins = new Map<string, number>();
  for (const r of parsed) { users.set(r.userId, (users.get(r.userId) ?? 0) + 1); const key = r.login.toLowerCase(); logins.set(key, (logins.get(key) ?? 0) + 1); }
  const rows = parsed.map(r => {
    const p = people.get(r.userId);
    const error = users.get(r.userId)! > 1 || logins.get(r.login.toLowerCase())! > 1 ? "DUPLICATE" : r.error ?? (!p ? "PARTICIPANT_UNAVAILABLE" : p.user.preparedExternalAccount || p.user.legacyNsuhwClaim || occupied.has(r.login.toLowerCase()) ? "ACCOUNT_UNAVAILABLE" : null);
    return { ...r, error, fullName: p?.fullName ?? null, participationId: p?.id ?? null, revision: p?.revision ?? null };
  });
  return { rows, validCount: rows.filter(r => !r.error).length, rejectedCount: rows.filter(r => r.error).length, selectionHash: mac({ editionId, csv, state: rows.map(r => [r.line, r.error, r.participationId, r.revision]) }) };
}
export async function previewAccountImport(db: PrismaClient, actorId: string, raw: unknown) {
  const input = inputSchema.parse(raw);
  return db.$transaction(async tx => {
    await guard(tx, actorId, input.editionId);
    const value = await inspect(tx, input.editionId, input.csv);
    return { ...value, rows: value.rows.map(({ line, error, fullName }) => ({ line, error, fullName })) };
  }, { isolationLevel: "RepeatableRead", timeout: 30000 });
}
export async function applyAccountImport(db: PrismaClient, actorId: string, raw: unknown) {
  const input = applySchema.parse(raw);
  await guard(db, actorId, input.editionId); await reauthenticateParticipationChief(db, actorId, input.password);
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "OlympiadEdition" WHERE "id" = ${input.editionId}::uuid FOR UPDATE`;
    await guard(tx, actorId, input.editionId);
    const sourceMac = mac({ editionId: input.editionId, csv: input.csv });
    const old = await tx.nsuhwImportBatch.findUnique({ where: { id: input.id } });
    const result = (b: { id: string; importedCount: number; rejectedCount: number; report: Prisma.JsonValue }) => ({ id: b.id, importedCount: b.importedCount, rejectedCount: b.rejectedCount, report: b.report });
    if (old) {
      if (old.actorId !== actorId || old.editionId !== input.editionId || old.sourceMac !== sourceMac) throw new OlympiadError("CONFLICT", "UUID принадлежит другой загрузке.");
      return result(old);
    }
    const ids = [...new Set(parseAccountCsv(input.csv).map(r => r.userId).filter(id => z.uuid().safeParse(id).success))].sort();
    // Never lock a foreign owner merely because their UUID appeared in a rejected CSV row.
    const scopedOwners = await tx.participation.findMany({ where: { editionId: input.editionId, userId: { in: ids } }, select: { userId: true } });
    for (const id of scopedOwners.map(p => p.userId).sort()) await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${id}::uuid FOR UPDATE`;
    await lockNsuhwNamespace(tx);
    const preview = await inspect(tx, input.editionId, input.csv);
    if (preview.selectionHash !== input.selectionHash || !preview.validCount) throw new OlympiadError("CONFLICT", "Данные изменились или нет верных строк. Повторите предпросмотр.");
    const keys = await loadDemoKeyProtector(), confirmedAt = new Date();
    for (const row of preview.rows.filter(r => !r.error)) {
      const account = await storePreparedExternalAccount(tx, row.userId, row.login, row.password, keys, actorId);
      await tx.preparedExternalAccount.update({ where: { id: account.id }, data: { confirmedAt, confirmedById: actorId, confirmedEditionId: input.editionId, revision: { increment: 1 } } });
      await enqueueEmail(tx, actorId, { kind: "EXTERNAL_ACCOUNT_READY", sourceId: account.id, sourceRevision: 1, editionId: input.editionId, editionVenueId: null, subjectTemplate: "Данные аккаунта nsuhw доступны", bodyTemplate: "Главный организатор загрузил проверенные данные аккаунта nsuhw. Откройте раздел «Аккаунт nsuhw». Пароль в письме не передаётся." }, [row.participationId!]);
    }
    const batch = await tx.nsuhwImportBatch.create({ data: { id: input.id, actorId, editionId: input.editionId, sourceMac, importedCount: preview.validCount, rejectedCount: preview.rejectedCount, report: preview.rows.map(r => ({ line: r.line, error: r.error })) } });
    await tx.auditEvent.create({ data: { actorId, editionId: input.editionId, action: "NSUHW_ACCOUNTS_IMPORTED", objectType: "NsuhwImportBatch", objectId: batch.id, outcome: "SUCCESS", details: { importedCount: batch.importedCount, rejectedCount: batch.rejectedCount } } });
    return result(batch);
  }, { timeout: 30000 });
}
