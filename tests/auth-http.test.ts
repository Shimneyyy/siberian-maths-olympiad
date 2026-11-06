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
async function request(path: string, body?: unknown, cookie = true, requestOrigin = origin) {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST", redirect: "manual",
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
