import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import assert from "node:assert/strict";
import { hashPassword } from "better-auth/crypto";
import { randomUUID, createHmac } from "node:crypto";
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

function totp(uri: string) {
  const encoded = new URL(uri).searchParams.get("secret"); assert.ok(encoded);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of encoded.replace(/=+$/, "")) bits += alphabet.indexOf(char.toUpperCase()).toString(2).padStart(5, "0");
  const secret = Buffer.from(bits.match(/.{8}/g)!.map((x) => parseInt(x, 2)));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac("sha1", secret).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, "0");
}

test("HTTP registration, email proof, sessions, reset and CSRF boundaries", async () => {
  const email = `auth-${randomUUID()}@example.test`;
  const password = `Synthetic-test-${randomUUID()}`;
  const replacement = `Replacement-${randomUUID()}`;
  const university = await db.university.findFirstOrThrow({ where: { active: true } });
  const course = await db.courseOption.findFirstOrThrow({ where: { active: true } });
  const registration = { email, password, name: "Синтетический участник", universityId: university.id, courseId: course.id, demoConsent: true, role: "CHIEF_ORGANIZER" };
  // Dedicated local fixture environment only: remove rate-limit fixtures before exercising flows.
  await db.rateLimit.deleteMany();
  try {
    assert.equal((await request("/api/me", undefined, false)).status, 401);
    assert.equal((await request("/api/auth/sign-up/email", { padding: "x".repeat(20000) })).status, 413);
    assert.equal((await request("/api/auth/sign-up/email", registration, false, "https://untrusted.invalid")).status, 403);
    assert.equal((await request("/api/auth/sign-up/email", { ...registration, demoConsent: false })).status, 400);
    assert.equal(await db.user.findUnique({ where: { email } }), null);
    const signup = await request("/api/auth/sign-up/email", registration);
    assert.equal(signup.status, 200, "Synthetic registration should succeed");
    const user = await db.user.findUniqueOrThrow({ where: { email }, include: { profile: true, consents: true, accounts: true } });
    assert.equal(user.role, "STUDENT");
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
    const setup = await request("/api/auth/two-factor/enable", { password: replacement, method: "totp" });
    assert.equal(setup.status, 200);
    const factor = await setup.json() as { totpURI: string; backupCodes: string[] };
    assert.ok(factor.totpURI.startsWith("otpauth://"));
    assert.ok(factor.backupCodes.length > 0);
    assert.equal((await request("/api/auth/two-factor/verify-totp", { code: totp(factor.totpURI), trustDevice: false })).status, 200);
    assert.equal((await db.user.findUniqueOrThrow({ where: { email } })).twoFactorEnabled, true);
    const protectedFactor = await db.twoFactor.findFirstOrThrow({ where: { userId: user.id } });
    assert.ok(!protectedFactor.backupCodes.includes(factor.backupCodes[0]));
    assert.equal((await request("/api/staff", { editionId: randomUUID(), editionVenueId: randomUUID(), email: `other-${randomUUID()}@example.test`, name: "Другой синтетический пользователь" })).status, 403);
    assert.equal((await request("/api/auth/sign-out", {})).status, 200);
    const challenge = await request("/api/auth/sign-in/email", { email, password: replacement });
    assert.equal(challenge.status, 200);
    assert.equal((await challenge.json() as { twoFactorRedirect?: boolean }).twoFactorRedirect, true);
    assert.equal((await request("/api/me")).status, 401, "Password alone does not create a usable MFA session");
    assert.equal((await request("/api/auth/two-factor/verify-totp", { code: totp(factor.totpURI), trustDevice: false })).status, 200);
    assert.equal((await request("/api/me")).status, 200);
    assert.equal((await request("/api/auth/sign-out", {})).status, 200);
    assert.equal((await request("/api/me")).status, 401);
    assert.equal((await request("/api/auth/sign-in/email-otp", { email, otp: "000000" })).status, 404, "Passwordless routes are not exposed");
    assert.equal((await request("/api/auth/sign-in/email", { email, password: replacement })).status, 429, "Repeated login attempts are throttled");
  } finally {
    const user = await db.user.findUnique({ where: { email } });
    if (user) {
      await db.studentProfile.deleteMany({ where: { userId: user.id } });
      await db.consentRecord.deleteMany({ where: { userId: user.id } });
      await db.auditEvent.deleteMany({ where: { actorId: user.id } });
      await db.verification.deleteMany({ where: { value: user.id } });
      await db.user.delete({ where: { id: user.id } });
    }
  }
});


test("HTTP chief manages venue staff only with MFA and password reauthentication", async () => {
  cookies.clear();
  await db.rateLimit.deleteMany();
  const tag = randomUUID();
  const password = `Chief-synthetic-${tag}`;
  const chief = await db.user.create({ data: { name: "Тестовый главный организатор", email: `chief-http-${tag}@example.test`, role: "CHIEF_ORGANIZER", emailVerified: true } });
  const targetEmail = `staff-http-${tag}@example.test`;
  const edition = await db.olympiadEdition.create({ data: { year: 6200, title: "HTTP тест назначений" } });
  const venue = await db.venue.create({ data: { name: "HTTP тест площадки" } });
  const site = await db.editionVenue.create({ data: { venueId: venue.id, editionId: edition.id, address: "Синтетический адрес" } });
  try {
    await db.account.create({ data: { accountId: chief.id, providerId: "credential", userId: chief.id, password: await hashPassword(password) } });
    await db.editionStaffGrant.create({ data: { userId: chief.id, editionId: edition.id } });
    assert.equal((await request("/api/auth/sign-in/email", { email: chief.email, password })).status, 200);
    const payload = { email: targetEmail, name: "Синтетический организатор площадки", editionId: edition.id, editionVenueId: site.id, password };
    assert.equal((await request("/api/staff", payload)).status, 403, "Chief must enroll MFA first");
    const enrollment = await request("/api/auth/two-factor/enable", { password, method: "totp" });
    assert.equal(enrollment.status, 200);
    const factor = await enrollment.json() as { totpURI: string };
    assert.equal((await request("/api/auth/two-factor/verify-totp", { code: totp(factor.totpURI), trustDevice: false })).status, 200);
    assert.equal((await request("/api/staff", { ...payload, password: "Wrong-password" })).status, 403);
    assert.equal(await db.user.findUnique({ where: { email: targetEmail } }), null);
    assert.equal((await request("/api/staff", payload)).status, 200);
    const target = await db.user.findUniqueOrThrow({ where: { email: targetEmail } });
    assert.equal(target.role, "VENUE_ORGANIZER");
    assert.equal(target.emailVerified, false, "Mailbox proof is still required for a newly assigned organizer");
    await mail(targetEmail, "Восстановление");
    const revocation = await fetch(`${base}/api/staff`, {
      method: "DELETE", headers: { Origin: origin, "Content-Type": "application/json", Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") },
      body: JSON.stringify({ editionId: edition.id, editionVenueId: site.id, userId: target.id, password }),
    });
    assert.equal(revocation.status, 200);
    assert.ok((await db.venueStaffAssignment.findUniqueOrThrow({ where: { userId_editionVenueId: { userId: target.id, editionVenueId: site.id } } })).revokedAt);
  } finally {
    const target = await db.user.findUnique({ where: { email: targetEmail } });
    const ids = [chief.id, ...(target ? [target.id] : [])];
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
    const enrollment = await request("/api/auth/two-factor/enable", { password, method: "totp" });
    const factor = await enrollment.json() as { totpURI: string };
    assert.equal((await request("/api/auth/two-factor/verify-totp", { code: totp(factor.totpURI), trustDevice: false })).status, 200);
    const chiefCookies = new Map(cookies);
    const settings = { editionId: edition.id, revision: 0, title: edition.title, registrationOpensAt: opening.toISOString(), registrationClosesAt: closing.toISOString(), registrationManuallyClosed: true, isCurrent: true };
    assert.equal((await request("/api/editions", settings, true, origin, "PATCH")).status, 403);
    cookies.clear();
    assert.equal((await request("/api/auth/sign-in/email", { email: admin.email, password })).status, 200);
    const adminEnrollment = await (await request("/api/auth/two-factor/enable", { password, method: "totp" })).json() as { totpURI: string };
    assert.equal((await request("/api/admin/schedule", { editionId: edition.id, revision: 0, registrationOpensAt: opening.toISOString(), registrationClosesAt: closing.toISOString(), registrationManuallyClosed: true, password })).status, 403);
    assert.equal((await request("/api/auth/two-factor/verify-totp", { code: totp(adminEnrollment.totpURI), trustDevice: false })).status, 200);
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
    assert.equal((await request("/api/registrations/search", rosterQuery)).status, 403, "Students cannot read organizer rosters");
    assert.equal((await request("/api/registrations/search", rosterQuery, false)).status, 401);
    cookies.clear(); for (const [k, v] of chiefCookies) cookies.set(k, v);
    const chiefRoster = await request("/api/registrations/search", rosterQuery);
    assert.equal(chiefRoster.status, 200);
    assert.ok(chiefRoster.headers.get("cache-control")?.includes("no-store"));
    assert.equal((await chiefRoster.json() as { total: number }).total, 1);
    assert.equal((await request("/api/registrations/search", { editionId: next.id })).status, 403);
    await db.venueStaffAssignment.create({ data: { userId: staff.id, editionId: edition.id, editionVenueId: site.id } });
    cookies.clear();
    assert.equal((await request("/api/auth/sign-in/email", { email: staff.email, password })).status, 200);
    assert.equal((await request("/api/registrations/search", rosterQuery)).status, 403, "MFA is required before reading participant data");
    const staffEnrollment = await (await request("/api/auth/two-factor/enable", { password, method: "totp" })).json() as { totpURI: string };
    assert.equal((await request("/api/auth/two-factor/verify-totp", { code: totp(staffEnrollment.totpURI), trustDevice: false })).status, 200);
    const roster = await request("/api/registrations/search", rosterQuery);
    assert.equal(roster.status, 200);
    const list = await roster.json() as { total: number; rows: { fullName: string; email: string }[] };
    assert.equal(list.total, 1); assert.equal(list.rows[0].email, a.email);
    assert.ok(!JSON.stringify(list).includes(b.email));
    assert.equal((await request("/api/registrations/search", { ...rosterQuery, editionVenueId: nextSite.id })).status, 403);
    assert.equal((await request("/api/registrations/search", { ...rosterQuery, actorId: chief.id })).status, 400);
    assert.equal((await request("/api/registrations/search", { ...rosterQuery, sort: "consentId" })).status, 400);
    const page = await request("/cabinet/registrations"); assert.equal(page.status, 200);
    const html = await page.text(); assert.ok(html.includes(a.name)); assert.ok(!html.includes(b.email));
    await db.venueStaffAssignment.updateMany({ where: { userId: staff.id }, data: { revokedAt: new Date() } });
    assert.equal((await request("/api/registrations/search", rosterQuery)).status, 403, "An old valid session does not bypass assignment revocation");
    const visible = await (await request("/api/registrations/options")).json() as { editions: unknown[] };
    assert.equal(visible.editions.length, 0);

  } finally {
    await db.$transaction(async (tx) => {
      const sites = await tx.editionVenue.findMany({ where: { editionId: { in: editions } }, select: { venueId: true } });
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
