import "dotenv/config";
import { hashPassword } from "better-auth/crypto";
import { AdminRateLimit, saveRegistrationWindow } from "../src/lib/admin";
import { PrismaClient, type Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { randomUUID, createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { AccessDenied } from "../src/lib/access";
import { saveEdition, createEditionVenue, saveEditionVenue, registerParticipation } from "../src/lib/olympiad";
import { registrationState, OlympiadError } from "../src/lib/olympiad-rules";
import { studentOlympiadView } from "../src/lib/olympiad-view";
process.env.DEMO_REGISTRATION = "true";
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
after(() => db.$disconnect());
const exec = promisify(execFile);
const hasCode = (code: string) => (error: unknown) => error instanceof OlympiadError && error.code === code;
const opens = new Date("2026-11-14T17:00:00Z"); // 15 November, 00:00 Novosibirsk.
const closes = new Date("2026-11-30T17:00:00Z");
async function fixture(year: number) {
  return db.$transaction(async (tx) => {
    const university = await tx.university.create({ data: { name: "Синтетический университет", abbreviation: "СИНТ" } });
    const course = await tx.courseOption.create({ data: { label: "Синтетический первый курс" } });
    const nextCourse = await tx.courseOption.create({ data: { label: "Синтетический второй курс" } });
    const student = async (suffix: string) => {
      const u = await tx.user.create({ data: { name: `Синтетический участник ${suffix}`, email: `${randomUUID()}@example.test`, emailVerified: true } });
      await tx.studentProfile.create({ data: { userId: u.id, fullName: u.name, universityId: university.id, courseId: course.id } });
      const consent = await tx.consentRecord.create({ data: { userId: u.id, purpose: "synthetic-demo-only", textVersion: "demo-only-v1", textHash: createHash("sha256").update("synthetic fixture").digest("hex") } });
      return { ...u, consentId: consent.id };
    };
    const a = await student("А"), b = await student("Б");
    const chief = await tx.user.create({ data: { name: "Синтетический главный организатор", email: `${randomUUID()}@example.test`, role: "CHIEF_ORGANIZER", emailVerified: true, twoFactorEnabled: true } });
    const admin = await tx.user.create({ data: { name: "Тестовый администратор", email: `${randomUUID()}@example.test`, role: "TECHNICAL_ADMIN", emailVerified: true, twoFactorEnabled: true } });
    await tx.account.create({ data: { accountId: admin.id, userId: admin.id, providerId: "credential", password: await hashPassword("Synthetic-admin-password") } });
    const staff = await tx.user.create({ data: { name: "Синтетический организатор", email: `${randomUUID()}@example.test`, role: "VENUE_ORGANIZER", emailVerified: true, twoFactorEnabled: true } });
    const schedule = { registrationOpensAt: opens, registrationClosesAt: closes };
    const first = await tx.olympiadEdition.create({ data: { year, title: "Тестовый выпуск", ...schedule } });
    const next = await tx.olympiadEdition.create({ data: { year: year + 1, title: "Следующий выпуск", ...schedule } });
    await tx.editionStaffGrant.create({ data: { userId: chief.id, editionId: first.id } });
    const venue = await tx.venue.create({ data: { name: "Синтетическая площадка" } });
    const alternate = await tx.venue.create({ data: { name: "Синтетическая вторая площадка" } });
    const site = await tx.editionVenue.create({ data: { editionId: first.id, venueId: venue.id, label: "Площадка первого года", address: "Синтетический адрес первого года" } });
    const otherSite = await tx.editionVenue.create({ data: { editionId: first.id, venueId: alternate.id, label: "Другая площадка", address: "Синтетический адрес" } });
    const nextSite = await tx.editionVenue.create({ data: { editionId: next.id, venueId: venue.id, label: "Площадка второго года", address: "Синтетический адрес второго года" } });
    return { university, course, nextCourse, a, b, chief, admin, staff, first, next, site, otherSite, nextSite };
  });
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function clean(f: Fixture) {
  await db.$transaction(async (tx) => {
    const years = [f.first.id, f.next.id], users = [f.a.id, f.b.id, f.chief.id, f.staff.id, f.admin.id];
    const venues = await tx.editionVenue.findMany({ where: { editionId: { in: years } }, select: { venueId: true } });
    await tx.participation.deleteMany({ where: { editionId: { in: years } } });
    await tx.auditEvent.deleteMany({ where: { OR: [{ editionId: { in: years } }, { actorId: { in: users } }] } });
    await tx.venueStaffAssignment.deleteMany({ where: { editionId: { in: years } } });
    await tx.editionVenue.deleteMany({ where: { editionId: { in: years } } });
    await tx.venue.deleteMany({ where: { id: { in: venues.map((v) => v.venueId) } } });
    await tx.editionStaffGrant.deleteMany({ where: { editionId: { in: years } } });
    await tx.olympiadEdition.deleteMany({ where: { id: { in: years } } });
    await tx.studentProfile.deleteMany({ where: { userId: { in: users } } });
    await tx.consentRecord.deleteMany({ where: { userId: { in: users } } });
    await tx.rateLimit.deleteMany({ where: { key: { in: users.flatMap(id => [`admin-reauth:${id}`, `correction-reauth:${id}`]) } } });
    await tx.user.deleteMany({ where: { id: { in: users } } });
    await tx.courseOption.deleteMany({ where: { id: { in: [f.course.id, f.nextCourse.id] } } });
    await tx.university.delete({ where: { id: f.university.id } });
  });
}
const settings = (f: Fixture, revision = 0) => ({ editionId: f.first.id, revision, title: f.first.title, registrationOpensAt: opens.toISOString(), registrationClosesAt: closes.toISOString(), registrationManuallyClosed: false, isCurrent: false });
const registration = (f: Fixture) => ({ editionId: f.first.id, format: "ONSITE" as const, editionVenueId: f.site.id, fullName: f.a.name, universityId: f.university.id, courseId: f.course.id });
const siteSettings = (f: Fixture, active: boolean, revision = 0) => ({ editionId: f.first.id, editionVenueId: f.site.id, revision, label: "Изменённая тестовая площадка", address: "Изменённый синтетический адрес", room: "Тест", instructions: "Тестовые правила", active });

test("registration window includes opening and excludes closing; manual closure wins", () => {
  const e = { registrationOpensAt: opens, registrationClosesAt: closes, registrationManuallyClosed: false };
  assert.equal(registrationState(e, new Date(opens.getTime() - 1)), "UPCOMING");
  assert.equal(registrationState(e, opens), "OPEN");
  assert.equal(registrationState(e, new Date(closes.getTime() - 1)), "OPEN");
  assert.equal(registrationState(e, closes), "CLOSED");
  assert.equal(registrationState({ ...e, registrationManuallyClosed: true }, opens), "MANUALLY_CLOSED");
  assert.equal(registrationState({ ...e, registrationOpensAt: null, registrationClosesAt: null }, opens), "UNCONFIGURED");
});

test("edition changes require scope, detect stale forms and preserve a single current year", async () => {
  const f = await fixture(6400);
  try {
    await assert.rejects(saveEdition(db, f.staff.id, settings(f)), AccessDenied);
    await assert.rejects(saveEdition(db, f.chief.id, { ...settings(f), editionId: f.next.id }), AccessDenied);
    await saveEdition(db, f.chief.id, { ...settings(f), isCurrent: true });
    const audit = await db.auditEvent.findFirstOrThrow({ where: { editionId: f.first.id, action: "EDITION_SETTINGS_UPDATED" } });
    assert.ok(JSON.stringify(audit.details).includes(opens.toISOString()));
    assert.ok(!JSON.stringify(audit).includes(f.chief.email));
    await assert.rejects(saveEdition(db, f.chief.id, settings(f)), hasCode("CONFLICT"));
    await assert.rejects(saveEdition(db, f.chief.id, settings(f, 1)), hasCode("CONFLICT"));
    await db.editionStaffGrant.create({ data: { userId: f.chief.id, editionId: f.next.id } });
    await saveEdition(db, f.chief.id, { ...settings(f), editionId: f.next.id, isCurrent: true });
    assert.equal((await db.olympiadEdition.findUniqueOrThrow({ where: { id: f.first.id } })).isCurrent, false);
    assert.equal((await db.olympiadEdition.findUniqueOrThrow({ where: { id: f.next.id } })).isCurrent, true);
    await assert.rejects(db.olympiadEdition.update({ where: { id: f.first.id }, data: { isCurrent: true } }));
    await assert.rejects(db.olympiadEdition.update({ where: { id: f.first.id }, data: { registrationOpensAt: closes } }));
  } finally { await clean(f); }
});

test("venue disable preserves participants, rejects new entries and does not change other years", async () => {
  const f = await fixture(6402);
  try {
    const p = await registerParticipation(db, f.a.id, registration(f), () => opens);
    await saveEditionVenue(db, f.chief.id, siteSettings(f, false));
    assert.equal(await db.participation.count({ where: { id: p.id } }), 1);
    assert.equal((await registerParticipation(db, f.a.id, registration(f), () => closes)).id, p.id);
    await assert.rejects(registerParticipation(db, f.b.id, { ...registration(f), fullName: f.b.name }, () => opens), hasCode("INVALID_VENUE"));
    const next = await db.editionVenue.findUniqueOrThrow({ where: { id: f.nextSite.id } });
    assert.equal(next.address, f.nextSite.address);
    assert.equal(next.label, f.nextSite.label);
    await assert.rejects(saveEditionVenue(db, f.chief.id, siteSettings(f, true)), hasCode("CONFLICT"));
    await assert.rejects(saveEditionVenue(db, f.staff.id, siteSettings(f, true, 1)), AccessDenied);
    await assert.rejects(createEditionVenue(db, f.chief.id, { editionId: f.next.id, label: "Нет прав", address: "Тест" }), AccessDenied);
    const added = await createEditionVenue(db, f.chief.id, { editionId: f.first.id, label: "Дополнительная", address: "Тест" });
    assert.equal(added.editionId, f.first.id);
    const view = await studentOlympiadView(db, f.a.id);
    assert.equal(view.participations[0].venue?.active, false);
    assert.ok(!view.editions.find((e) => e.id === f.first.id)?.venues.some((v) => v.id === f.site.id));
  } finally { await clean(f); }
});

test("new annual confirmation updates current profile but leaves historical snapshots private and intact", async () => {
  const f = await fixture(6404);
  try {
    const first = await registerParticipation(db, f.a.id, registration(f), () => opens);
    await registerParticipation(db, f.a.id, { editionId: f.next.id, format: "REMOTE", remoteZone: "NSK", fullName: "Синтетическое обновлённое ФИО", universityId: f.university.id, courseId: f.nextCourse.id }, () => opens);
    await registerParticipation(db, f.b.id, { editionId: f.first.id, format: "REMOTE", remoteZone: "MSK", fullName: "Чужой синтетический участник", universityId: f.university.id, courseId: f.course.id }, () => opens);
    const old = await db.participation.findUniqueOrThrow({ where: { id: first.id } });
    assert.equal(old.fullName, f.a.name); assert.equal(old.courseLabel, f.course.label);
    assert.equal((await db.studentProfile.findUniqueOrThrow({ where: { userId: f.a.id } })).courseId, f.nextCourse.id);
    const view = await studentOlympiadView(db, f.a.id);
    assert.equal(view.participations.length, 2);
    assert.ok(!JSON.stringify(view).includes("Чужой синтетический участник"));
    assert.ok(!JSON.stringify(view).includes(f.a.consentId));
    await assert.rejects(studentOlympiadView(db, f.chief.id), AccessDenied);
  } finally { await clean(f); }
});

test("parallel signup is idempotent; changing venue, mixed formats and cross-year references fail", async () => {
  const f = await fixture(6406);
  try {
    const results = await Promise.all(Array.from({ length: 8 }, () => registerParticipation(db, f.a.id, registration(f), () => opens)));
    assert.equal(new Set(results.map((p) => p.id)).size, 1);
    assert.equal(await db.auditEvent.count({ where: { actorId: f.a.id, action: "PARTICIPATION_REGISTERED" } }), 1);
    await assert.rejects(registerParticipation(db, f.a.id, { ...registration(f), editionVenueId: f.otherSite.id }, () => opens), hasCode("ALREADY_REGISTERED"));
    await assert.rejects(registerParticipation(db, f.b.id, { ...registration(f), editionVenueId: f.nextSite.id }, () => opens), hasCode("INVALID_VENUE"));
    await assert.rejects(registerParticipation(db, f.b.id, { ...registration(f), format: "REMOTE", remoteZone: "MSK" }, () => opens));
    const data: Prisma.ParticipationUncheckedCreateInput = { ...results[0], id: randomUUID(), userId: f.b.id, consentId: f.b.consentId };
    await assert.rejects(db.participation.create({ data: { ...data, consentId: f.a.consentId } }));
    await assert.rejects(db.participation.create({ data: { ...data, editionVenueId: f.nextSite.id } }));
    await assert.rejects(db.participation.create({ data: { ...data, format: "REMOTE", remoteZone: "NSK" } }));
    assert.equal(await db.participation.count({ where: { userId: f.b.id } }), 0);
  } finally { await clean(f); }
});

test("service checks actual server acceptance time and manual closure inside the transaction", async () => {
  const f = await fixture(6408);
  try {
    await assert.rejects(registerParticipation(db, f.a.id, registration(f), () => new Date(opens.getTime() - 1)), hasCode("REGISTRATION_CLOSED"));
    await registerParticipation(db, f.a.id, registration(f), () => opens);
    await assert.rejects(registerParticipation(db, f.b.id, { ...registration(f), fullName: f.b.name }, () => closes), hasCode("REGISTRATION_CLOSED"));
    await saveRegistrationWindow(db, f.admin.id, { editionId: f.first.id, revision: 0, registrationOpensAt: opens.toISOString(), registrationClosesAt: closes.toISOString(), registrationManuallyClosed: true, password: "Synthetic-admin-password" });
    await assert.rejects(registerParticipation(db, f.b.id, { ...registration(f), fullName: f.b.name }, () => opens), hasCode("REGISTRATION_CLOSED"));
    await saveRegistrationWindow(db, f.admin.id, { editionId: f.first.id, revision: 1, registrationOpensAt: opens.toISOString(), registrationClosesAt: closes.toISOString(), registrationManuallyClosed: false, password: "Synthetic-admin-password" });
    await registerParticipation(db, f.b.id, { ...registration(f), fullName: f.b.name }, () => opens);
  } finally { await clean(f); }
});

test("edition provisioning CLI is repeatable and does not overwrite schedules or grant rights", async () => {
  const year = 6410;
  try {
    const invoke = () => exec(process.execPath, ["--import", "tsx", "scripts/create-edition.ts", String(year), "Тестовый выпуск CLI"]);
    await invoke();
    const first = await db.olympiadEdition.findUniqueOrThrow({ where: { year } });
    await db.olympiadEdition.update({ where: { id: first.id }, data: { registrationManuallyClosed: true } });
    await invoke();
    const second = await db.olympiadEdition.findUniqueOrThrow({ where: { year } });
    assert.equal(first.id, second.id); assert.equal(second.registrationManuallyClosed, true);
    assert.equal(await db.editionStaffGrant.count({ where: { editionId: first.id } }), 0);
  } finally {
    const e = await db.olympiadEdition.findUnique({ where: { year } });
    if (e) { await db.auditEvent.deleteMany({ where: { editionId: e.id } }); await db.olympiadEdition.delete({ where: { id: e.id } }); }
  }
});

test("current profile edits cannot alter annual snapshots, email or role and reject stale versions", async () => {
  const { profileView, saveProfile } = await import("../src/lib/corrections");
  const f = await fixture(6414);
  try {
    await registerParticipation(db, f.a.id, registration(f), () => opens);
    const before = await db.participation.findUniqueOrThrow({ where: { userId_editionId: { userId: f.a.id, editionId: f.first.id } } });
    const profile = await profileView(db, f.a.id);
    const input = { fullName: "Изменённый учебный профиль", universityId: profile.universityId, courseId: f.nextCourse.id, revision: profile.revision };
    await assert.rejects(saveProfile(db, f.chief.id, input), AccessDenied);
    await assert.rejects(saveProfile(db, f.a.id, { ...input, role: "TECHNICAL_ADMIN" }));
    await assert.rejects(saveProfile(db, f.a.id, { ...input, userId: f.b.id }));
    await saveProfile(db, f.a.id, input);
    assert.deepEqual(await db.participation.findUniqueOrThrow({ where: { id: before.id } }), before);
    const actor = await db.user.findUniqueOrThrow({ where: { id: f.a.id } });
    assert.equal(actor.name, input.fullName); assert.equal(actor.role, "STUDENT"); assert.equal(actor.email, f.a.email);
    await assert.rejects(saveProfile(db, f.a.id, input), hasCode("CONFLICT"));
  } finally { await clean(f); }
});

test("annual correction enforces deadline/manual close, owner, chief reason/password and preserves other years", async () => {
  const { correctParticipation, correctionView } = await import("../src/lib/corrections");
  const f = await fixture(6416);
  const password = "Synthetic-correction-password";
  try {
    const first = await registerParticipation(db, f.a.id, registration(f), () => opens);
    const next = await registerParticipation(db, f.a.id, { ...registration(f), editionId: f.next.id, editionVenueId: f.nextSite.id }, () => opens);
    const input = { editionId: f.first.id, participationId: first.id, revision: 0, fullName: "Исправленное учебное имя", universityId: f.university.id, courseId: f.nextCourse.id };
    await db.account.create({ data: { userId: f.chief.id, accountId: f.chief.id, providerId: "credential", password: await hashPassword(password) } });
    for (const actor of [f.b, f.staff, f.admin]) await assert.rejects(correctParticipation(db, actor.id, input, () => opens), AccessDenied);
    await assert.rejects(correctParticipation(db, f.chief.id, { ...input, reason: "Учебная ошибка", password }, () => opens), AccessDenied);
    await assert.rejects(correctParticipation(db, f.a.id, { ...input, editionVenueId: f.otherSite.id }, () => opens));
    const competing = await Promise.allSettled([correctParticipation(db, f.a.id, input, () => opens), correctParticipation(db, f.a.id, input, () => opens)]);
    assert.equal(competing.filter(x => x.status === "fulfilled").length, 1);
    assert.equal((competing.find(x => x.status === "rejected") as PromiseRejectedResult).reason.code, "CONFLICT");
    assert.deepEqual(await db.participation.findUniqueOrThrow({ where: { id: next.id } }), next);
    const changed = await db.participation.findUniqueOrThrow({ where: { id: first.id } });
    assert.equal(changed.fullName, input.fullName); assert.equal(changed.courseLabel, f.nextCourse.label); assert.equal(changed.editionVenueId, first.editionVenueId);
    await assert.rejects(correctParticipation(db, f.a.id, { ...input, revision: 1 }, () => closes), AccessDenied);
    await db.olympiadEdition.update({ where: { id: f.first.id }, data: { registrationManuallyClosed: true } });
    await assert.rejects(correctionView(db, f.a.id, f.first.id, first.id), AccessDenied);
    await assert.rejects(correctParticipation(db, f.a.id, { ...input, revision: 1 }, () => opens), AccessDenied);
    await assert.rejects(correctParticipation(db, f.chief.id, { ...input, revision: 1 }, () => opens), AccessDenied);
    await assert.rejects(correctParticipation(db, f.chief.id, { ...input, revision: 1, reason: "Учебная ошибка", password: "wrong" }, () => opens), AccessDenied);
    const profileBefore = await db.studentProfile.findUniqueOrThrow({ where: { userId: f.a.id } });
    await correctParticipation(db, f.chief.id, { ...input, revision: 1, fullName: "Учебная правка организатора", reason: "Учебная причина", password }, () => opens);
    assert.deepEqual(await db.studentProfile.findUniqueOrThrow({ where: { userId: f.a.id } }), profileBefore);
    assert.deepEqual(await db.participation.findUniqueOrThrow({ where: { id: next.id } }), next);
    assert.equal(await db.participationCorrection.count({ where: { participationId: first.id } }), 1);
    const audit = await db.auditEvent.findMany({ where: { action: "PARTICIPATION_CORRECTED", editionId: f.first.id } });
    assert.equal(audit.length, 2); assert.ok(!JSON.stringify(audit).includes("Учебная причина")); assert.ok(!JSON.stringify(audit).includes(input.fullName));
    for (let i=0;i<3;i++) await assert.rejects(correctParticipation(db, f.chief.id, { ...input, revision: 2, reason: "Учебная ошибка", password: "wrong" }, () => opens), AccessDenied);
    await assert.rejects(correctParticipation(db, f.chief.id, { ...input, revision: 2, reason: "Учебная ошибка", password }, () => opens), AdminRateLimit);

  } finally { await clean(f); }
});
