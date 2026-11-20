import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "../src/lib/pg-adapter";
import { chromium, type BrowserContext } from "playwright";
import { hashPassword } from "better-auth/crypto";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { test } from "node:test";
const base = process.env.TEST_BASE_URL;
if (!base || !["localhost", "127.0.0.1"].includes(new URL(base).hostname)) throw new Error("Local synthetic test server required");
test("two browser sessions see attendance within ten seconds, reconnect and lose revoked access", { timeout: 180000 }, async () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined, args: ["--no-sandbox"] });
  const errors: string[] = [];
  const newContext = async () => {
    const context = await browser.newContext();
    context.on("page", page => {
      page.on("pageerror", error => errors.push(error.message));
      page.on("console", message => {
        if (message.text().includes("Calling client.query()")) errors.push("PG_CONCURRENT_QUERY_WARNING");
      });
    });
    return context;
  };
  const tag = randomUUID(), password = `Synthetic-browser-${tag}`;
  const ids: string[] = [];
  let editionId: string | undefined, venueId: string | undefined, universityId: string | undefined, courseId: string | undefined;
  const request = (context: BrowserContext, path: string, data: unknown) => context.request.post(`${base}${path}`, { data, headers: { Origin: new URL(base).origin } });
  try {
    await db.rateLimit.deleteMany();
    const chief = await db.user.create({ data: { name: "Учебный главный браузер", email: `browser-chief-${tag}@example.test`, role: "CHIEF_ORGANIZER", emailVerified: true } }); ids.push(chief.id);
    const staff = await db.user.create({ data: { name: "Учебный организатор браузер", email: `browser-staff-${tag}@example.test`, role: "VENUE_ORGANIZER", emailVerified: true } }); ids.push(staff.id);
    const student = await db.user.create({ data: { name: "Учебный участник браузер", email: `browser-student-${tag}@example.test`, emailVerified: true } }); ids.push(student.id);
    const edition = await db.olympiadEdition.create({ data: { year: 6800, title: "Браузерный учебный выпуск", registrationOpensAt: new Date(Date.now() - 3600000), registrationClosesAt: new Date(Date.now() + 86400000) } }); editionId = edition.id;
    const venue = await db.venue.create({ data: { name: "Учебная площадка браузер" } }); venueId = venue.id;
    const site = await db.editionVenue.create({ data: { editionId, venueId, address: "Учебный адрес" } });
    await db.editionStaffGrant.create({ data: { userId: chief.id, editionId } });
    await db.venueStaffAssignment.create({ data: { userId: staff.id, editionId, editionVenueId: site.id } });
    const university = await db.university.create({ data: { name: "Учебный вуз браузер", abbreviation: "УВ" } }); universityId = university.id;
    const course = await db.courseOption.create({ data: { label: "Учебный курс браузер" } }); courseId = course.id;
    const consent = await db.consentRecord.create({ data: { userId: student.id, purpose: "synthetic-demo-only", textVersion: "demo", textHash: "a".repeat(64) } });
    const participation = await db.participation.create({ data: { userId: student.id, editionId, format: "ONSITE", editionVenueId: site.id, fullName: student.name, universityId, universityName: university.name, universityAbbreviation: university.abbreviation, courseId, courseLabel: course.label, consentId: consent.id } });
    const observer = await newContext(), editor = await newContext();
    for (const [context, user] of [[observer, staff], [editor, chief]] as const) {
      await db.account.create({ data: { userId: user.id, accountId: user.id, providerId: "credential", password: await hashPassword(password) } });
      assert.equal((await request(context, "/api/auth/sign-in/email", { email: user.email, password })).status(), 200);
    }
    await db.studentProfile.create({ data: { userId: student.id, fullName: student.name, universityId, courseId } });
    const recipient = await db.user.create({ data: { name: "Учебный приглашённый браузер", email: `browser-recipient-${tag}@example.test`, emailVerified: true } }); ids.push(recipient.id);
    const recipientConsent = await db.consentRecord.create({ data: { userId: recipient.id, purpose: "synthetic-demo-only", textVersion: "demo", textHash: "a".repeat(64) } });
    const recipientParticipation = await db.participation.create({ data: { userId: recipient.id, editionId, format: "ONSITE", editionVenueId: site.id, fullName: recipient.name, universityId, universityName: university.name, universityAbbreviation: university.abbreviation, courseId, courseLabel: course.label, consentId: recipientConsent.id } });
    const captainContext = await newContext(), recipientContext = await newContext();
    for (const [context, user] of [[captainContext, student], [recipientContext, recipient]] as const) {
      await db.account.create({ data: { userId: user.id, accountId: user.id, providerId: "credential", password: await hashPassword(password) } });
      assert.equal((await request(context, "/api/auth/sign-in/email", { email: user.email, password })).status(), 200);
    }
    const captainPage = await captainContext.newPage();
    await captainPage.goto(`${base}/cabinet/profile`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await captainPage.getByLabel("ФИО", { exact: true }).fill("Обновлённый учебный профиль браузер");
    const [saved] = await Promise.all([captainPage.waitForResponse(r => new URL(r.url()).pathname === "/api/profile" && r.request().method() === "PATCH"), captainPage.getByRole("button", { name: "Сохранить сведения" }).click()]);
    assert.equal(saved.status(), 200);
    assert.equal((await db.participation.findUniqueOrThrow({ where: { id: participation.id } })).fullName, student.name);
    await captainPage.goto(`${base}/cabinet/teams`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await captainPage.getByLabel("ФИО тренера").fill("Учебный тренер браузер");
    await captainPage.getByRole("button", { name: "Создать команду" }).click();
    await captainPage.getByRole("heading", { name: "УВ-1", exact: true }).waitFor();
    const recipientPage = await recipientContext.newPage();
    await recipientPage.goto(`${base}/cabinet/teams`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await recipientPage.getByLabel("ФИО тренера").fill("Учебный тренер второй команды");
    await recipientPage.getByRole("button", { name: "Создать команду", exact: true }).click();
    await recipientPage.getByRole("heading", { name: "УВ-2", exact: true }).waitFor();
    await captainPage.getByLabel("Пригласить по точному email").fill(recipient.email);
    const [sent] = await Promise.all([captainPage.waitForResponse(r => new URL(r.url()).pathname === "/api/teams/action"), captainPage.getByRole("button", { name: "Пригласить в ЛК" }).click()]);
    assert.equal(sent.status(), 200);
    await recipientPage.getByRole("button", { name: "Обновить команды и приглашения", exact: true }).click();
    await recipientPage.getByText(/Приглашение в УВ-1/).waitFor();
    assert.equal(await recipientPage.getByRole("button", { name: "Принять приглашение", exact: true }).isDisabled(), true);
    await recipientPage.getByLabel("Подтверждаю удаление команды", { exact: true }).check();
    const [deletedTeam] = await Promise.all([
      recipientPage.waitForResponse(r => new URL(r.url()).pathname === "/api/teams/action"),
      recipientPage.getByRole("button", { name: "Удалить команду", exact: true }).click(),
    ]);
    assert.equal(deletedTeam.status(), 200);
    assert.equal((await db.participation.findUniqueOrThrow({ where: { id: recipientParticipation.id } })).status, "REGISTERED");
    await recipientPage.getByRole("button", { name: "Принять приглашение" }).click();
    await recipientPage.getByRole("heading", { name: "УВ-1", exact: true }).waitFor();
    assert.equal(await db.teamMember.count({ where: { editionId } }), 2);
    await recipientPage.goto(`${base}/cabinet/cancel?editionId=${editionId}&participationId=${recipientParticipation.id}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await recipientPage.getByRole("checkbox", { name: "Я понимаю, что восстановить участие нельзя" }).check();
    const [cancelled] = await Promise.all([recipientPage.waitForResponse(r => new URL(r.url()).pathname === "/api/participations/cancel"), recipientPage.getByRole("button", { name: "Отменить участие", exact: true }).click()]);
    assert.equal(cancelled.status(), 200);
    assert.equal((await db.participation.findUniqueOrThrow({ where: { id: recipientParticipation.id } })).status, "CANCELLED");
    assert.equal(await db.teamMember.count({ where: { editionId } }), 1);

    await captainPage.close(); await recipientPage.close();
    console.info("Browser: profile isolation, team creation/invitation and cancellation with slot release passed");
    const page = await observer.newPage(), otherPage = await editor.newPage();
    console.info("Browser: opening observer after email/password login");
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
    assert.deepEqual(errors, [], "No browser runtime errors");
  } finally {
    await browser.close();
    if (editionId) {
      await db.team.deleteMany({ where: { editionId } });
      await db.participation.deleteMany({ where: { editionId } });
      await db.auditEvent.deleteMany({ where: { OR: [{ editionId }, { actorId: { in: ids } }] } });
      await db.venueStaffAssignment.deleteMany({ where: { editionId } });
      await db.editionStaffGrant.deleteMany({ where: { editionId } });
      await db.editionVenue.deleteMany({ where: { editionId } });
      await db.olympiadEdition.delete({ where: { id: editionId } });
    }
    if (venueId) await db.venue.delete({ where: { id: venueId } });
    await db.studentProfile.deleteMany({ where: { userId: { in: ids } } });
    await db.consentRecord.deleteMany({ where: { userId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
    if (universityId) await db.university.delete({ where: { id: universityId } });
    if (courseId) await db.courseOption.delete({ where: { id: courseId } });
    await db.$disconnect();
  }
});
