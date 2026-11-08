import "dotenv/config";
import { existsSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { chromium } from "playwright";
import { randomUUID, createHmac } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
function totp(uri: string) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...new URL(uri).searchParams.get("secret")!].map(c => chars.indexOf(c).toString(2).padStart(5,"0")).join("");
  const key = Buffer.from(bits.match(/.{8}/g)!.map(x => parseInt(x,2)));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
  const digest = createHmac("sha1",key).update(counter).digest();
  return String((digest.readUInt32BE(digest[digest.length-1]&15)&0x7fffffff)%1000000).padStart(6,"0");
}
test("D04 browser publication, cancelled reader, immutable content and HTTP authorization", { timeout: 180000 }, async () => {
  const base = process.env.TEST_BASE_URL!;
  assert.ok(["localhost","127.0.0.1"].includes(new URL(base).hostname));
  assert.ok(new URL(process.env.DATABASE_URL!).pathname.startsWith("/smo_test_"));
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined), args: ["--no-sandbox"] });
  const errors: string[] = [];
  try {
    const password = `Synthetic-${randomUUID()}`;
    const chief = await db.user.create({ data: { name: "Учебный главный", email: `${randomUUID()}@example.test`, role: "CHIEF_ORGANIZER", emailVerified: true } });
    const reader = await db.user.create({ data: { name: "Учебный читатель", email: `${randomUUID()}@example.test`, emailVerified: true } });
    const edition = await db.olympiadEdition.create({ data: { year: 8090, title: "Учебные объявления" } });
    const other = await db.olympiadEdition.create({ data: { year: 8091, title: "Другой год" } });
    await db.editionStaffGrant.create({ data: { userId: chief.id, editionId: edition.id } });
    const uni = await db.university.findFirstOrThrow(), course = await db.courseOption.findFirstOrThrow();
    const consent = await db.consentRecord.create({ data: { userId: reader.id, purpose: "synthetic-demo-only", textVersion: "demo", textHash: "a".repeat(64) } });
    await db.participation.create({ data: { userId: reader.id, editionId: edition.id, format: "REMOTE", remoteZone: "NSK", status: "CANCELLED", fullName: reader.name, universityId: uni.id, universityName: uni.name, universityAbbreviation: uni.abbreviation, courseId: course.id, courseLabel: course.label, consentId: consent.id } });
    const writer = await browser.newContext(), recipient = await browser.newContext();
    const post = (ctx: typeof writer, path: string, data: unknown, origin = base) => ctx.request.post(`${base}/api/${path}`, { headers: { origin }, data });
    for (const [ctx,user] of [[writer,chief],[recipient,reader]] as const) {
      await db.account.create({ data: { userId: user.id, accountId: user.id, providerId: "credential", password: await hashPassword(password) } });
      assert.equal((await post(ctx,"auth/sign-in/email",{ email: user.email, password })).status(),200);
    }
    const input = { editionId: edition.id, editionVenueId: null, title: "Учебная публикация", body: "<script>не исполняется</script>", important: true, password };
    assert.equal((await post(writer,"announcements",input)).status(),403);
    const factor = await (await post(writer,"auth/two-factor/enable",{password,method:"totp"})).json();
    assert.equal((await post(writer,"auth/two-factor/verify-totp",{code:totp(factor.totpURI),trustDevice:false})).status(),200);
    assert.equal((await post(writer,"announcements",input,"https://untrusted.invalid")).status(),403);
    assert.equal((await post(writer,"announcements",{...input,editionId:other.id})).status(),403);
    assert.equal((await post(recipient,"announcements",input)).status(),403);
    const page = await writer.newPage(); page.on("pageerror", e => { errors.push(e.message); console.log("Browser runtime:",e.message); });
    await page.goto(`${base}/cabinet/announcements`);
    await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled);
    await page.getByLabel("Заголовок", {exact:true}).fill(input.title);
    await page.getByLabel("Текст", {exact:true}).fill(input.body);
    await page.getByLabel("Важное", {exact:false}).check();
    await page.getByLabel("Текущий пароль", {exact:true}).fill(password);
    await page.getByRole("button",{name:"Сохранить черновик",exact:true}).click();
    await page.getByRole("status").filter({hasText:"Черновик сохранён"}).waitFor();
    const draft = await db.announcement.findFirstOrThrow();
    const hidden = await post(recipient,"announcements/search",{editionId:edition.id});
    assert.equal(hidden.status(),200); assert.deepEqual(await hidden.json(),[]);
    const article = page.getByRole("article").filter({hasText:input.title});
    await article.getByLabel("Текущий пароль",{exact:true}).fill(password);
    await article.getByLabel("Подтверждаю публикацию",{exact:false}).check();
    await article.getByRole("button",{name:"Опубликовать",exact:true}).click();
    await page.getByRole("status").filter({hasText:"Опубликовано"}).waitFor();
    const read = await post(recipient,"announcements/search",{editionId:edition.id});
    assert.ok(read.headers()["cache-control"].includes("no-store")); assert.equal((await read.json()).length,1);
    assert.equal((await post(writer,"announcements",{...input,id:draft.id,revision:1})).status(),409);
    const viewed = await recipient.newPage(); viewed.on("pageerror", e => errors.push(e.message));
    await viewed.goto(`${base}/cabinet/announcements`);
    await viewed.getByRole("button",{name:"Показать объявления",exact:true}).click();
    await viewed.getByRole("heading",{name:input.title,exact:true}).waitFor();
    assert.equal(await viewed.getByText(input.body,{exact:true}).count(),1);
    assert.equal(await db.outboxJob.count(),1);
    assert.deepEqual(errors,[]);
    await db.editionStaffGrant.update({where:{userId_editionId:{userId:chief.id,editionId:edition.id}},data:{revokedAt:new Date()}});
    assert.equal((await post(writer,"announcements/search",{editionId:edition.id})).status(),403);
    assert.equal((await post(recipient,"announcements/search",{editionId:other.id})).status(),403);
  } finally { await browser.close(); await db.$disconnect(); }
});
