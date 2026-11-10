import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "../src/lib/pg-adapter";
import { chromium } from "playwright";
const base = process.env.TEST_BASE_URL!, scenario = process.env.TEST_REGISTRATION_FAILURE;
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname) || !/^\/smo_test_[a-f0-9]+$/.test(new URL(process.env.DATABASE_URL!).pathname)) throw new Error("Disposable synthetic database required");

test(`signup reports ${scenario} failure without blaming fields and preserves transaction boundaries`, { timeout: 90000 }, async () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined), args: ["--no-sandbox"] });
  const email = `signup-failure-${randomUUID()}@example.test`;
  try {
    const page = await browser.newPage(); await page.goto(`${base}/register`);
    await page.getByLabel("ФИО", { exact: true }).fill("Учебный студент проверки отказа");
    await page.locator('select[name="universityId"]').selectOption({ label: "Демонстрационный университет" });
    await page.locator('select[name="courseId"]').selectOption({ label: "Демонстрационный курс" });
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.locator('input[name="password"]').fill(`Synthetic-${randomUUID()}`);
    await page.getByLabel("Имя латиницей для логина", { exact: true }).fill("Synthetic");
    await page.getByLabel("Фамилия латиницей для логина", { exact: true }).fill("Failure");
    await page.getByRole("checkbox", { name: "Использую только вымышленные данные", exact: false }).check();
    const [response] = await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === "/api/auth/sign-up/email"), page.getByRole("button", { name: "Продолжить", exact: true }).click()]);
    assert.equal(response.status(), 503);
    assert.match(response.headers()["cache-control"] ?? "", /no-store/);
    const body = await response.json();
    assert.equal(body.code, scenario === "keyring" ? "NSUHW_PREPARATION_UNAVAILABLE" : "VERIFICATION_DELIVERY_FAILED");
    await page.getByRole("status").filter({ hasText: scenario === "keyring" ? "не удаётся подготовить" : "Регистрация сохранена" }).waitFor();
    assert.equal(await page.getByText("Проверьте поля.", { exact: false }).count(), 0);
    const user = await db.user.findUnique({ where: { email }, include: { profile: true, preparedExternalAccount: true } });
    if (scenario === "keyring") {
      assert.equal(user, null, "Key failure rolls back account, profile, consent and candidate");
      assert.equal(await db.studentProfile.count(), 0); assert.equal(await db.consentRecord.count(), 0);
      assert.equal(existsSync(process.env.NSUHW_KEYRING_FILE!), false, "Never auto-reinitialize missing encryption keys");
    } else {
      assert.ok(user?.profile && user.preparedExternalAccount, "SMTP failure after commit retains the complete account");
      assert.equal(user.emailVerified, false);
    }
    assert.equal(await db.session.count(), 0, "Failure does not grant access");
    const rendered = await page.locator("main").innerText();
    assert.ok(!rendered.includes(".local/") && !rendered.includes("ECONNREFUSED"), "Public errors contain no infrastructure internals");
  } finally { await browser.close(); await db.$disconnect(); }
});
