import "dotenv/config";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { Client } from "pg";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "better-auth/crypto";
import { parseResultCsv } from "../src/lib/result-csv";
import { previewResultImport, applyResultImport, resultImportOptions } from "../src/lib/result-imports";
process.env.DEMO_REGISTRATION = "true";
const schema = `results_${randomUUID().replaceAll("-", "")}`, connection = process.env.DATABASE_URL!;
const sql = new Client({ connectionString: connection });
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: connection, options: `-c search_path=${schema}` }, { schema }) });
const password = `Synthetic-${randomUUID()}`;
let hash: string, serial = 8600;
before(async () => {
  await sql.connect(); await sql.query(`CREATE SCHEMA "${schema}"`); await sql.query(`SET search_path TO "${schema}"`);
  for (const m of (await readdir("prisma/migrations")).filter(x => /^\d/.test(x)).sort()) await sql.query(await readFile(`prisma/migrations/${m}/migration.sql`, "utf8"));
  hash = await hashPassword(password);
});
after(async () => { await db.$disconnect(); await sql.query("SET search_path TO public"); await sql.query(`DROP SCHEMA "${schema}" CASCADE`); await sql.end(); });
async function fixture() {
  const edition = await db.olympiadEdition.create({ data: { year: serial++, title: "Учебные результаты" } });
  const foreign = await db.olympiadEdition.create({ data: { year: serial++, title: "Другой год" } });
  const chief = await db.user.create({ data: { name: "Учебный главный", email: `${randomUUID()}@example.test`, role: "CHIEF_ORGANIZER", emailVerified: true, twoFactorEnabled: true } });
  await db.account.create({ data: { userId: chief.id, accountId: chief.id, providerId: "credential", password: hash } });
  await db.editionStaffGrant.create({ data: { userId: chief.id, editionId: edition.id } });
  const uni = await db.university.create({ data: { name: "Учебный вуз", abbreviation: "УВ" } }), course = await db.courseOption.create({ data: { label: "Учебный курс" } });
  const people = [];
  for (let i = 0; i < 5; i++) {
    const user = await db.user.create({ data: { email: `${randomUUID()}@example.test`, name: `Синтетический участник ${i}`, emailVerified: true } });
    const consent = await db.consentRecord.create({ data: { userId: user.id, purpose: "synthetic-demo-only", textVersion: "demo", textHash: "a".repeat(64) } });
    const p = await db.participation.create({ data: { userId: user.id, editionId: i === 3 ? foreign.id : edition.id, status: i === 2 ? "CANCELLED" : "REGISTERED", format: "REMOTE", remoteZone: "NSK", fullName: user.name, universityId: uni.id, universityName: uni.name, universityAbbreviation: uni.abbreviation, courseId: course.id, courseLabel: course.label, consentId: consent.id } });
    const login = `Legacy.${randomUUID()}`;
    await db.legacyNsuhwClaim.create({ data: { userId: user.id, login, ...(i === 4 ? {} : { approvedAt: new Date(), approvedById: chief.id, approvedEditionId: p.editionId }) } });
    people.push({ user, p, login });
  }
  const csv = (lines: string[]) => "\uFEFFЛогин,Задача 1,Задача 2,Сумма,Приз\r\n" + lines.join("\r\n") + "\r\n";
  const input = (lines: string[]) => ({ editionId: edition.id, kind: "PRELIMINARY" as const, csv: csv(lines) });
  const preview = (lines: string[]) => previewResultImport(db, chief.id, input(lines));
  const command = async (lines: string[]) => ({ ...input(lines), id: randomUUID(), selectionHash: (await preview(lines)).selectionHash, password, confirmed: true });
  return { edition, foreign, chief, people, csv, input, preview, command };
}
test("E07 CSV preserves quoted text, zero/null and rejects malformed framing, unsafe numbers and bounds", () => {
  const parsed = parseResultCsv('\uFEFFЛогин,Задача 1,Сумма,Приз\r\nlegacy,0,,"Приз, \"\"учебный\"\"\nтекст"\r\n');
  assert.equal(parsed.rows.length, 1); assert.deepEqual(parsed.rows[0].scores, [0]); assert.equal(parsed.rows[0].total, null); assert.equal(parsed.rows[0].prize, 'Приз, "учебный"\nтекст');
  for (const value of ["-1", "1.5", "1e2", "2147483648", "=1", "NaN"]) assert.equal(parseResultCsv(`Логин,Задача 1,Сумма,Приз\nx,${value},,`).rows[0].error, "INVALID_SCORE");
  for (const csv of ['Логин,Задача 1,Сумма,Приз\nx,"1,,', 'Логин,Задача 2,Сумма,Приз\nx,1,,', 'x'.repeat(524289), 'Логин,Задача 1,Сумма,Приз\nx,"1"x,,']) assert.throws(() => parseResultCsv(csv));
});
test("E07 partial apply matches exact approved logins in year, persists scores and imported sum without publication", async () => {
  const f = await fixture(), [a,b,c,foreign,pending] = f.people;
  const lines = [`${a.login},0,,99,"Приз, учебный"`, `${b.login},1.5,2,3,`, `${c.login},3,4,7,`, `${foreign.login},1,2,3,`, `${pending.login},1,2,3,`, `unknown,1,2,3,`];
  const preview = await f.preview(lines); assert.equal(preview.validCount, 2); assert.equal(preview.rejectedCount, 4);
  assert.equal(await db.individualResult.count(), 0); assert.ok(!JSON.stringify(preview).includes(a.user.email));
  const body = await f.command(lines); const done = await applyResultImport(db, f.chief.id, body);
  assert.equal(done.importedCount, 2); assert.equal(done.rejectedCount, 4);
  assert.deepEqual(await applyResultImport(db, f.chief.id, body), done);
  const result = await db.individualResult.findUniqueOrThrow({ where: { participationId_kind: { participationId: a.p.id, kind: "PRELIMINARY" } }, include: { scores: { include: { problem: true } } } });
  assert.equal(result.total, 99); assert.equal(result.prize, "Приз, учебный"); assert.deepEqual(result.scores.sort((a,b) => a.problem.ordinal - b.problem.ordinal).map(s => s.score), [0,null]);
  assert.equal(await db.outboxEvent.count({ where: { editionId: f.edition.id } }), 0);
  const audit = await db.auditEvent.findMany({ where: { editionId: f.edition.id, action: "RESULTS_IMPORTED" } });
  assert.equal(audit.length, 1); assert.ok(!JSON.stringify(audit).includes(a.login));
  assert.ok(!JSON.stringify(await db.resultImportBatch.findUniqueOrThrow({ where: { id: done.id } })).includes(a.login));
  assert.equal((await f.preview([`${a.login},1,2,3,`])).rows[0].error, "ALREADY_EXISTS");
  const finalInput = { ...f.input([`${a.login},1,2,3,`]), kind: "FINAL" };
  const finalPreview = await previewResultImport(db, f.chief.id, finalInput);
  await applyResultImport(db, f.chief.id, { ...finalInput, id: randomUUID(), selectionHash: finalPreview.selectionHash, confirmed: true, password });
  assert.equal(await db.individualResult.count({ where: { participationId: a.p.id } }), 2);
});
test("E07 duplicates all fail, stale preview and concurrent imports never overwrite or duplicate", async () => {
  const f = await fixture(), [a,b] = f.people;
  const duplicates = await f.preview([`${a.login},1,2,3,`, `${a.login},invalid,2,3,`, `${b.login},1,2,3,`]);
  assert.deepEqual(duplicates.rows.map(r => r.error), ["DUPLICATE", "DUPLICATE", null]);
  const body = await f.command([`${a.login},1,2,3,`]);
  const race = await Promise.allSettled([applyResultImport(db, f.chief.id, body), applyResultImport(db, f.chief.id, { ...body, id: randomUUID() })]);
  assert.equal(race.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(await db.individualResult.count({ where: { participationId: a.p.id } }), 1);
  const stale = await f.command([`${b.login},1,2,3,`]);
  await db.participation.update({ where: { id: b.p.id }, data: { revision: { increment: 1 } } });
  await assert.rejects(applyResultImport(db, f.chief.id, stale));
  await assert.rejects(previewResultImport(db, f.chief.id, { ...f.input([`${b.login},1,2,3,`]), csv: `Логин,Задача 1,Сумма,Приз\n${b.login},1,1,` }));
});
test("E07 roles, year, MFA, email, demo mode, reauth, confirmation and spoofed fields are enforced", async () => {
  const f = await fixture(), body = await f.command([`${f.people[0].login},1,2,3,`]);
  for (const role of ["STUDENT", "VENUE_ORGANIZER", "TECHNICAL_ADMIN"] as const) {
    const user = await db.user.create({ data: { email: `${randomUUID()}@example.test`, name: "Учебная чужая роль", role, emailVerified: true, twoFactorEnabled: true } });
    await assert.rejects(previewResultImport(db, user.id, f.input([`${f.people[0].login},1,2,3,`])));
    await assert.rejects(applyResultImport(db, user.id, body)); await assert.rejects(resultImportOptions(db, user.id));
  }
  await assert.rejects(applyResultImport(db, f.chief.id, { ...body, password: "wrong" }));
  await assert.rejects(applyResultImport(db, f.chief.id, { ...body, confirmed: false }));
  await assert.rejects(applyResultImport(db, f.chief.id, { ...body, actorId: f.chief.id }));
  await assert.rejects(previewResultImport(db, f.chief.id, { ...f.input([]), editionId: f.foreign.id }));
  for (const field of ["twoFactorEnabled", "emailVerified"] as const) { await db.user.update({ where: { id: f.chief.id }, data: { [field]: false } }); await assert.rejects(applyResultImport(db, f.chief.id, body)); await db.user.update({ where: { id: f.chief.id }, data: { [field]: true } }); }
  process.env.DEMO_REGISTRATION = "false"; try { await assert.rejects(applyResultImport(db, f.chief.id, body)); } finally { process.env.DEMO_REGISTRATION = "true"; }
  await db.editionStaffGrant.update({ where: { userId_editionId: { userId: f.chief.id, editionId: f.edition.id } }, data: { revokedAt: new Date() } });
  await assert.rejects(applyResultImport(db, f.chief.id, body));
});
test("E07 audit failure rolls back every valid row and DB guards reject negative/cross-year changes", async () => {
  const f = await fixture(), body = await f.command(f.people.slice(0,2).map(p => `${p.login},1,2,3,`));
  const broken = db.$extends({ query: { auditEvent: { async create() { throw new Error("Synthetic audit outage"); } } } });
  await assert.rejects(applyResultImport(broken as unknown as PrismaClient, f.chief.id, body));
  assert.equal(await db.resultImportBatch.count({ where: { editionId: f.edition.id } }), 0); assert.equal(await db.editionProblem.count({ where: { editionId: f.edition.id } }), 0);
  const done = await applyResultImport(db, f.chief.id, body);
  const result = await db.individualResult.findFirstOrThrow({ where: { batchId: done.id } });
  await assert.rejects(db.individualResult.update({ where: { id: result.id }, data: { total: 4 } }));
  await assert.rejects(db.individualResult.create({ data: { editionId: f.edition.id, participationId: f.people[3].p.id, batchId: done.id, kind: "PRELIMINARY", total: 1 } }));
  await assert.rejects(db.individualResult.create({ data: { editionId: f.edition.id, participationId: f.people[2].p.id, batchId: done.id, kind: "PRELIMINARY", total: -1 } }));
  const otherProblem = await db.editionProblem.create({ data: { editionId: f.foreign.id, ordinal: 1 } });
  await assert.rejects(db.resultProblemScore.create({ data: { resultId: result.id, editionId: f.edition.id, problemId: otherProblem.id, score: 1 } }));
  const p = await db.editionProblem.findFirstOrThrow({ where: { editionId: f.edition.id } });
  const another = await db.individualResult.create({ data: { editionId: f.edition.id, participationId: f.people[2].p.id, batchId: done.id, kind: "PRELIMINARY" } });
  await assert.rejects(db.resultProblemScore.create({ data: { resultId: another.id, editionId: f.edition.id, problemId: p.id, score: -1 } }));
});
