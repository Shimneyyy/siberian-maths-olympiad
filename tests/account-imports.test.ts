import "dotenv/config";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { Client } from "pg";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "better-auth/crypto";
import { previewAccountImport, applyAccountImport } from "../src/lib/account-imports";
import { parseAccountCsv } from "../src/lib/account-import-csv";
import { revealNsuhwSecret } from "../src/lib/reveal-nsuhw";
import { csvRow } from "../src/lib/csv";
process.env.DEMO_REGISTRATION = "true";
const schema = `imports_${randomUUID().replaceAll("-", "")}`, connection = process.env.DATABASE_URL!;
const sql = new Client({ connectionString: connection });
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: connection, options: `-c search_path=${schema}` }, { schema }) });
const password = `Synthetic-${randomUUID()}`; let hash: string, year = 9200;
before(async () => { await sql.connect(); await sql.query(`CREATE SCHEMA "${schema}"`); await sql.query(`SET search_path TO "${schema}"`); for (const m of (await readdir("prisma/migrations")).filter(m => /^\d/.test(m)).sort()) await sql.query(await readFile(`prisma/migrations/${m}/migration.sql`, "utf8")); hash = await hashPassword(password); });
after(async () => { await db.$disconnect(); await sql.query("SET search_path TO public"); await sql.query(`DROP SCHEMA "${schema}" CASCADE`); await sql.end(); });
const csv = (rows: string[][]) => "\uFEFF" + csvRow(["ID пользователя ЛК", "логин nsuhw", "пароль nsuhw"]) + rows.map(csvRow).join("");
async function fixture() {
  const edition = await db.olympiadEdition.create({ data: { year: year++, title: "Учебный импорт" } });
  const chief = await db.user.create({ data: { email: `${randomUUID()}@example.test`, name: "Учебный главный", role: "CHIEF_ORGANIZER", emailVerified: true } });
  await db.account.create({ data: { userId: chief.id, accountId: chief.id, providerId: "credential", password: hash } });
  await db.editionStaffGrant.create({ data: { editionId: edition.id, userId: chief.id } });
  const uni = await db.university.create({ data: { name: "Учебный вуз", abbreviation: "УВ" } }), course = await db.courseOption.create({ data: { label: "Учебный курс" } });
  const people = [];
  for (let i = 0; i < 3; i++) {
    const user = await db.user.create({ data: { email: `${randomUUID()}@example.test`, name: `Учебный владелец ${i}`, emailVerified: true } });
    await db.account.create({ data: { userId: user.id, accountId: user.id, providerId: "credential", password: hash } });
    const consent = await db.consentRecord.create({ data: { userId: user.id, purpose: "synthetic-demo-only", textVersion: "demo", textHash: "a".repeat(64) } });
    const p = await db.participation.create({ data: { editionId: edition.id, userId: user.id, format: "REMOTE", remoteZone: "NSK", fullName: user.name, universityId: uni.id, universityName: uni.name, universityAbbreviation: uni.abbreviation, courseId: course.id, courseLabel: course.label, consentId: consent.id } });
    people.push({ user, p, login: `archive.${randomUUID()}`, secret: `External-${randomUUID()}` });
  }
  const input = { editionId: edition.id, csv: csv([[people[0].user.id, people[0].login, people[0].secret], [randomUUID(), "unknown.synthetic", "Synthetic-secret"]]) };
  const preview = () => previewAccountImport(db, chief.id, input);
  const command = async () => ({ ...input, id: randomUUID(), password, confirmed: true, selectionHash: (await preview()).selectionHash });
  return { edition, chief, people, input, preview, command, reset: () => db.rateLimit.deleteMany({ where: { key: { contains: chief.id } } }) };
}
test("E02 bounded CSV parses quoted secrets without normalization and rejects framing/oversize", () => {
  const id = randomUUID(), text = csv([[id, "synthetic.login", ' Secret,"value" ']]);
  assert.equal(parseAccountCsv(text)[0].password, ' Secret,"value" ');
  assert.throws(() => parseAccountCsv(text + '"unterminated'));
  assert.throws(() => parseAccountCsv("x".repeat(524289)));
  assert.throws(() => parseAccountCsv(csv(Array.from({ length: 1001 }, () => [id, "login", "Synthetic"]))));
  assert.equal(parseAccountCsv(csv([[id, "login", "bad\nsecret"]]))[0].error, "INVALID_PASSWORD");
});
test("E02/E03 partial scoped import never returns/stores plaintext and enables own E06 with one notification", async () => {
  const f = await fixture(), preview = await f.preview();
  assert.equal(preview.validCount, 1); assert.equal(preview.rejectedCount, 1);
  assert.ok(!JSON.stringify(preview).includes(f.people[0].secret)); assert.ok(!JSON.stringify(preview).includes(f.people[0].login));
  const input = await f.command(), result = await applyAccountImport(db, f.chief.id, input);
  assert.equal(result.importedCount, 1); assert.equal((await applyAccountImport(db, f.chief.id, input)).id, result.id);
  assert.equal(await db.outboxJob.count({ where: { editionId: f.edition.id } }), 1);
  const preparation = await db.auditEvent.findFirstOrThrow({ where: { action: "EXTERNAL_SECRET_PREPARED", objectId: (await db.preparedExternalAccount.findUniqueOrThrow({ where: { userId: f.people[0].user.id } })).id } });
  assert.equal(preparation.actorId, f.chief.id, "Import audit attributes the write to the authenticated chief");
  const account = await db.preparedExternalAccount.findUniqueOrThrow({ where: { userId: f.people[0].user.id } });
  assert.ok(account.confirmedAt); assert.ok(!JSON.stringify(account.secretEnvelope).includes(f.people[0].secret));
  const revealed = await revealNsuhwSecret(db, f.people[0].user.id, { password, confirmed: true });
  assert.ok(revealed.password === f.people[0].secret, "Own imported password round-trips exactly");
  await assert.rejects(revealNsuhwSecret(db, f.people[1].user.id, { password, confirmed: true }));
  const metadata = JSON.stringify({ batch: await db.nsuhwImportBatch.findMany({ where: { editionId: f.edition.id } }), audit: await db.auditEvent.findMany({ where: { editionId: f.edition.id } }), events: await db.outboxEvent.findMany({ where: { editionId: f.edition.id } }) });
  assert.ok(!metadata.includes(f.people[0].secret)); assert.ok(!metadata.includes(f.people[0].login));
  await assert.rejects(db.nsuhwImportBatch.update({ where: { id: result.id }, data: { importedCount: 99 } }));
});
test("E02 duplicates all fail; legacy/existing logins cannot be replaced, stale changes and UUID reuse fail", async () => {
  const f = await fixture(), owner = f.people[0];
  const duplicate = { ...f.input, csv: csv([[owner.user.id, owner.login, owner.secret], [owner.user.id, "other.synthetic", ""]]) };
  assert.ok((await previewAccountImport(db, f.chief.id, duplicate)).rows.every(r => r.error === "DUPLICATE"));
  const loginDuplicate = { ...f.input, csv: csv([[owner.user.id, owner.login, owner.secret], [f.people[1].user.id, owner.login.toUpperCase(), "Synthetic"]]) };
  assert.equal((await previewAccountImport(db, f.chief.id, loginDuplicate)).validCount, 0);
  const stale = await f.command();
  await db.legacyNsuhwClaim.create({ data: { userId: owner.user.id, login: owner.login } });
  await assert.rejects(applyAccountImport(db, f.chief.id, stale));
  await db.legacyNsuhwClaim.delete({ where: { userId: owner.user.id } });
  const command = await f.command(); await applyAccountImport(db, f.chief.id, command);
  await assert.rejects(applyAccountImport(db, f.chief.id, { ...command, csv: command.csv + "\n" }));
  assert.equal((await f.preview()).validCount, 0);
});
test("E03 rejects roles, verified email/password/confirmation/spoofing, wrong year and revoked grants", async () => {
  const f = await fixture(), command = await f.command();
  await assert.rejects(previewAccountImport(db, f.people[0].user.id, f.input));
  await assert.rejects(applyAccountImport(db, f.chief.id, { ...command, userId: f.people[0].user.id }));
  await assert.rejects(applyAccountImport(db, f.chief.id, { ...command, password: "Wrong" }));
  await assert.rejects(applyAccountImport(db, f.chief.id, { ...command, confirmed: false }));
  await assert.rejects(previewAccountImport(db, f.chief.id, { ...f.input, editionId: randomUUID() }));
  await db.user.update({ where: { id: f.chief.id }, data: { emailVerified: false } }); await assert.rejects(f.preview());
  await db.user.update({ where: { id: f.chief.id }, data: { emailVerified: true } });
  for (const role of ["TECHNICAL_ADMIN", "VENUE_ORGANIZER"] as const) {
    const actor = await db.user.create({ data: { email: `${randomUUID()}@example.test`, name: "Учебная роль", role, emailVerified: true } });
    await assert.rejects(previewAccountImport(db, actor.id, f.input));
  }
  await db.editionStaffGrant.update({ where: { userId_editionId: { userId: f.chief.id, editionId: f.edition.id } }, data: { revokedAt: new Date() } });
  await assert.rejects(applyAccountImport(db, f.chief.id, command));
});
test("E03 audit/outbox failure rolls all records back; concurrent repeats create one account/batch", async () => {
  const f = await fixture(), command = await f.command();
  const broken = db.$extends({ query: { auditEvent: { async create() { throw new Error("Synthetic audit outage"); } } } });
  await assert.rejects(applyAccountImport(broken as unknown as PrismaClient, f.chief.id, command));
  assert.equal(await db.preparedExternalAccount.count({ where: { userId: f.people[0].user.id } }), 0);
  const brokenQueue = db.$extends({ query: { outboxEvent: { async create() { throw new Error("Synthetic queue outage"); } } } });
  await assert.rejects(applyAccountImport(brokenQueue as unknown as PrismaClient, f.chief.id, command));
  assert.equal(await db.nsuhwImportBatch.count({ where: { editionId: f.edition.id } }), 0);
  await f.reset();
  const results = await Promise.all([applyAccountImport(db, f.chief.id, command), applyAccountImport(db, f.chief.id, command)]);
  assert.equal(results[0].id, results[1].id); assert.equal(await db.outboxJob.count({ where: { editionId: f.edition.id } }), 1);
});

test("E03 does not lock a rejected foreign owner's User row", async () => {
  const f = await fixture();
  const foreign = await db.user.create({ data: { email: `${randomUUID()}@example.test`, name: "Чужой учебный владелец", emailVerified: true } });
  f.input.csv = csv([[f.people[0].user.id, f.people[0].login, f.people[0].secret], [foreign.id, "foreign.synthetic", "Synthetic"]]);
  const command = await f.command();
  await sql.query("BEGIN");
  try {
    await sql.query('SELECT id FROM "User" WHERE id=$1 FOR UPDATE', [foreign.id]);
    const result = await applyAccountImport(db, f.chief.id, command);
    assert.equal(result.importedCount, 1); assert.equal(result.rejectedCount, 1);
  } finally { await sql.query("ROLLBACK"); }
});
