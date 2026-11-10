import "dotenv/config";
import { existsSync } from "node:fs";
import { PrismaPg } from "../src/lib/pg-adapter";
import { PrismaClient } from "@prisma/client";
import assert from "node:assert/strict";
import { hashPassword } from "better-auth/crypto";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
const base = process.env.TEST_BASE_URL;
if (!base || !["localhost", "127.0.0.1"].includes(new URL(base).hostname)) throw new Error("TEST_BASE_URL must point to a local demo server");
const origin = new URL(base).origin;
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
after(() => db.$disconnect());
const cookies = new Map<string, string>();
async function request(path: string, body?: unknown, cookie = true, requestOrigin = origin, method = body === undefined ? "GET" : "POST") {
  const response = await fetch(`${base}${path}`, {
    method, redirect: "manual",
    headers: { origin: requestOrigin, ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(cookie ? { Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  for (const value of response.headers.getSetCookie()) {
    const [pair] = value.split(";"); const index = pair.indexOf("=");
    if (value.toLowerCase().includes("max-age=0")) cookies.delete(pair.slice(0, index));
    else cookies.set(pair.slice(0, index), pair.slice(index + 1));
  }
  return response;
}
async function mail(email: string, subject: string) {
  const search = await fetch(`http://127.0.0.1:8025/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
  const result = await search.json() as { messages?: { ID: string; Subject: string }[] };
  const item = result.messages?.find((x) => x.Subject.includes(subject));
  assert.ok(item, "Expected mail delivered to local Mailpit");
  const message = await (await fetch(`http://127.0.0.1:8025/api/v1/message/${item.ID}`)).json() as { Text: string };
  return message.Text;
}


test("HTTP registration, email proof, sessions, reset and CSRF boundaries", async () => {
  const email = `auth-${randomUUID()}@example.test`;
  const password = `Synthetic-test-${randomUUID()}`;
  const replacement = `Replacement-${randomUUID()}`;
  const university = await db.university.findFirstOrThrow({ where: { active: true } });
  const course = await db.courseOption.findFirstOrThrow({ where: { active: true } });
  const registration = { legacyNsuhwLogin: `legacy-${randomUUID()}`, legacyNsuhwClaimConfirmed: true, email, password, name: "Синтетический участник", universityId: university.id, courseId: course.id, demoConsent: true, role: "TECHNICAL_ADMIN" };
  // Dedicated local fixture environment only: remove rate-limit fixtures before exercising flows.
  await db.rateLimit.deleteMany();
  try {
    assert.equal((await request("/api/me", undefined, false)).status, 401);
    assert.equal((await request("/api/auth/sign-up/email", { padding: "x".repeat(20000) })).status, 413);
    assert.equal((await request("/api/auth/sign-up/email", registration, false, "https://untrusted.invalid")).status, 403);
    assert.equal((await request("/api/auth/sign-up/email", { ...registration, demoConsent: false })).status, 400);
    assert.equal(await db.user.findUnique({ where: { email } }), null);
    assert.equal((await request("/api/auth/sign-up/email", { ...registration, legacyNsuhwLogin: "", legacyNsuhwClaimConfirmed: true })).status, 400);
    assert.equal(await db.user.findUnique({where:{email}}),null);
    const signup = await request("/api/auth/sign-up/email", registration);
    assert.equal(signup.status, 200, "Synthetic registration should succeed");
    const user = await db.user.findUniqueOrThrow({ where: { email }, include: { profile: true, consents: true, accounts: true } });
    assert.equal(user.role, "STUDENT");
    const legacy = await db.legacyNsuhwClaim.findUniqueOrThrow({where:{userId:user.id}});
    assert.equal(legacy.login,registration.legacyNsuhwLogin); assert.equal(legacy.approvedAt,null);
    assert.equal(user.profile?.universityId, university.id);
    assert.equal(user.consents[0]?.purpose, "synthetic-demo-only");
    assert.notEqual(user.accounts[0]?.password, password);
    assert.ok(user.accounts[0]?.password);
    assert.notEqual((await request("/api/auth/sign-in/email", { email, password })).status, 200, "Unverified email cannot sign in");
    const code = (await mail(email, "Подтверждение")).match(/\b\d{6}\b/)?.[0];
    assert.ok(code);
    const stored = await db.verification.findMany();
    assert.ok(!stored.some((x) => x.value.includes(code)), "OTP must not be stored in plaintext");
    assert.equal((await request("/api/auth/email-otp/verify-email", { email, otp: code })).status, 200);
    assert.notEqual((await request("/api/auth/email-otp/verify-email", { email, otp: code })).status, 200, "OTP is single-use");
    assert.equal((await request("/api/auth/sign-in/email", { email, password })).status, 200);
    const me = await request("/api/me");
    assert.equal(me.status, 200);
    assert.ok(me.headers.get("cache-control")?.includes("no-store"));
    const own = await me.json() as { user: { role: string } };
    assert.equal(own.user.role, "STUDENT");
    const oldSession = [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    assert.equal((await request("/api/auth/request-password-reset", { email, redirectTo: "/reset-password" })).status, 200);
    const text = await mail(email, "Восстановление");
    const link = text.match(/http[^\s]+/)?.[0]; assert.ok(link);
    const callback = await fetch(link, { redirect: "manual" });
    assert.equal(callback.status, 302, "Reset callback must be exposed");
    const location = callback.headers.get("location"); assert.ok(location);
    const token = new URL(location, origin).searchParams.get("token"); assert.ok(token);
    assert.equal((await request("/api/auth/reset-password", { token, newPassword: replacement })).status, 200);
    const revoked = await fetch(`${base}/api/me`, { headers: { Cookie: oldSession } });
    assert.equal(revoked.status, 401, "Password reset revokes the old session");
    assert.notEqual((await request("/api/auth/reset-password", { token, newPassword: password })).status, 200, "Reset token is single-use");
    assert.notEqual((await request("/api/auth/sign-in/email", { email, password })).status, 200);
    assert.equal((await request("/api/auth/sign-in/email", { email, password: replacement })).status, 200);
    assert.equal((await request("/api/staff", { editionId: randomUUID(), editionVenueId: randomUUID(), email: `other-${randomUUID()}@example.test`, name: "Другой синтетический пользователь" })).status, 403);
    assert.equal((await request("/api/auth/sign-out", {})).status, 200);
    const challenge = await request("/api/auth/sign-in/email", { email, password: replacement });
    assert.equal(challenge.status, 200);
    assert.equal("twoFactorRedirect" in await challenge.json(), false);
    assert.equal((await request("/api/me")).status, 200, "Verified email and password create the session");
    assert.equal((await request("/api/auth/sign-out", {})).status, 200);
    assert.equal((await request("/api/me")).status, 401);
    assert.equal((await request("/api/auth/sign-in/email-otp", { email, otp: "000000" })).status, 404, "Passwordless routes are not exposed");
    assert.equal((await request("/api/auth/sign-in/email", { email, password: replacement })).status, 429, "Repeated login attempts are throttled");
  } finally {
    const user = await db.user.findUnique({ where: { email } });
    if (user) {
      await db.legacyNsuhwClaim.deleteMany({where:{userId:user.id}});
      await db.studentProfile.deleteMany({ where: { userId: user.id } });
      await db.consentRecord.deleteMany({ where: { userId: user.id } });
      await db.auditEvent.deleteMany({ where: { actorId: user.id } });
      await db.verification.deleteMany({ where: { value: user.id } });
      await db.user.delete({ where: { id: user.id } });
    }
  }
});


test("HTTP chief manages venue staff only with verified email and password reauthentication", async () => {
  cookies.clear();
  await db.rateLimit.deleteMany();
  const tag = randomUUID();
  const password = `Chief-synthetic-${tag}`;
  const chief = await db.user.create({ data: { name: "Тестовый главный организатор", email: `chief-http-${tag}@example.test`, role: "CHIEF_ORGANIZER", emailVerified: true } });
  const targetEmail = `staff-http-${tag}@example.test`;
  const outsider = await db.user.create({ data: { name: "Чужой учебный студент", email: `unrelated-${tag}@example.test`, emailVerified: true } });
  const edition = await db.olympiadEdition.create({ data: { year: 6200, title: "HTTP тест назначений" } });
  const venue = await db.venue.create({ data: { name: "HTTP тест площадки" } });
  const site = await db.editionVenue.create({ data: { venueId: venue.id, editionId: edition.id, address: "Синтетический адрес" } });
  try {
    await db.account.create({ data: { accountId: chief.id, providerId: "credential", userId: chief.id, password: await hashPassword(password) } });
    await db.editionStaffGrant.create({ data: { userId: chief.id, editionId: edition.id } });
    assert.equal((await request("/api/auth/sign-in/email", { email: chief.email, password })).status, 200);
    const payload = { email: targetEmail, name: "Синтетический организатор площадки", editionId: edition.id, editionVenueId: site.id, password };
    const invalidUtf8 = await fetch(`${base}/api/admin/schedule`, {
      method: "POST", headers: { Origin: origin, "Content-Type": "application/json", Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") },
      body: Uint8Array.of(0x22, 0xc3, 0x28, 0x22),
    });
    assert.equal(invalidUtf8.status, 400, "Malformed UTF-8 is a client error, not 503");
    assert.match(invalidUtf8.headers.get("cache-control") ?? "", /no-store/);
    assert.deepEqual(await invalidUtf8.json(), { error: "Проверьте поля формы" });
    assert.equal((await request("/api/staff", { ...payload, password: "Wrong-password" })).status, 403);
    assert.equal(await db.user.findUnique({ where: { email: targetEmail } }), null);
    assert.equal((await request("/api/staff", payload)).status, 200);
    const target = await db.user.findUniqueOrThrow({ where: { email: targetEmail } });
    assert.equal(target.role, "VENUE_ORGANIZER");
    assert.equal(target.emailVerified, false, "Mailbox proof is still required for a newly assigned organizer");
    await mail(targetEmail, "Восстановление");
    const outsiderSession = await db.session.create({ data: { userId: outsider.id, token: randomUUID(), expiresAt: new Date(Date.now() + 60000) } });
    const denied = await fetch(`${base}/api/staff`, {
      method: "DELETE", headers: { Origin: origin, "Content-Type": "application/json", Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") },
      body: JSON.stringify({ editionId: edition.id, editionVenueId: site.id, userId: outsider.id, password }),
    });
    assert.equal(denied.status, 403);
    assert.match(denied.headers.get("cache-control") ?? "", /no-store/);
    assert.ok(await db.session.findUnique({ where: { id: outsiderSession.id } }), "Scoped chief cannot terminate an unrelated user's session");
    const revocation = await fetch(`${base}/api/staff`, {
      method: "DELETE", headers: { Origin: origin, "Content-Type": "application/json", Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") },
      body: JSON.stringify({ editionId: edition.id, editionVenueId: site.id, userId: target.id, password }),
    });
    assert.equal(revocation.status, 200);
    assert.ok((await db.venueStaffAssignment.findUniqueOrThrow({ where: { userId_editionVenueId: { userId: target.id, editionVenueId: site.id } } })).revokedAt);
  } finally {
    const target = await db.user.findUnique({ where: { email: targetEmail } });
    const ids = [chief.id, outsider.id, ...(target ? [target.id] : [])];
    await db.venueStaffAssignment.deleteMany({ where: { userId: { in: ids } } });
    await db.editionStaffGrant.deleteMany({ where: { userId: chief.id } });
    await db.auditEvent.deleteMany({ where: { OR: [{ actorId: { in: ids } }, { editionId: edition.id }] } });
    await db.editionVenue.delete({ where: { id: site.id } });
    await db.venue.delete({ where: { id: venue.id } });
    await db.olympiadEdition.delete({ where: { id: edition.id } });
    await db.verification.deleteMany({ where: { value: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }
});


test("HTTP annual participation honors organizer scope, closure, venue ownership private history and scoped staff roster", async () => {
  cookies.clear(); await db.rateLimit.deleteMany();
  const tag = randomUUID(), password = `Annual-synthetic-${tag}`;
  const university = await db.university.create({ data: { name: "Учебный вуз HTTP", abbreviation: "УЧ" } });
  const course = await db.courseOption.create({ data: { label: "Учебный курс HTTP" } });
  const nextCourse = await db.courseOption.create({ data: { label: "Следующий учебный курс HTTP" } });
  const chief = await db.user.create({ data: { name: "Учебный главный HTTP", email: `annual-chief-${tag}@example.test`, emailVerified: true, role: "CHIEF_ORGANIZER" } });
  const a = await db.user.create({ data: { name: "Учебный участник HTTP А", email: `annual-a-${tag}@example.test`, emailVerified: true } });
  const b = await db.user.create({ data: { name: "Чужой участник HTTP Б", email: `annual-b-${tag}@example.test`, emailVerified: true } });
  const staff = await db.user.create({ data: { name: "Учебный организатор списка HTTP", email: `roster-staff-${tag}@example.test`, emailVerified: true, role: "VENUE_ORGANIZER" } });
  const admin = await db.user.create({ data: { name: "Учебный администратор", email: `admin-${tag}@example.test`, role: "TECHNICAL_ADMIN", emailVerified: true } });
  const users = [chief.id, a.id, b.id, staff.id, admin.id];
  const opening = new Date(Date.now() - 3600000), closing = new Date(Date.now() + 86400000);
  const edition = await db.olympiadEdition.create({ data: { year: 6500, title: "Учебный выпуск HTTP", registrationOpensAt: opening, registrationClosesAt: closing } });
  const next = await db.olympiadEdition.create({ data: { year: 6501, title: "Следующий учебный выпуск HTTP", registrationOpensAt: opening, registrationClosesAt: closing } });
  const editions = [edition.id, next.id];
  try {
    for (const u of [chief, a, b, staff, admin]) await db.account.create({ data: { accountId: u.id, providerId: "credential", userId: u.id, password: await hashPassword(password) } });
    for (const u of [a, b]) {
      await db.studentProfile.create({ data: { userId: u.id, fullName: u.name, universityId: university.id, courseId: course.id } });
      await db.consentRecord.create({ data: { userId: u.id, purpose: "synthetic-demo-only", textVersion: "demo-only-v1", textHash: "a".repeat(64) } });
    }
    await db.editionStaffGrant.create({ data: { userId: chief.id, editionId: edition.id } });
    assert.equal((await request("/api/auth/sign-in/email", { email: chief.email, password })).status, 200);
    const chiefCookies = new Map(cookies);
    const settings = { editionId: edition.id, revision: 0, title: edition.title, registrationOpensAt: opening.toISOString(), registrationClosesAt: closing.toISOString(), registrationManuallyClosed: true, isCurrent: true };
    assert.equal((await request("/api/editions", settings, true, origin, "PATCH")).status, 403);
    cookies.clear();
    assert.equal((await request("/api/auth/sign-in/email", { email: admin.email, password })).status, 200);
    const adminCookies = new Map(cookies);
    const windowInput = { editionId: edition.id, revision: 0, registrationOpensAt: opening.toISOString(), registrationClosesAt: closing.toISOString(), registrationManuallyClosed: true, password };
    assert.equal((await request("/api/admin/schedule", { ...windowInput, password: "wrong" })).status, 403);
    assert.equal((await request("/api/admin/schedule", windowInput, true, "http://untrusted.test")).status, 403);
    assert.equal((await request("/api/admin/schedule", windowInput)).status, 200);
    assert.equal((await request("/api/registrations/search", { editionId: edition.id })).status, 403);
    assert.equal((await request("/cabinet/admin")).status, 200);
    cookies.clear(); for (const [k, v] of chiefCookies) cookies.set(k, v);
    assert.equal((await request("/api/editions", { ...settings, editionId: next.id }, true, origin, "PATCH")).status, 403);
    const available = await (await request("/api/editions")).json() as { id: string }[];
    assert.deepEqual(available.map((e) => e.id), [edition.id]);
    const created = await request("/api/venues", { editionId: edition.id, label: "Учебная площадка HTTP", address: "Учебный адрес HTTP", room: "Тест", instructions: "Учебные правила" });
    assert.equal(created.status, 200);
    const site = await created.json() as { id: string; venueId: string };
    const nextSite = await db.editionVenue.create({ data: { editionId: next.id, venueId: site.venueId, label: "Площадка другого года HTTP", address: "Адрес другого года" } });
    cookies.clear();
    assert.equal((await request("/api/auth/sign-in/email", { email: a.email, password })).status, 200);
    const studentCookies = new Map(cookies);
    const input = { editionId: edition.id, format: "ONSITE", editionVenueId: site.id, fullName: a.name, universityId: university.id, courseId: course.id };
    const closed = await request("/api/participations", input);
    assert.equal(closed.status, 409);
    assert.equal((await closed.json() as { code: string }).code, "REGISTRATION_CLOSED");
    assert.equal((await request("/api/editions", settings, true, origin, "PATCH")).status, 403);
    cookies.clear(); for (const [k, v] of chiefCookies) cookies.set(k, v);
    assert.equal((await request("/api/editions", { ...settings, revision: 1, registrationManuallyClosed: false }, true, origin, "PATCH")).status, 403);
    cookies.clear(); for (const [k, v] of adminCookies) cookies.set(k, v);
    assert.equal((await request("/api/admin/schedule", { ...windowInput, revision: 1, registrationManuallyClosed: false })).status, 200);
    cookies.clear(); for (const [k, v] of studentCookies) cookies.set(k, v);
    assert.equal((await request("/api/participations", { ...input, userId: b.id })).status, 400);
    const first = await request("/api/participations", input);
    assert.equal(first.status, 200);
    const firstData = await first.json() as { id: string };
    assert.equal((await (await request("/api/participations", input)).json() as { id: string }).id, firstData.id);
    const currentProfile = await (await request("/api/profile")).json() as { revision: number };
    const profileInput = { fullName: "Учебный профиль HTTP", universityId: university.id, courseId: course.id, revision: currentProfile.revision };
    assert.equal((await request("/api/profile", { ...profileInput, role: "TECHNICAL_ADMIN" }, true, origin, "PATCH")).status, 400);
    assert.equal((await request("/api/profile", profileInput, true, origin, "PATCH")).status, 200);
    assert.equal((await db.participation.findUniqueOrThrow({ where: { id: firstData.id } })).fullName, a.name);
    assert.equal((await request("/api/participations/correction", { editionId: edition.id, participationId: firstData.id, revision: 0, fullName: a.name, universityId: university.id, courseId: course.id }, true, origin, "PATCH")).status, 200);
    assert.equal((await request("/cabinet/profile")).status, 200);
    assert.equal((await request("/api/teams", { editionId: edition.id, coachName: "Учебный тренер", captainId: b.id })).status, 400);
    assert.equal((await request("/api/teams", { editionId: edition.id, coachName: "Учебный тренер" })).status, 200);
    const teamView = await (await request("/api/teams")).json() as { team: { name: string } | null }[];
    assert.equal(teamView.find(t => t.team)?.team?.name, "УЧ-1");
    assert.equal((await request("/cabinet/teams")).status, 200);

    assert.equal((await request(`/cabinet/correction?editionId=${edition.id}&participationId=${firstData.id}`)).status, 200);

    assert.equal((await request("/api/participations", { ...input, editionId: next.id })).status, 409, "Cannot submit a venue from another edition");
    assert.equal((await request("/api/participations", { editionId: next.id, format: "REMOTE", remoteZone: "NSK", fullName: "Обновлённый учебный участник HTTP", universityId: university.id, courseId: nextCourse.id })).status, 200);
    const consentB = await db.consentRecord.findFirstOrThrow({ where: { userId: b.id } });
    await db.participation.create({ data: { userId: b.id, editionId: next.id, format: "REMOTE", remoteZone: "MSK", fullName: b.name, universityId: university.id, universityName: university.name, universityAbbreviation: university.abbreviation, courseId: course.id, courseLabel: course.label, consentId: consentB.id } });
    const history = await request(`/api/participations?userId=${b.id}`);
    assert.ok(history.headers.get("cache-control")?.includes("no-store"));
    const view = await history.json() as { participations: { editionId: string; fullName: string; courseLabel: string; venue: { active: boolean } | null }[] };
    assert.equal(view.participations.length, 2);
    assert.equal(view.participations.find((p) => p.editionId === edition.id)?.fullName, a.name);
    assert.equal(view.participations.find((p) => p.editionId === edition.id)?.courseLabel, course.label);
    assert.ok(!JSON.stringify(view).includes(b.name));
    assert.equal((await request("/cabinet/olympiad")).status, 200);
    cookies.clear(); for (const [k, v] of chiefCookies) cookies.set(k, v);
    assert.equal((await request("/api/venues", { editionId: edition.id, editionVenueId: site.id, revision: 0, label: "Учебная площадка HTTP", address: "Обновлённый адрес", room: "Тест", instructions: "Учебные правила", active: false }, true, origin, "PATCH")).status, 200);
    assert.equal((await db.editionVenue.findUniqueOrThrow({ where: { id: nextSite.id } })).address, "Адрес другого года");
    assert.equal((await request("/cabinet/organization")).status, 200);
    cookies.clear();
    assert.equal((await request("/api/auth/sign-in/email", { email: b.email, password })).status, 200);
    const disabled = await request("/api/participations", { ...input, fullName: b.name });
    assert.equal(disabled.status, 409);
    assert.equal((await disabled.json() as { code: string }).code, "INVALID_VENUE");
    cookies.clear(); for (const [k, v] of studentCookies) cookies.set(k, v);
    const preserved = await (await request("/api/participations")).json() as typeof view;
    assert.equal(preserved.participations.find((p) => p.editionId === edition.id)?.venue?.active, false);
    const rosterQuery = { editionId: edition.id };
    assert.equal((await request("/api/registrations/export", rosterQuery)).status, 403);
    assert.equal((await request("/api/registrations/export", rosterQuery, false)).status, 401);
    assert.equal((await request("/api/registrations/search", rosterQuery)).status, 403, "Students cannot read organizer rosters");
    assert.equal((await request("/api/registrations/search", rosterQuery, false)).status, 401);
    cookies.clear(); for (const [k, v] of chiefCookies) cookies.set(k, v);
    assert.equal((await request("/api/registrations/export")).status, 405);
    assert.equal((await request("/api/registrations/export", rosterQuery, true, "http://untrusted.test")).status, 403);
    const download = await request("/api/registrations/export", rosterQuery);
    assert.equal(download.status, 200);
    assert.ok(download.headers.get("cache-control")?.includes("no-store"));
    assert.ok(download.headers.get("content-disposition")?.includes("attachment"));
    assert.ok(download.headers.get("content-type")?.includes("text/csv"));
    const csv = await download.text(); assert.ok(csv.includes(a.name)); assert.ok(!csv.includes(b.email));
    const chiefRoster = await request("/api/registrations/search", rosterQuery);
    assert.equal(chiefRoster.status, 200);
    assert.ok(chiefRoster.headers.get("cache-control")?.includes("no-store"));
    assert.equal((await chiefRoster.json() as { total: number }).total, 1);
    assert.equal((await request("/api/registrations/search", { editionId: next.id })).status, 403);
    await db.venueStaffAssignment.create({ data: { userId: staff.id, editionId: edition.id, editionVenueId: site.id } });
    cookies.clear();
    assert.equal((await request("/api/auth/sign-in/email", { email: staff.email, password })).status, 200);
    const roster = await request("/api/registrations/search", rosterQuery);
    assert.equal(roster.status, 200);
    const list = await roster.json() as { total: number; rows: { fullName: string; email: string }[] };
    assert.equal(list.total, 1); assert.equal(list.rows[0].email, a.email);
    assert.ok(!JSON.stringify(list).includes(b.email));
    assert.equal((await request("/api/registrations/search", { ...rosterQuery, editionVenueId: nextSite.id })).status, 403);
    assert.equal((await request("/api/registrations/search", { ...rosterQuery, actorId: chief.id })).status, 400);
    assert.equal((await request("/api/registrations/search", { ...rosterQuery, sort: "consentId" })).status, 400);
    assert.equal((await request("/api/attendance", { editionId: edition.id, participationId: firstData.id, revision: 0, status: "PRESENT" })).status, 200);
    assert.equal((await request("/api/attendance", { editionId: edition.id, participationId: firstData.id, revision: 0, status: "ABSENT" })).status, 409);
    assert.equal((await request("/api/attendance", { editionId: next.id, participationId: firstData.id, revision: 1, status: "ABSENT" })).status, 403);
    const page = await request("/cabinet/registrations"); assert.equal(page.status, 200);
    const html = await page.text(); assert.ok(html.includes(a.name)); assert.ok(!html.includes(b.email));
    await db.venueStaffAssignment.updateMany({ where: { userId: staff.id }, data: { revokedAt: new Date() } });
    assert.equal((await request("/api/registrations/search", rosterQuery)).status, 403, "An old valid session does not bypass assignment revocation");
    assert.equal((await request("/api/registrations/export", rosterQuery)).status, 403);
    const visible = await (await request("/api/registrations/options")).json() as { editions: unknown[] };
    assert.equal(visible.editions.length, 0);
    const savedStaffCookies = new Map(cookies);
    const invited = await db.user.create({ data: { email: `invited-http-${tag}@example.test`, name: "Учебный приглашённый HTTP", emailVerified: true } }); users.push(invited.id);
    await db.account.create({ data: { accountId: invited.id, providerId: "credential", userId: invited.id, password: await hashPassword(password) } });
    const invitedConsent = await db.consentRecord.create({ data: { userId: invited.id, purpose: "synthetic-demo-only", textVersion: "demo", textHash: "a".repeat(64) } });
    await db.participation.create({ data: { userId: invited.id, editionId: edition.id, format: "REMOTE", remoteZone: "NSK", fullName: invited.name, universityId: university.id, universityName: university.name, universityAbbreviation: university.abbreviation, courseId: course.id, courseLabel: course.label, consentId: invitedConsent.id } });
    cookies.clear(); for (const [k, v] of studentCookies) cookies.set(k, v);
    const captainsTeam = (await (await request("/api/teams")).json() as { team: { id: string } | null }[]).find(e => e.team)!.team!;
    const invitationInput = { operation: "invite", editionId: edition.id, teamId: captainsTeam.id, email: invited.email };
    assert.equal((await request("/api/teams/action", invitationInput, true, "http://untrusted.test")).status, 403);
    assert.equal((await request("/api/teams/action", invitationInput)).status, 200);
    await db.rateLimit.deleteMany();
    cookies.clear();
    assert.equal((await request("/api/auth/sign-in/email", { email: invited.email, password })).status, 200);
    const inbox = (await (await request("/api/teams")).json() as { invitations: { id: string; revision: number }[] }[])[0].invitations[0];
    assert.equal((await request("/api/teams/action", { operation: "acceptInvitation", editionId: edition.id, invitationId: inbox.id, revision: inbox.revision })).status, 200);
    assert.equal((await request("/cabinet/teams")).status, 200);
    const invitedParticipation = await db.participation.findUniqueOrThrow({ where: { userId_editionId: { userId: invited.id, editionId: edition.id } } });
    assert.equal((await request(`/cabinet/cancel?editionId=${edition.id}&participationId=${invitedParticipation.id}`)).status, 200);
    const cancelInput = { editionId: edition.id, participationId: invitedParticipation.id, revision: invitedParticipation.revision, confirmed: true };
    assert.equal((await request("/api/participations/cancel", { ...cancelInput, confirmed: false })).status, 400);
    assert.equal((await request("/api/participations/cancel", cancelInput, false)).status, 401);
    assert.equal((await request("/api/participations/cancel", cancelInput, true, "http://untrusted.test")).status, 403);
    assert.equal((await request("/api/participations/cancel", cancelInput)).status, 200);
    assert.equal((await request("/api/participations", { editionId: edition.id, format: "REMOTE", remoteZone: "NSK", fullName: invited.name, universityId: university.id, courseId: course.id })).status, 409);
    assert.equal(await db.teamMember.count({ where: { participationId: invitedParticipation.id } }), 0);
    cookies.clear(); for (const [k, v] of savedStaffCookies) cookies.set(k, v);

    assert.equal((await request("/api/admin/chief", { editionId: edition.id, email: chief.email, name: chief.name, operation: "assign", password })).status, 403);
    const staffAdminPage = await request("/cabinet/admin"); assert.equal(staffAdminPage.status, 307);
    cookies.clear(); for (const [k, v] of chiefCookies) cookies.set(k, v);
    assert.equal((await request("/cabinet/admin")).status, 307);
    cookies.clear(); for (const [k, v] of adminCookies) cookies.set(k, v);
    assert.equal((await request("/cabinet/registrations")).status, 307);
    assert.equal((await request("/api/registrations/export", rosterQuery)).status, 403);
    assert.equal((await request("/api/participations/cancel", { editionId: edition.id, participationId: firstData.id, revision: 1, confirmed: true })).status, 403);
    assert.equal((await request("/api/admin/chief", { editionId: next.id, email: chief.email, name: chief.name, operation: "assign", password })).status, 200);
    await db.rateLimit.deleteMany({ where: { key: `admin-reauth:${admin.id}` } });
    assert.equal((await request("/api/admin/chief", { editionId: edition.id, email: a.email, name: a.name, operation: "assign", password })).status, 403, "Existing student cannot be promoted");
    assert.equal((await request("/api/admin/chief", { editionId: edition.id, email: chief.email, name: chief.name, operation: "revoke", password })).status, 200);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: chief.id } })).role, "CHIEF_ORGANIZER");
    assert.equal((await db.participation.count({ where: { userId: a.id } })), 2);
    cookies.clear(); for (const [k, v] of chiefCookies) cookies.set(k, v);
    assert.equal((await request("/api/registrations/search", rosterQuery)).status, 401, "Revocation deletes old sessions");


  } finally {
    await db.$transaction(async (tx) => {
      const sites = await tx.editionVenue.findMany({ where: { editionId: { in: editions } }, select: { venueId: true } });
      await tx.team.deleteMany({ where: { editionId: { in: editions } } });
      await tx.participation.deleteMany({ where: { editionId: { in: editions } } });
      await tx.auditEvent.deleteMany({ where: { OR: [{ actorId: { in: users } }, { editionId: { in: editions } }] } });
      await tx.venueStaffAssignment.deleteMany({ where: { editionId: { in: editions } } });
      await tx.editionVenue.deleteMany({ where: { editionId: { in: editions } } });
      await tx.venue.deleteMany({ where: { id: { in: sites.map((v) => v.venueId) } } });
      await tx.editionStaffGrant.deleteMany({ where: { editionId: { in: editions } } });
      await tx.olympiadEdition.deleteMany({ where: { id: { in: editions } } });
      await tx.studentProfile.deleteMany({ where: { userId: { in: users } } });
      await tx.consentRecord.deleteMany({ where: { userId: { in: users } } });
      await tx.verification.deleteMany({ where: { value: { in: users } } });
      await tx.user.deleteMany({ where: { id: { in: users } } });
      await tx.courseOption.deleteMany({ where: { id: { in: [course.id, nextCourse.id] } } });
      await tx.university.delete({ where: { id: university.id } });
    });
  }
});

test("externally created staff accounts require email proof and retain roles/grants across recovery", async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { manageChief } = await import("../src/lib/admin");
  const { assignVenueStaff } = await import("../src/lib/staff");
  const tag = randomUUID(), password = `Synthetic-${tag}`;
  const emails = ["admin", "chief", "venue"].map(x => `${x}-${tag}@example.test`);
  const edition = await db.olympiadEdition.create({ data: { year: 7990, title: "Учебный вход" } });
  const venue = await db.venue.create({ data: { name: "Учебная площадка входа" } });
  const site = await db.editionVenue.create({ data: { editionId: edition.id, venueId: venue.id, address: "Синтетический адрес" } });
  const reset = async (email: string, nextPassword: string) => {
    await db.rateLimit.deleteMany();
    assert.equal((await request("/api/auth/request-password-reset", { email, redirectTo: "/reset-password" })).status, 200);
    const link = (await mail(email, "Восстановление")).match(/https?:\/\/\S+/)?.[0]; assert.ok(link);
    const response = await request(new URL(link).pathname + new URL(link).search);
    const location = response.headers.get("location"); assert.ok(location);
    const token = new URL(location, origin).searchParams.get("token"); assert.ok(token);
    assert.notEqual((await request("/api/auth/reset-password", { token: "invalid-token", newPassword: nextPassword })).status, 200);
    assert.equal((await request("/api/auth/reset-password", { token, newPassword: nextPassword })).status, 200);
    assert.notEqual((await request("/api/auth/reset-password", { token, newPassword: password })).status, 200);
  };
  try {
    await promisify(execFile)(process.execPath, ["--import", "tsx", "scripts/bootstrap-admin.ts", emails[0], "Учебный администратор"]);
    for (let i = 0; i < emails.length; i++) {
      cookies.clear(); await db.rateLimit.deleteMany();
      const email = emails[i];
      const user = await db.user.findUniqueOrThrow({ where: { email } });
      assert.equal(user.emailVerified, false);
      assert.equal(await db.account.count({ where: { userId: user.id } }), 0);
      await reset(email, password);
      assert.equal((await db.user.findUniqueOrThrow({ where: { email } })).emailVerified, false, "Recovery is not email verification");
      const denied = await request("/api/auth/sign-in/email", { email, password });
      assert.equal((await denied.json() as { code: string }).code, "EMAIL_NOT_VERIFIED");
      assert.equal((await request("/api/me")).status, 401);
      if (i === 0) {
        const { chromium } = await import("playwright");
        const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined), args: ["--no-sandbox"] });
        try {
          const page = await browser.newPage();
          await page.goto(`${base}/login`);
          await page.locator('input[type="email"]').fill(email);
          await page.locator('input[name="password"]').fill(password);
          await page.waitForTimeout(1000);
          await page.getByRole("button", { name: "Продолжить", exact: true }).click();
          await page.getByRole("heading", { name: "Подтверждение email", exact: true }).waitFor();
          assert.equal(await page.locator('input[type="email"]').inputValue(), email);
          assert.ok((await page.getByRole("status").textContent())?.includes("подтвердите email"));
          assert.equal((await db.user.findUniqueOrThrow({ where: { email } })).emailVerified, false);
        } finally { await browser.close(); }
      }
      const before = (await db.verification.findMany()).map(v => v.id);
      assert.equal((await request("/api/auth/email-otp/send-verification-otp", { email, type: "email-verification" })).status, 200);
      let code = (await mail(email, "Подтверждение")).match(/\b\d{6}\b/)?.[0]; assert.ok(code);
      assert.notEqual((await request("/api/auth/email-otp/verify-email", { email, otp: code === "000000" ? "111111" : "000000" })).status, 200);
      await db.verification.updateMany({ where: { id: { notIn: before } }, data: { expiresAt: new Date(0) } });
      assert.notEqual((await request("/api/auth/email-otp/verify-email", { email, otp: code })).status, 200);
      assert.equal((await db.user.findUniqueOrThrow({ where: { email } })).emailVerified, false);
      await request("/api/auth/email-otp/send-verification-otp", { email, type: "email-verification" });
      code = (await mail(email, "Подтверждение")).match(/\b\d{6}\b/)?.[0]; assert.ok(code);
      assert.equal((await request("/api/auth/email-otp/verify-email", { email, otp: code })).status, 200);
      assert.notEqual((await request("/api/auth/email-otp/verify-email", { email, otp: code })).status, 200);
      assert.equal((await request("/api/auth/sign-in/email", { email, password })).status, 200);
      const replacement = `Replacement-${tag}`;
      const oldCookies = [...cookies].map(([k,v]) => `${k}=${v}`).join("; ");
      await reset(email, replacement);
      assert.equal((await fetch(`${base}/api/me`, { headers: { cookie: oldCookies } })).status, 401);
      cookies.clear();
      assert.notEqual((await request("/api/auth/sign-in/email", { email, password })).status, 200);
      const challenge = await request("/api/auth/sign-in/email", { email, password: replacement });
      assert.equal(challenge.status, 200);
      assert.equal((await request("/api/me")).status, 200);
      const preserved = await db.user.findUniqueOrThrow({ where: { email } });
      if (i === 0) await manageChief(db, user.id, { editionId: edition.id, email: emails[1], name: "Учебный главный", operation: "assign", password: replacement });
      if (i === 1) {
        assert.equal(await db.editionStaffGrant.count({ where: { userId: user.id, editionId: edition.id, revokedAt: null } }), 1);
        await assignVenueStaff(db, user.id, { editionId: edition.id, editionVenueId: site.id, email: emails[2], name: "Учебный организатор" });
      }
      if (i === 2) assert.equal(await db.venueStaffAssignment.count({ where: { userId: user.id, editionVenueId: site.id, revokedAt: null } }), 1);
      assert.equal(preserved.role, user.role);
      // An expired reset must not replace the password.
      await db.rateLimit.deleteMany();
      await request("/api/auth/request-password-reset", { email, redirectTo: "/reset-password" });
      await db.verification.updateMany({ where: { value: user.id }, data: { expiresAt: new Date(0) } });
      const expiredLink = (await mail(email, "Восстановление")).match(/https?:\/\/\S+/)?.[0]; assert.ok(expiredLink);
      const expiredToken = new URL(expiredLink).pathname.split("/").pop();
      assert.notEqual((await request("/api/auth/reset-password", { token: expiredToken, newPassword: password })).status, 200);
      assert.equal((await db.user.findUniqueOrThrow({ where: { email } })).emailVerified, true);
    }
  } finally {
    cookies.clear();
    const users = await db.user.findMany({ where: { email: { in: emails } } });
    await db.auditEvent.deleteMany({ where: { OR: [{ editionId: edition.id }, { actorId: { in: users.map(u => u.id) } }, { objectId: { in: users.map(u => u.id) } }] } });
    await db.venueStaffAssignment.deleteMany({ where: { editionId: edition.id } });
    await db.editionStaffGrant.deleteMany({ where: { editionId: edition.id } });
    await db.editionVenue.deleteMany({ where: { editionId: edition.id } });
    await db.olympiadEdition.delete({ where: { id: edition.id } });
    await db.venue.delete({ where: { id: venue.id } });
    await db.user.deleteMany({ where: { email: { in: emails } } });
    await db.rateLimit.deleteMany();
  }
});

test("HTTP new signup stores Latin login names independently and enforces both signup branches",async()=>{
 cookies.clear();await db.rateLimit.deleteMany();
 const email=`latin-${randomUUID()}@example.test`,password=`Synthetic-${randomUUID()}`;
 const uni=await db.university.findFirstOrThrow({where:{active:true}}),course=await db.courseOption.findFirstOrThrow({where:{active:true}});
 const input={name:"Синтетический Иван Петров",email,password,universityId:uni.id,courseId:course.id,demoConsent:true,firstNameLatin:"Ivan",lastNameLatin:"Petrov"};
 try{
  assert.equal((await request("/api/auth/sign-up/email",{...input,lastNameLatin:"Pеtrov"})).status,400);
  assert.equal((await request("/api/auth/sign-up/email",{...input,legacyNsuhwLogin:"legacy.conflict",legacyNsuhwClaimConfirmed:true})).status,400);
  assert.equal(await db.user.findUnique({where:{email}}),null);
  assert.equal((await request("/api/auth/sign-up/email",input)).status,200);
  const user=await db.user.findUniqueOrThrow({where:{email},include:{profile:true,nsuhwLoginName:true}});
  assert.equal(user.name,input.name);assert.equal(user.profile?.fullName,input.name);
  assert.equal(user.nsuhwLoginName?.firstNameLatin,"Ivan");assert.equal(user.nsuhwLoginName?.lastNameLatin,"Petrov");
  const prepared=await db.preparedExternalAccount.findUniqueOrThrow({where:{userId:user.id}});assert.ok(prepared.login.startsWith("smc.i.petrov"));assert.ok(!JSON.stringify(prepared.secretEnvelope).includes(password));
  assert.equal(await db.legacyNsuhwClaim.findUnique({where:{userId:user.id}}),null);
  const code=(await mail(email,"Подтверждение")).match(/\b\d{6}\b/)?.[0];assert.ok(code);
  assert.equal((await request("/api/auth/email-otp/verify-email",{email,otp:code})).status,200);
  assert.equal((await request("/api/auth/sign-in/email",{email,password})).status,200);
  const view=await request("/api/nsuhw/login-names");assert.equal(view.status,200);assert.ok(view.headers.get("cache-control")?.includes("no-store"));
  assert.equal((await view.json() as {preview:string}).preview,"smc.i.petrov");
  const reserved=await request("/api/nsuhw/prepared");assert.equal(reserved.status,200);const reservedBody=await reserved.json() as {id:string;login:string};assert.equal(reservedBody.login,prepared.login);assert.ok(!JSON.stringify(reservedBody).includes("secretEnvelope"));
  assert.equal((await request("/api/nsuhw/prepared",{confirmed:true,nameRevision:0,userId:randomUUID()})).status,400);
  assert.equal((await request("/api/nsuhw/prepared",{confirmed:true,nameRevision:0})).status,200);
  assert.equal((await request("/api/nsuhw/login-names",{firstNameLatin:"Other",lastNameLatin:"Name",revision:0})).status,409);

  assert.equal((await request("/api/nsuhw/login-names",{firstNameLatin:"Ivan",lastNameLatin:"Petrov",revision:0,userId:randomUUID()})).status,400);
 }finally{
  cookies.clear();const user=await db.user.findUnique({where:{email}});
  if(user){await db.preparedExternalAccount.deleteMany({where:{userId:user.id}});await db.nsuhwLoginName.deleteMany({where:{userId:user.id}});await db.auditEvent.deleteMany({where:{actorId:user.id}});await db.studentProfile.deleteMany({where:{userId:user.id}});await db.consentRecord.deleteMany({where:{userId:user.id}});await db.user.delete({where:{id:user.id}});}
  await db.rateLimit.deleteMany();
 }
});

test("retired second-factor routes are unavailable to guests and signed-in users", async () => {
  cookies.clear(); await db.rateLimit.deleteMany();
  const user = await db.user.create({ data: { email: `retired-${randomUUID()}@example.test`, name: "Учебный вход без второго фактора", role: "CHIEF_ORGANIZER", emailVerified: true } });
  const password = `Synthetic-${randomUUID()}`;
  try {
    await db.account.create({ data: { userId: user.id, accountId: user.id, providerId: "credential", password: await hashPassword(password) } });
    for (const signedIn of [false, true]) {
      if (signedIn) {
        const login = await request("/api/auth/sign-in/email", { email: user.email, password });
        assert.equal(login.status, 200);
        assert.equal("twoFactorRedirect" in await login.json(), false);
        const me = await request("/api/me"); assert.equal(me.status, 200);
        assert.equal("twoFactorEnabled" in (await me.json()).user, false);
        assert.equal((await request("/api/registrations/search", { editionId: randomUUID() })).status, 403, "Password login grants no year assignments");
        const cabinet = await (await request("/cabinet")).text();
        assert.ok(!cabinet.includes("Настроить TOTP") && !cabinet.includes("Резервный код"));
      }
      for (const path of ["enable", "disable", "verify-totp", "verify-backup-code", "generate-backup-codes", "get-totp-uri", "send-otp", "verify-otp"]) {
        const response = await request(`/api/auth/two-factor/${path}`, { password, code: "000000" });
        assert.equal(response.status, 404); assert.ok(response.headers.get("cache-control")?.includes("no-store"));
        assert.equal((await request(`/api/auth/two-factor/${path}`)).status, 404);
      }
      assert.equal((await request("/two-factor")).status, 404);
    }
  } finally { cookies.clear(); await db.auditEvent.deleteMany({ where: { actorId: user.id } }); await db.user.delete({ where: { id: user.id } }); await db.rateLimit.deleteMany(); }
});
