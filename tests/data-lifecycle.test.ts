import { createIndividualDocuments, releaseOriginalBatch } from "../src/lib/result-documents";
import "dotenv/config";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { Client } from "pg";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "../src/lib/pg-adapter";
import { requestConsentWithdrawal, ownWithdrawalRequests, markWithdrawalReviewed, auditRetention, auditCutoff } from "../src/lib/data-lifecycle";
import { personalHistory } from "../src/lib/personal-history";
process.env.DEMO_REGISTRATION = "true";
const schema = `lifecycle_${randomUUID().replaceAll("-", "")}`, connection = process.env.DATABASE_URL!;
const sql = new Client({ connectionString: connection }), db = new PrismaClient({ adapter: new PrismaPg({ connectionString: connection, options: `-c search_path=${schema}` }, { schema }) });
let serial = 9300;
before(async () => { await sql.connect(); await sql.query(`CREATE SCHEMA "${schema}"`); await sql.query(`SET search_path TO "${schema}"`); for (const m of (await readdir("prisma/migrations")).filter(m => /^\d/.test(m)).sort()) await sql.query(await readFile(`prisma/migrations/${m}/migration.sql`, "utf8")); });
after(async () => { await db.$disconnect(); await sql.query("SET search_path TO public"); await sql.query(`DROP SCHEMA "${schema}" CASCADE`); await sql.end(); });
async function fixture() {
  const user = await db.user.create({ data: { email: `${randomUUID()}@example.test`, name: "Учебный субъект", emailVerified: true } });
  const other = await db.user.create({ data: { email: `${randomUUID()}@example.test`, name: "Другой учебный субъект", emailVerified: true } });
  const chief = await db.user.create({ data: { email: `${randomUUID()}@example.test`, name: "Учебный главный", role: "CHIEF_ORGANIZER", emailVerified: true } });
  const uni = await db.university.create({ data: { name: "Учебный вуз", abbreviation: "УВ" } }), course = await db.courseOption.create({ data: { label: "Учебный курс" } });
  const consent = await db.consentRecord.create({ data: { userId: user.id, purpose: "synthetic-demo-only", textVersion: "demo", textHash: "a".repeat(64) } });
  const add = async (published: boolean, kind: "PRELIMINARY" | "FINAL", year: number, owner = user.id) => {
    const edition = await db.olympiadEdition.upsert({ where: { year }, create: { year, title: "Учебная история" }, update: {} });
    let p = await db.participation.findUnique({ where: { userId_editionId: { userId: owner, editionId: edition.id } } });
    if (!p) { const c = owner === user.id ? consent : await db.consentRecord.create({ data: { userId: owner, purpose: "synthetic-demo-only", textVersion: "demo", textHash: "b".repeat(64) } }); p = await db.participation.create({ data: { editionId: edition.id, userId: owner, format: "REMOTE", remoteZone: "NSK", fullName: "Учебный участник", universityId: uni.id, universityName: uni.name, universityAbbreviation: uni.abbreviation, courseId: course.id, courseLabel: course.label, consentId: c.id } }); }
    const batch = await db.resultImportBatch.create({ data: { id: randomUUID(), editionId: edition.id, actorId: chief.id, kind, sourceHash: "a".repeat(64), importedCount: 1, rejectedCount: 0, report: [{ line: 2, error: null }] } });
    const result = await db.individualResult.create({ data: { editionId: edition.id, participationId: p.id, batchId: batch.id, kind, total: 0, prize: "Учебная номинация" } });
    await db.$transaction(async tx=>{
      const problem=await tx.editionProblem.upsert({where:{editionId_ordinal:{editionId:edition.id,ordinal:1}},create:{editionId:edition.id,ordinal:1},update:{}});
      await tx.resultProblemScore.create({data:{resultId:result.id,editionId:edition.id,problemId:problem.id,score:0}});
      await createIndividualDocuments(tx,edition.id,batch.id);
      if(published){await releaseOriginalBatch(tx,chief.id,edition.id,batch.id);await tx.resultPublication.create({data:{batchId:batch.id,actorId:chief.id,publishedAt:new Date("2020-01-01T00:00:00Z")}});}
    });
    return result;
  };
  return { user, other, chief, consent, add, year: serial++ };
}
test("F01 withdrawal is owner-only, idempotent under races and never deletes permanent history or grants operator powers", async () => {
  const f = await fixture(), result = await f.add(true, "FINAL", f.year);
  const id = randomUUID(), [a,b] = await Promise.all([requestConsentWithdrawal(db, f.user.id, { id, confirmed: true }), requestConsentWithdrawal(db, f.user.id, { id: randomUUID(), confirmed: true })]);
  assert.equal(a.id, b.id); assert.equal((await ownWithdrawalRequests(db, f.user.id)).length, 1); assert.equal((await ownWithdrawalRequests(db, f.other.id)).length, 0);
  await assert.rejects(requestConsentWithdrawal(db, f.other.id, { id: a.id, confirmed: true }));
  await assert.rejects(requestConsentWithdrawal(db, f.user.id, { id, confirmed: true, userId: f.other.id }));
  await assert.rejects(ownWithdrawalRequests(db, f.chief.id));
  assert.equal((await db.consentRecord.findUniqueOrThrow({ where: { id: f.consent.id } })).withdrawnAt, null);
  await markWithdrawalReviewed(db, a.id); await markWithdrawalReviewed(db, a.id);
  assert.ok((await ownWithdrawalRequests(db, f.user.id))[0].reviewedAt);
  assert.equal(await db.individualResult.count({ where: { id: result.id } }), 1);
  assert.equal((await personalHistory(db, f.user.id)).rows[0].prize, "Учебная номинация");
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: f.user.id } })).role, "STUDENT");
});
test("F01 history spans years, preserves zero/prize, excludes drafts/foreign owners and superseded preliminary", async () => {
  const f = await fixture();
  await f.add(true, "PRELIMINARY", f.year); await f.add(true, "FINAL", f.year);
  await f.add(false, "FINAL", f.year + 100); await f.add(true, "FINAL", f.year + 200, f.other.id);
  await f.add(true, "FINAL", f.year + 300);
  const history = await personalHistory(db, f.user.id);
  assert.equal(history.total, 2); assert.deepEqual(history.rows.map(r => r.year), [f.year + 300, f.year]);
  assert.ok(history.rows.every(r => r.kind === "FINAL" && r.total === 0));
  assert.ok(!JSON.stringify(history).includes(f.user.email));
  await assert.rejects(personalHistory(db, f.chief.id)); await assert.rejects(personalHistory(db, f.user.id, 0));
});
test("F01 audit retention is dry-run first, boundary-safe, atomic and preserves results/accounts/requests", async () => {
  const f = await fixture(); await f.add(true, "FINAL", f.year);
  const now = new Date(), cutoff = auditCutoff(now);
  const old = await db.auditEvent.create({ data: { action: "SYNTHETIC_OLD", objectType: "Test", objectId: randomUUID(), outcome: "SUCCESS", createdAt: new Date(cutoff.getTime() - 1) } });
  const boundary = await db.auditEvent.create({ data: { action: "SYNTHETIC_BOUNDARY", objectType: "Test", objectId: randomUUID(), outcome: "SUCCESS", createdAt: cutoff } });
  const plan = await auditRetention(db, false, now); assert.ok(plan.count >= 1); assert.ok(await db.auditEvent.findUnique({ where: { id: old.id } }));
  const broken = db.$extends({ query: { auditEvent: { async create() { throw new Error("Synthetic audit outage"); } } } });
  await assert.rejects(auditRetention(broken as unknown as PrismaClient, true, now));
  assert.ok(await db.auditEvent.findUnique({ where: { id: old.id } }));
  await auditRetention(db, true, now);
  assert.equal(await db.auditEvent.findUnique({ where: { id: old.id } }), null); assert.ok(await db.auditEvent.findUnique({ where: { id: boundary.id } }));
  assert.equal((await personalHistory(db, f.user.id)).total, 1);
  assert.ok(await db.user.findUnique({ where: { id: f.user.id } }));
  await assert.rejects(auditRetention(db, true, new Date(Date.now() + 86400000)));
});
