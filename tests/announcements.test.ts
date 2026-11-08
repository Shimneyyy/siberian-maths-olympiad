import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword } from "better-auth/crypto";
import { saveAnnouncement, publishAnnouncement, announcementsView } from "../src/lib/announcements";
process.env.DEMO_REGISTRATION = "true";
const schema = `announcement_${randomUUID().replaceAll("-", "")}`;
const connection = process.env.DATABASE_URL!;
const sql = new Client({ connectionString: connection });
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: connection, options: `-c search_path=${schema}` }, { schema }) });
const password = `Synthetic-${randomUUID()}`;
let chief: string, student: string, outsider: string, edition: string, foreign: string, site: string;
before(async () => {
  await sql.connect(); await sql.query(`CREATE SCHEMA "${schema}"`); await sql.query(`SET search_path TO "${schema}"`);
  for (const m of (await readdir("prisma/migrations")).filter(x => /^\d/.test(x)).sort()) await sql.query(await readFile(`prisma/migrations/${m}/migration.sql`, "utf8"));
  edition = (await db.olympiadEdition.create({ data: { year: 8000, title: "Учебные объявления" } })).id;
  foreign = (await db.olympiadEdition.create({ data: { year: 8001, title: "Другие объявления" } })).id;
  const uni = await db.university.create({ data: { name: "Учебный вуз", abbreviation: "УВ" } });
  const course = await db.courseOption.create({ data: { label: "Учебный курс" } });
  chief = (await db.user.create({ data: { email: `${randomUUID()}@example.test`, name: "Учебный главный", role: "CHIEF_ORGANIZER", emailVerified: true, twoFactorEnabled: true } })).id;
  await db.account.create({ data: { userId: chief, accountId: chief, providerId: "credential", password: await hashPassword(password) } });
  await db.editionStaffGrant.create({ data: { userId: chief, editionId: edition } });
  for (let i=0; i<2; i++) {
    const venue = await db.venue.create({ data: { name: "Учебная площадка" } });
    const v = await db.editionVenue.create({ data: { editionId: edition, venueId: venue.id, address: "Учебный адрес" } });
    if (i === 0) site = v.id;
    const u = await db.user.create({ data: { email: `${randomUUID()}@example.test`, name: "Учебный участник", emailVerified: true } });
    if (i === 0) student = u.id; else outsider = u.id;
    const consent = await db.consentRecord.create({ data: { userId: u.id, purpose: "synthetic-demo-only", textVersion: "demo", textHash: "a".repeat(64) } });
    await db.participation.create({ data: { userId: u.id, editionId: edition, editionVenueId: v.id, status: i === 0 ? "CANCELLED" : "REGISTERED", format: "ONSITE", fullName: u.name, universityId: uni.id, universityName: uni.name, universityAbbreviation: uni.abbreviation, courseId: course.id, courseLabel: course.label, consentId: consent.id } });
  }
});
after(async () => { await db.$disconnect(); await sql.query('SET search_path TO public'); await sql.query(`DROP SCHEMA "${schema}" CASCADE`); await sql.end(); });
const input = () => ({ editionId: edition, editionVenueId: site, title: "Учебное объявление", body: "<script>не HTML</script>", important: true, password });
async function fresh() { await db.rateLimit.deleteMany(); return saveAnnouncement(db, chief, input()); }
test("draft is private; important publication includes cancelled recipients only in its venue and deduplicates concurrent retries", async () => {
  const draft = await fresh();
  assert.equal((await announcementsView(db, student, { editionId: edition })).length, 0);
  assert.equal((await announcementsView(db, chief, { editionId: edition })).some(x => x.id === draft.id), true);
  const publish = { editionId: edition, id: draft.id, revision: draft.revision, confirm: true, password };
  await Promise.all([publishAnnouncement(db, chief, publish), publishAnnouncement(db, chief, publish)]);
  assert.equal((await announcementsView(db, student, { editionId: edition })).some(x => x.id === draft.id), true);
  assert.equal((await announcementsView(db, outsider, { editionId: edition })).some(x => x.id === draft.id), false);
  const event = await db.outboxEvent.findFirstOrThrow({ where: { sourceId: draft.id }, include: { jobs: true } });
  assert.equal(event.jobs.length, 1);
  assert.equal(await db.outboxEvent.count({ where: { sourceId: draft.id } }), 1);
  assert.ok(!JSON.stringify(event).includes("<script>"));
});
test("published content cannot be edited or deleted, even through SQL; stale drafts conflict", async () => {
  const draft = await fresh();
  const saved = await saveAnnouncement(db, chief, { ...input(), id: draft.id, revision: draft.revision, title: "Исправленный черновик" });
  await assert.rejects(saveAnnouncement(db, chief, { ...input(), id: draft.id, revision: draft.revision }));
  await assert.rejects(publishAnnouncement(db, chief, { editionId: edition, id: draft.id, revision: draft.revision, confirm: true, password }));
  await db.rateLimit.deleteMany();
  await publishAnnouncement(db, chief, { editionId: edition, id: draft.id, revision: saved.revision, confirm: true, password });
  await assert.rejects(saveAnnouncement(db, chief, { ...input(), id: draft.id, revision: saved.revision + 1 }));
  await assert.rejects(db.announcement.update({ where: { id: draft.id }, data: { body: "Замена" } }));
  await assert.rejects(db.announcement.delete({ where: { id: draft.id } }));
});
test("ordinary year-wide publication has no mail, is visible to all participants and cannot leak to another year", async () => {
  await db.rateLimit.deleteMany();
  const draft = await saveAnnouncement(db, chief, { ...input(), editionVenueId: null, important: false });
  await publishAnnouncement(db, chief, { editionId: edition, id: draft.id, revision: 0, confirm: true, password });
  assert.equal(await db.outboxEvent.count({ where: { sourceId: draft.id } }), 0);
  for (const actor of [student, outsider]) assert.ok((await announcementsView(db, actor, { editionId: edition })).some(x => x.id === draft.id));
  await assert.rejects(announcementsView(db, student, { editionId: foreign }));
  await assert.rejects(announcementsView(db, chief, { editionId: foreign }));
});
test("roles, MFA, wrong password, revoked grants and spoofed actor are denied", async () => {
  const draft = await fresh();
  await assert.rejects(saveAnnouncement(db, student, input()));
  await assert.rejects(saveAnnouncement(db, chief, { ...input(), actorId: student }));
  await assert.rejects(saveAnnouncement(db, chief, { ...input(), password: "wrong" }));
  await db.user.update({ where: { id: chief }, data: { twoFactorEnabled: false } });
  await assert.rejects(saveAnnouncement(db, chief, input()));
  await db.user.update({ where: { id: chief }, data: { twoFactorEnabled: true } });
  await db.editionStaffGrant.update({ where: { userId_editionId: { userId: chief, editionId: edition } }, data: { revokedAt: new Date() } });
  await assert.rejects(publishAnnouncement(db, chief, { editionId: edition, id: draft.id, revision: 0, confirm: true, password }));
  await assert.rejects(announcementsView(db, chief, { editionId: edition }));
  assert.equal((await db.announcement.findUniqueOrThrow({ where: { id: draft.id } })).publishedAt, null);
  await db.editionStaffGrant.update({ where: { userId_editionId: { userId: chief, editionId: edition } }, data: { revokedAt: null } });
});
test("invalid audience and missing confirmation reject atomically; reauthentication is bounded and audit excludes content", async () => {
  const draft = await fresh();
  await assert.rejects(saveAnnouncement(db, chief, { ...input(), editionId: foreign }));
  await assert.rejects(publishAnnouncement(db, chief, { editionId: edition, id: draft.id, revision: 0, confirm: false, password }));
  assert.equal(await db.outboxEvent.count({ where: { sourceId: draft.id } }), 0);
  await db.rateLimit.deleteMany();
  for(let i=0;i<5;i++) await assert.rejects(saveAnnouncement(db, chief, { ...input(), password: "wrong" }));
  await assert.rejects(saveAnnouncement(db, chief, input()), e => (e as Error).constructor.name === "AdminRateLimit");
  const audit = JSON.stringify(await db.auditEvent.findMany());
  assert.ok(!audit.includes(input().body)); assert.ok(!audit.includes(password));
});
test("outbox failure rolls publication and audit back; cross-year audience is rejected by FK", async () => {
  const draft = await fresh();
  const broken = db.$extends({ query: { outboxEvent: { async create() { throw new Error("Synthetic outbox outage"); } } } });
  await assert.rejects(publishAnnouncement(broken as unknown as PrismaClient, chief, { editionId: edition, id: draft.id, revision: 0, confirm: true, password }));
  assert.equal((await db.announcement.findUniqueOrThrow({ where: { id: draft.id } })).publishedAt, null);
  assert.equal(await db.auditEvent.count({ where: { objectId: draft.id, action: "ANNOUNCEMENT_PUBLISHED" } }), 0);
  assert.equal(await db.outboxEvent.count({ where: { sourceId: draft.id } }), 0);
  await assert.rejects(db.announcement.create({ data: { editionId: foreign, editionVenueId: site, authorId: chief, title: "Учебный отказ", body: "Учебный текст" } }));
  for (const role of ["TECHNICAL_ADMIN", "VENUE_ORGANIZER"] as const) {
    const user = await db.user.create({ data: { name: "Учебный отказ", email: `${randomUUID()}@example.test`, emailVerified: true, twoFactorEnabled: true, role } });
    await assert.rejects(saveAnnouncement(db, user.id, input()));
    await assert.rejects(announcementsView(db, user.id, { editionId: edition }));
  }
});
