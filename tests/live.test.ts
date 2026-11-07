import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { chromium, type BrowserContext } from "playwright";
import { hashPassword } from "better-auth/crypto";
import { randomUUID, createHmac } from "node:crypto";
import assert from "node:assert/strict";
import { test } from "node:test";
const base = process.env.TEST_BASE_URL;
if (!base || !["localhost", "127.0.0.1"].includes(new URL(base).hostname)) throw new Error("Local synthetic test server required");
function totp(uri: string) {
  const encoded = new URL(uri).searchParams.get("secret")!;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...encoded.replace(/=+$/, "")].map(x => alphabet.indexOf(x.toUpperCase()).toString(2).padStart(5, "0")).join("");
  const secret = Buffer.from(bits.match(/.{8}/g)!.map(x => parseInt(x, 2)));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac("sha1", secret).update(counter).digest();
  return String((digest.readUInt32BE(digest[digest.length - 1] & 15) & 0x7fffffff) % 1000000).padStart(6, "0");
}
test("two browser sessions see attendance within ten seconds, reconnect and lose revoked access", { timeout: 150000 }, async () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined, args: ["--no-sandbox"] });
  const tag = randomUUID(), password = `Synthetic-browser-${tag}`;
  const ids: string[] = [];
  let editionId: string | undefined, venueId: string | undefined, universityId: string | undefined, courseId: string | undefined;
  const request = (context: BrowserContext, path: string, data: unknown) => context.request.post(`${base}${path}`, { data, headers: { Origin: new URL(base).origin } });
  try {
    await db.rateLimit.deleteMany();
    const chief = await db.user.create({ data: { name: "Учебный главный браузер", email: `browser-chief-${tag}@example.test`, role: "CHIEF_ORGANIZER", emailVerified: true } }); ids.push(chief.id);
    const staff = await db.user.create({ data: { name: "Учебный организатор браузер", email: `browser-staff-${tag}@example.test`, role: "VENUE_ORGANIZER", emailVerified: true } }); ids.push(staff.id);
    const student = await db.user.create({ data: { name: "Учебный участник браузер", email: `browser-student-${tag}@example.test`, emailVerified: true } }); ids.push(student.id);
    const edition = await db.olympiadEdition.create({ data: { year: 6800, title: "Браузерный учебный выпуск" } }); editionId = edition.id;
    const venue = await db.venue.create({ data: { name: "Учебная площадка браузер" } }); venueId = venue.id;
    const site = await db.editionVenue.create({ data: { editionId, venueId, address: "Учебный адрес" } });
    await db.editionStaffGrant.create({ data: { userId: chief.id, editionId } });
    await db.venueStaffAssignment.create({ data: { userId: staff.id, editionId, editionVenueId: site.id } });
    const university = await db.university.create({ data: { name: "Учебный вуз браузер", abbreviation: "УВ" } }); universityId = university.id;
    const course = await db.courseOption.create({ data: { label: "Учебный курс браузер" } }); courseId = course.id;
    const consent = await db.consentRecord.create({ data: { userId: student.id, purpose: "synthetic-demo-only", textVersion: "demo", textHash: "a".repeat(64) } });
    const participation = await db.participation.create({ data: { userId: student.id, editionId, format: "ONSITE", editionVenueId: site.id, fullName: student.name, universityId, universityName: university.name, universityAbbreviation: university.abbreviation, courseId, courseLabel: course.label, consentId: consent.id } });
    const observer = await browser.newContext(), editor = await browser.newContext();
    for (const [context, user] of [[observer, staff], [editor, chief]] as const) {
      await db.account.create({ data: { userId: user.id, accountId: user.id, providerId: "credential", password: await hashPassword(password) } });
      assert.equal((await request(context, "/api/auth/sign-in/email", { email: user.email, password })).status(), 200);
      const enrollment = await (await request(context, "/api/auth/two-factor/enable", { password, method: "totp" })).json();
      assert.equal((await request(context, "/api/auth/two-factor/verify-totp", { code: totp(enrollment.totpURI), trustDevice: false })).status(), 200);
    }
    const page = await observer.newPage(), otherPage = await editor.newPage();
    page.on("pageerror", error => console.info("Browser runtime error:", error.message));
    console.info("Browser: opening observer after real TOTP login");
    await page.goto(`${base}/cabinet/registrations`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await otherPage.goto(`${base}/cabinet/registrations`, { waitUntil: "domcontentloaded", timeout: 60000 });
    console.info("Browser: both rosters loaded");
    const selector = `select[aria-label="Явка: ${student.name}"]`;
    await page.locator(selector).waitFor();
    assert.equal(await page.locator(selector).inputValue(), "UNMARKED");
    const changed = Date.now();
    await otherPage.locator(selector).selectOption("PRESENT");
    await page.waitForFunction(s => (document.querySelector(s) as HTMLSelectElement)?.value === "PRESENT", selector, { timeout: 10000 });
    assert.ok(Date.now() - changed < 10000);
    await observer.setOffline(true);
    await page.getByText("Связь потеряна. Повторное подключение выполняется автоматически.").waitFor({ timeout: 10000 });
    await page.locator(selector).waitFor({ state: "detached", timeout: 10000 });
    assert.equal(await page.locator(selector).count(), 0, "Stale personal data hidden on network error");
    await observer.setOffline(false);
    await page.locator(selector).waitFor({ timeout: 10000 });
    assert.equal(await page.locator(selector).inputValue(), "PRESENT");
    await db.venueStaffAssignment.updateMany({ where: { userId: staff.id }, data: { revokedAt: new Date() } });
    await page.waitForFunction(s => !document.querySelector(s), selector, { timeout: 10000 });
    assert.equal((await request(observer, "/api/attendance", { editionId, participationId: participation.id, revision: 1, status: "ABSENT" })).status(), 403);
    assert.equal((await request(observer, "/api/registrations/search", { editionId })).status(), 403);
  } finally {
    await browser.close();
    if (editionId) {
      await db.participation.deleteMany({ where: { editionId } });
      await db.auditEvent.deleteMany({ where: { OR: [{ editionId }, { actorId: { in: ids } }] } });
      await db.venueStaffAssignment.deleteMany({ where: { editionId } });
      await db.editionStaffGrant.deleteMany({ where: { editionId } });
      await db.editionVenue.deleteMany({ where: { editionId } });
      await db.olympiadEdition.delete({ where: { id: editionId } });
    }
    if (venueId) await db.venue.delete({ where: { id: venueId } });
    await db.consentRecord.deleteMany({ where: { userId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
    if (universityId) await db.university.delete({ where: { id: universityId } });
    if (courseId) await db.courseOption.delete({ where: { id: courseId } });
    await db.$disconnect();
  }
});
