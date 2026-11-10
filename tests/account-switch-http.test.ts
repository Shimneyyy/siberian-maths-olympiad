import "dotenv/config";
import { test } from "node:test";
import { existsSync } from "node:fs";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "better-auth/crypto";
import { chromium } from "playwright";
const base = process.env.TEST_BASE_URL!;
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname) || !/^\/smo_test_[a-f0-9]+$/.test(new URL(process.env.DATABASE_URL!).pathname)) throw new Error("Disposable synthetic database required");
test("same browser switches admin to newly registered/verified student, including DOM autofill", { timeout: 120000 }, async () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined), args: ["--no-sandbox"] });
  try {
    const adminPassword = `Synthetic-admin-${randomUUID()}`, studentPassword = `Synthetic-student-${randomUUID()}`;
    const admin = await db.user.create({ data: { name: "Учебный администратор переключения", email: `switch-admin-${randomUUID()}@example.test`, role: "TECHNICAL_ADMIN", emailVerified: true } });
    await db.account.create({ data: { userId: admin.id, accountId: admin.id, providerId: "credential", password: await hashPassword(adminPassword) } });
    const studentEmail = `switch-student-${randomUUID()}@example.test`;
    const missing = await promisify(execFile)(process.execPath, ["--import", "tsx", "scripts/inspect-demo-account.ts", studentEmail]);
    assert.deepEqual(JSON.parse(missing.stdout), { exists: false, temporaryTestDatabase: true });
    await assert.rejects(promisify(execFile)(process.execPath, ["--import", "tsx", "scripts/inspect-demo-account.ts", "synthetic@example.invalid"]));
    await assert.rejects(promisify(execFile)(process.execPath, ["--import", "tsx", "scripts/inspect-demo-account.ts", studentEmail], { env: { ...process.env, NODE_ENV: "production" } }));
    const context = await browser.newContext(), page = await context.newPage();
    const post = (path: string, data: unknown) => context.request.post(`${base}/api/auth/${path}`, { headers: { Origin: base }, data });
    assert.equal((await post("sign-in/email", { email: admin.email, password: adminPassword })).status(), 200);
    await page.goto(`${base}/cabinet`); await page.getByText("Технический администратор", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Выйти", exact: true }).click(); await page.waitForURL(`${base}/login`);
    assert.equal((await context.request.get(`${base}/api/me`)).status(), 401);
    await page.goto(`${base}/register`);
    await page.getByLabel("ФИО", { exact: true }).fill("Синтетический студент переключения");
    await page.locator('select[name="universityId"]').selectOption({ label: "Демонстрационный университет" });
    await page.locator('select[name="courseId"]').selectOption({ label: "Демонстрационный курс" });
    await page.getByLabel("Email", { exact: true }).fill(studentEmail);
    await page.locator('input[name="password"]').fill(studentPassword);
    await page.getByLabel("Имя латиницей для логина", { exact: true }).fill("Synthetic");
    await page.getByLabel("Фамилия латиницей для логина", { exact: true }).fill("Student");
    await page.getByRole("checkbox", { name: "Использую только вымышленные данные", exact: false }).check();
    const [registered] = await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === "/api/auth/sign-up/email"), page.getByRole("button", { name: "Продолжить", exact: true }).click()]);
    assert.equal(registered.status(), 200); await page.waitForURL(`${base}/verify`);
    const user = await db.user.findUniqueOrThrow({ where: { email: studentEmail } }); assert.equal(user.role, "STUDENT");
    const search = await (await fetch(`http://127.0.0.1:8025/api/v1/search?query=${encodeURIComponent(`to:${studentEmail}`)}`)).json() as { messages: { ID: string }[] };
    assert.equal(search.messages.length, 1);
    const message = await (await fetch(`http://127.0.0.1:8025/api/v1/message/${search.messages[0].ID}`)).json() as { Text: string };
    const code = message.Text.match(/\b\d{6}\b/)?.[0]; assert.ok(code);
    await page.getByLabel("Email", { exact: true }).fill(studentEmail);
    await page.getByLabel("Код из письма", { exact: true }).fill(code);
    const [verified] = await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === "/api/auth/email-otp/verify-email"), page.getByRole("button", { name: "Продолжить", exact: true }).click()]);
    assert.equal(verified.status(), 200); await page.waitForURL(`${base}/login`);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerified, true);
    assert.equal(await db.account.count({ where: { userId: user.id, providerId: "credential" } }), 1);
    const diagnosis = await promisify(execFile)(process.execPath, ["--import", "tsx", "scripts/inspect-demo-account.ts", studentEmail]);
    assert.deepEqual(JSON.parse(diagnosis.stdout), { exists: true, role: "STUDENT", emailVerified: true, hasLocalPassword: true, hasStudentProfile: true, temporaryTestDatabase: true });
    assert.ok(!diagnosis.stdout.includes(studentEmail) && !diagnosis.stdout.includes(studentPassword), "Diagnostic output contains flags only");
    await page.getByLabel("Email", { exact: true }).fill(studentEmail);
    await page.locator('input[name="password"]').fill(studentPassword);
    await page.getByRole("button", { name: "Продолжить", exact: true }).click(); await page.waitForURL(`${base}/cabinet`);
    const me = await context.request.get(`${base}/api/me`); assert.equal(me.status(), 200); assert.equal((await me.json()).user.id, user.id);
    assert.equal(await page.getByText("Технический администратор", { exact: true }).count(), 0);
    await page.goto(`${base}/cabinet/admin`); assert.equal(new URL(page.url()).pathname, "/cabinet");
    console.info("Normal UI admin sign-out → student signup → mailbox proof → student login passed");
    await page.getByRole("button", { name: "Выйти", exact: true }).click(); await page.waitForURL(`${base}/login`);
    // A password manager may update DOM values without dispatching React onChange.
    await page.getByLabel("Email", { exact: true }).evaluate((element, value) => { (element as HTMLInputElement).value = value; }, studentEmail);
    await page.locator('input[name="password"]').fill(studentPassword);
    const [request] = await Promise.all([page.waitForRequest(r => new URL(r.url()).pathname === "/api/auth/sign-in/email"), page.getByRole("button", { name: "Продолжить", exact: true }).click()]);
    assert.ok(request.postDataJSON().email === studentEmail, "Submitted email must match the visible autofilled input");
    await page.waitForURL(`${base}/cabinet`);
    assert.equal((await(await context.request.get(`${base}/api/me`)).json()).user.id, user.id);
    await page.getByRole("button", { name: "Выйти", exact: true }).click(); await page.waitForURL(`${base}/login`);
    await page.getByLabel("Email", { exact: true }).fill(admin.email);
    await page.locator('input[name="password"]').fill(adminPassword);
    await page.getByRole("button", { name: "Продолжить", exact: true }).click(); await page.waitForURL(`${base}/cabinet`);
    assert.equal((await(await context.request.get(`${base}/api/me`)).json()).user.id, admin.id);
    console.info("DOM autofill and reverse student → admin login with email/password passed");
  } finally { await browser.close(); await db.$disconnect(); }
});

test("unverified login completes OTP visibly on the same login route and reports resend failures", { timeout: 90000 }, async () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined), args: ["--no-sandbox"] });
  try {
    await db.rateLimit.deleteMany(); // This suite can run only in its disposable synthetic DB.
    const password = `Synthetic-verify-${randomUUID()}`;
    const user = await db.user.create({ data: { name: "Учебный неподтверждённый организатор", email: `verify-${randomUUID()}@example.test`, role: "CHIEF_ORGANIZER" } });
    await db.account.create({ data: { userId: user.id, accountId: user.id, providerId: "credential", password: await hashPassword(password) } });
    const context = await browser.newContext(), page = await context.newPage();
    // Standalone verification can also be autofilled before React sees an email.
    await page.goto(`${base}/verify`);
    await page.locator('button[type="submit"]:enabled').waitFor();
    await page.getByLabel("Email", { exact: true }).evaluate((element, value) => { (element as HTMLInputElement).value = value; }, user.email.toUpperCase());
    await page.route("**/api/auth/email-otp/send-verification-otp", async route => {
      assert.equal(route.request().postDataJSON().email, user.email);
      await route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ code: "TEST_FAILURE", message: "Synthetic failure" }) });
    });
    await page.getByRole("button", { name: "Отправить код повторно" }).click();
    await page.getByRole("status").filter({ hasText: "Не удалось отправить" }).waitFor();
    await page.unroute("**/api/auth/email-otp/send-verification-otp");
    await page.goto(`${base}/login`);
    await page.getByLabel("Email", { exact: true }).fill(user.email);
    await page.locator('input[name="password"]').fill(password);
    await page.getByRole("button", { name: "Продолжить", exact: true }).click();
    await page.getByRole("heading", { name: "Подтверждение email", exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, "/login", "Login enters verification without changing its route");
    const resendPath = "**/api/auth/email-otp/send-verification-otp";
    for (const status of [429, 503]) {
      await page.route(resendPath, route => route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ code: "TEST_FAILURE", message: "Synthetic failure" }) }));
      await page.getByRole("button", { name: "Отправить код повторно" }).click();
      await page.getByRole("status").filter({ hasText: "Не удалось отправить" }).waitFor({ timeout: 10000 });
      assert.equal((await db.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerified, false);
      await page.unroute(resendPath);
    }
    // Resend must read browser-autofilled DOM email too, not stale React state.
    const submittedEmail = user.email.toUpperCase();
    await page.getByLabel("Email", { exact: true }).evaluate((element, value) => { (element as HTMLInputElement).value = value; }, submittedEmail);
    const [resent] = await Promise.all([
      page.waitForRequest(r => new URL(r.url()).pathname === "/api/auth/email-otp/send-verification-otp"),
      page.getByRole("button", { name: "Отправить код повторно" }).click(),
    ]);
    assert.equal(resent.postDataJSON().email, user.email);
    await page.getByRole("status").filter({ hasText: "код отправлен" }).waitFor();
    const search = await (await fetch(`http://127.0.0.1:8025/api/v1/search?query=${encodeURIComponent(`to:${user.email}`)}`)).json() as { messages: { ID: string }[] };
    assert.ok(search.messages.length);
    const message = await (await fetch(`http://127.0.0.1:8025/api/v1/message/${search.messages[0].ID}`)).json() as { Text: string };
    const code = message.Text.match(/\b\d{6}\b/)?.[0]; assert.ok(code);
    await page.getByLabel("Код из письма", { exact: true }).fill(code === "000000" ? "000001" : "000000");
    await page.getByRole("button", { name: "Продолжить", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Код неверен" }).waitFor();
    assert.equal((await context.request.get(`${base}/api/me`)).status(), 401);
    await page.getByLabel("Код из письма", { exact: true }).fill(code);
    await page.getByRole("button", { name: "Продолжить", exact: true }).click();
    await page.getByRole("heading", { name: "Вход в личный кабинет", exact: true }).waitFor({ timeout: 10000 });
    await page.getByRole("status").filter({ hasText: "Email подтверждён" }).waitFor();
    assert.equal(await page.locator('input[name="code"]').count(), 0);
    assert.equal(await page.locator('input[name="password"]').inputValue(), "");
    assert.equal(await page.getByLabel("Email", { exact: true }).inputValue(), user.email);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerified, true);
    await page.locator('input[name="password"]').fill(password);
    await page.getByRole("button", { name: "Продолжить", exact: true }).click();
    await page.waitForURL(`${base}/cabinet`);
    assert.equal((await (await context.request.get(`${base}/api/me`)).json()).user.id, user.id);
  } finally { await browser.close(); await db.$disconnect(); }
});

test("cabinet navigation separates every section for all roles on mobile and desktop", { timeout: 90000 }, async () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined), args: ["--no-sandbox"] });
  try {
    const password = `Synthetic-layout-${randomUUID()}`, hash = await hashPassword(password);
    for (const role of ["STUDENT", "CHIEF_ORGANIZER", "VENUE_ORGANIZER", "TECHNICAL_ADMIN"] as const) {
      await db.rateLimit.deleteMany();
      const user = role === "TECHNICAL_ADMIN" ? await db.user.findFirstOrThrow({ where: { role } }) : await db.user.create({ data: { name: "Учебная проверка меню", email: `layout-${randomUUID()}@example.test`, emailVerified: true, role } });
      await db.account.upsert({ where: { providerId_accountId: { providerId: "credential", accountId: user.id } }, create: { userId: user.id, accountId: user.id, providerId: "credential", password: hash }, update: { password: hash } });
      const context = await browser.newContext(), page = await context.newPage();
      assert.equal((await context.request.post(`${base}/api/auth/sign-in/email`, { headers: { Origin: base }, data: { email: user.email, password } })).status(), 200);
      for (const width of [1280, 375]) {
        await page.setViewportSize({ width, height: 900 }); await page.goto(`${base}/cabinet`);
        const layout = await page.locator("main").evaluate(main => {
          const links = [...main.querySelectorAll<HTMLAnchorElement>('a[href^="/cabinet/"]')];
          return { contained: links.every(a => a.closest('nav[aria-label="Разделы кабинета"]')), overflow: document.documentElement.scrollWidth > innerWidth,
            rects: links.map(a => { const r = a.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; }) };
        });
        assert.ok(layout.contained, `${role}: all section links belong to the cabinet navigation`);
        assert.equal(layout.overflow, false, `${role}: no page overflow at ${width}px`);
        for (let i = 0; i < layout.rects.length; i++) for (let j = i + 1; j < layout.rects.length; j++) {
          const a = layout.rects[i], b = layout.rects[j];
          assert.ok(a.right + 8 <= b.left || b.right + 8 <= a.left || a.bottom + 8 <= b.top || b.bottom + 8 <= a.top, `${role}: readable space between links at ${width}px`);
        }
      }
      await context.close();
    }
  } finally { await browser.close(); await db.$disconnect(); }
});
