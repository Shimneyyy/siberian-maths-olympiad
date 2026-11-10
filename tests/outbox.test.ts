import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "../src/lib/pg-adapter";
import { randomUUID } from "node:crypto";
import { before, beforeEach, after, test } from "node:test";
import assert from "node:assert/strict";
import { enqueueEmail, processEmail, claimEmail, OUTBOX_LEASE_MS } from "../src/lib/outbox";
import { renderMailTemplate, InvalidMailTemplate } from "../src/lib/mail-template";
import { sendMail } from "../src/lib/mail-transport";
import { AccessDenied } from "../src/lib/access";
process.env.DEMO_REGISTRATION = "true";
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
async function fixture() {
  return db.$transaction(async tx => {
    const uni = await tx.university.create({ data: { name: "Учебный вуз очереди", abbreviation: "УО" } });
    const course = await tx.courseOption.create({ data: { label: "Учебный курс очереди" } });
    const edition = await tx.olympiadEdition.create({ data: { year: 7000, title: "Учебный выпуск очереди" } });
    const other = await tx.olympiadEdition.create({ data: { year: 7001, title: "Другой год очереди" } });
    const venue = await tx.venue.create({ data: { name: "Учебная площадка очереди" } });
    const site = await tx.editionVenue.create({ data: { venueId: venue.id, editionId: edition.id, address: "Учебный адрес" } });
    const secondVenue = await tx.venue.create({ data: { name: "Другая площадка очереди" } });
    const secondSite = await tx.editionVenue.create({ data: { venueId: secondVenue.id, editionId: edition.id, address: "Другой учебный адрес" } });
    const chief = await tx.user.create({ data: { name: "Учебный главный очереди", email: `${randomUUID()}@example.test`, emailVerified: true, role: "CHIEF_ORGANIZER" } });
    await tx.editionStaffGrant.create({ data: { userId: chief.id, editionId: edition.id } });
    const users = [], participations = [];
    for (let i=0;i<3;i++) {
      const user = await tx.user.create({ data: { name: `Учебный адресат ${i}`, email: `${randomUUID()}@example.test`, emailVerified: true } }); users.push(user);
      const consent = await tx.consentRecord.create({ data: { userId: user.id, purpose: "synthetic-demo-only", textVersion: "demo", textHash: "a".repeat(64) } });
      participations.push(await tx.participation.create({ data: { userId: user.id, editionId: i === 2 ? other.id : edition.id, format: "ONSITE", editionVenueId: i === 2 ? null : site.id, fullName: user.name, universityId: uni.id, universityName: uni.name, universityAbbreviation: uni.abbreviation, courseId: course.id, courseLabel: course.label, consentId: consent.id,
        ...(i === 2 ? { format: "REMOTE", remoteZone: "NSK" } : {}) } }));
    }
    return { uni, course, edition, other, venue, secondVenue, site, secondSite, chief, users, participations };
  });
}
let f: Awaited<ReturnType<typeof fixture>>;
before(async () => { f = await fixture(); });
beforeEach(async () => {
  await db.outboxJob.deleteMany({ where: { editionId: f.edition.id } });
  await db.outboxEvent.deleteMany({ where: { editionId: f.edition.id } });
  await db.editionStaffGrant.updateMany({ where: { userId: f.chief.id }, data: { revokedAt: null } });
  await db.participation.updateMany({ where: { id: { in: f.participations.slice(0,2).map(p => p.id) } }, data: { status: "REGISTERED", editionVenueId: f.site.id } });
});
after(async () => {
  if (f) {
    const editions = [f.edition.id, f.other.id], users = [f.chief.id, ...f.users.map(u => u.id)];
    await db.outboxJob.deleteMany({ where: { editionId: { in: editions } } });
    await db.outboxEvent.deleteMany({ where: { editionId: { in: editions } } });
    await db.participation.deleteMany({ where: { editionId: { in: editions } } });
    await db.auditEvent.deleteMany({ where: { OR: [{ editionId: { in: editions } }, { actorId: { in: users } }] } });
    await db.editionStaffGrant.deleteMany({ where: { editionId: { in: editions } } });
    await db.editionVenue.deleteMany({ where: { editionId: { in: editions } } });
    await db.venue.deleteMany({ where: { id: { in: [f.venue.id, f.secondVenue.id] } } });
    await db.olympiadEdition.deleteMany({ where: { id: { in: editions } } });
    await db.consentRecord.deleteMany({ where: { userId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.university.delete({ where: { id: f.uni.id } }); await db.courseOption.delete({ where: { id: f.course.id } });
  }
  await db.$disconnect();
});
const event = () => ({ kind: "MAIL_BATCH", sourceId: randomUUID(), sourceRevision: 1, editionId: f.edition.id, editionVenueId: null as string | null, subjectTemplate: "Учебное уведомление {{year}}", bodyTemplate: "{{name}} / {{university}} / {{team}} / {{venue}}" });
const enqueue = (raw = event(), ids = [f.participations[0].id]) => db.$transaction(tx => enqueueEmail(tx, f.chief.id, raw, ids));
const clock = () => { let now = new Date(Date.now()+1000); return { now: () => now, set: (date: Date) => { now = date; } }; };

test("outbox rolls back with the domain mutation, deduplicates source revisions and rejects foreign recipients", async () => {
  const source = event(); const before = await db.olympiadEdition.findUniqueOrThrow({ where: { id: f.edition.id } });
  const rollback = new Error("fixture rollback");
  await assert.rejects(db.$transaction(async tx => {
    await tx.olympiadEdition.update({ where: { id: f.edition.id }, data: { revision: { increment: 1 } } });
    await enqueueEmail(tx, f.chief.id, source, [f.participations[0].id]); throw rollback;
  }), error => error === rollback);
  assert.equal(await db.outboxEvent.count({ where: { editionId: f.edition.id } }), 0);
  assert.equal((await db.olympiadEdition.findUniqueOrThrow({ where: { id: f.edition.id } })).revision, before.revision);
  const first = await enqueue(source); const repeated = await enqueue(source);
  assert.equal(first.eventId, repeated.eventId); assert.equal(repeated.count, 1);
  await assert.rejects(enqueue(event(), [f.participations[2].id]), AccessDenied);
  await assert.rejects(db.$transaction(tx => enqueueEmail(tx, f.users[0].id, event(), [f.participations[0].id])), AccessDenied);
});

test("template variables are allowlisted and inserted values are never interpreted again", async () => {
  await assert.rejects(enqueue({ ...event(), bodyTemplate: "{{password}}" }), InvalidMailTemplate);
  const values = { name: "{{password}}\r\nBcc:fixture", year: "7000", university: "Вуз", team: "", venue: "Площадка" };
  assert.equal(renderMailTemplate("{{name}}", values), "{{password}}  Bcc:fixture");
  assert.ok(!renderMailTemplate("Тема {{name}}", values, true).includes("\n"));
  assert.throws(() => renderMailTemplate("{{unknown}}", values), InvalidMailTemplate);
});

test("SMTP failure retries on schedule, stores only fixed error codes, and eventually becomes failed", async () => {
  await enqueue(); const time = clock(); let calls = 0;
  const failing = async () => { calls++; throw new Error("SENSITIVE_NOT_TO_STORE password@example.test"); };
  assert.equal(await processEmail(db, failing, time.now), "READY");
  assert.equal(await processEmail(db, failing, time.now), "EMPTY");
  for (let i=1;i<5;i++) {
    const job = await db.outboxJob.findFirstOrThrow({ where: { editionId: f.edition.id } });
    time.set(new Date(job.availableAt.getTime()+1));
    assert.equal(await processEmail(db, failing, time.now), i===4 ? "FAILED" : "READY");
  }
  const job = await db.outboxJob.findFirstOrThrow({ where: { editionId: f.edition.id } });
  assert.equal(job.attempts, 5); assert.equal(calls, 5); assert.equal(job.lastErrorCode, "SMTP_FAILURE");
  assert.ok(!JSON.stringify(job).includes("SENSITIVE_NOT_TO_STORE")); assert.equal(job.leaseToken, null);
});

test("a crashed lease is reclaimed and an old worker cannot overwrite a newer receipt", async () => {
  await enqueue(); const time = clock();
  let started!: () => void, release!: (value: { messageId: string }) => void;
  const begin = new Promise<void>(resolve => { started = resolve; });
  const stale = processEmail(db, async () => { started(); return new Promise<{ messageId: string }>(resolve => { release = resolve; }); }, time.now);
  await begin; time.set(new Date(time.now().getTime()+OUTBOX_LEASE_MS+1));
  assert.equal(await processEmail(db, async () => ({ messageId: "new-worker-receipt" }), time.now), "SENT");
  release({ messageId: "old-worker-receipt" }); assert.equal(await stale, "STALE");
  const job = await db.outboxJob.findFirstOrThrow({ where: { editionId: f.edition.id } });
  assert.equal(job.attempts, 2); assert.equal(job.providerMessageId, "new-worker-receipt");
});

test("parallel workers claim distinct jobs and exhausted crashed leases enter the error queue", async () => {
  await enqueue(event(), f.participations.slice(0,2).map(p => p.id)); const time = clock();
  const claims = await Promise.all([claimEmail(db, time.now()), claimEmail(db, time.now())]);
  assert.ok(claims[0] && claims[1]); assert.notEqual(claims[0].id, claims[1].id);
  await db.outboxJob.updateMany({ where: { editionId: f.edition.id }, data: { attempts: 5, leaseUntil: new Date(time.now().getTime()-1) } });
  assert.equal(await processEmail(db, async () => ({ messageId: "unused" }), time.now), "EMPTY");
  assert.equal(await db.outboxJob.count({ where: { editionId: f.edition.id, status: "FAILED", lastErrorCode: "LEASE_EXHAUSTED" } }), 2);
});

test("revoked senders and changed venue audience stop unsent messages", async () => {
  await enqueue(); const time = clock(); let calls = 0;
  await db.editionStaffGrant.updateMany({ where: { userId: f.chief.id }, data: { revokedAt: new Date() } });
  assert.equal(await processEmail(db, async () => { calls++; return {}; }, time.now), "CANCELLED"); assert.equal(calls, 0);
  await db.editionStaffGrant.updateMany({ where: { userId: f.chief.id }, data: { revokedAt: null } });
  await enqueue({ ...event(), editionVenueId: f.site.id });
  await db.participation.update({ where: { id: f.participations[0].id }, data: { editionVenueId: f.secondSite.id } });
  assert.equal(await processEmail(db, async () => { calls++; return {}; }, time.now), "CANCELLED"); assert.equal(calls, 0);
});

test("cancelled participants receive rendered mail through the real local SMTP sandbox", async () => {
  const source = { ...event(), subjectTemplate: `Учебное письмо ${randomUUID()} {{year}}` };
  await db.participation.update({ where: { id: f.participations[0].id }, data: { status: "CANCELLED" } });
  const queued = await enqueue(source); assert.equal(queued.count, 1);
  assert.equal(await processEmail(db, sendMail, clock().now), "SENT");
  const search = await (await fetch(`http://127.0.0.1:8025/api/v1/search?query=${encodeURIComponent(`to:${f.users[0].email}`)}`)).json() as { messages: { ID: string }[] };
  assert.ok(search.messages.length);
  const mail = await (await fetch(`http://127.0.0.1:8025/api/v1/message/${search.messages[0].ID}`)).json() as { Text: string };
  assert.ok(mail.Text.includes(f.participations[0].fullName)); assert.ok(mail.Text.includes(f.uni.name));
  assert.ok(!mail.Text.includes("{{year}}"));
  const job = await db.outboxJob.findFirstOrThrow({ where: { eventId: queued.eventId } });
  assert.equal(job.status, "SENT"); assert.ok(job.providerMessageId);
});
