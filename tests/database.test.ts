import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { Prisma, PrismaClient } from "@prisma/client";
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
after(() => db.$disconnect());

test("database is reachable", async () => {
  assert.deepEqual(await db.$queryRaw`SELECT 1 AS value`, [{ value: 1 }]);
});

test("database rejects duplicate emails and unknown roles", async () => {
  const email = `test-${randomUUID()}@example.invalid`;
  try {
    const user = await db.user.create({ data: { email, name: "Синтетический участник" } });
    assert.equal(user.role, "STUDENT");
    await assert.rejects(db.user.create({ data: { email, name: "Синтетический участник" } }),
      (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002");
    await assert.rejects(db.$executeRaw`UPDATE "User" SET "role" = 'ADMIN' WHERE "id" = ${user.id}::uuid`);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: user.id } })).role, "STUDENT");
  } finally { await db.user.deleteMany({ where: { email } }); }
});

test("profile requires existing university and course", async () => {
  const user = await db.user.create({ data: { name: "Синтетический участник", email: `fk-${randomUUID()}@example.invalid` } });
  try {
    await assert.rejects(db.studentProfile.create({ data: {
      userId: user.id, fullName: "Синтетический участник", universityId: randomUUID(), courseId: randomUUID(),
    } }), (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003");
  } finally { await db.user.delete({ where: { id: user.id } }); }
});

test("editions store independent years and reject duplicate year", async () => {
  // Roll back synthetic editions even when assertions fail; no persistent fixture years.
  const rollback = new Error("rollback fixture");
  await assert.rejects(db.$transaction(async (tx) => {
    const editions = await tx.olympiadEdition.findMany({ select: { year: true } });
    const used = new Set(editions.map((e) => e.year));
    let year = 8000;
    while (used.has(year) || used.has(year + 1)) year += 2;
    const first = await tx.olympiadEdition.create({ data: { year, title: "Тестовый выпуск" } });
    const next = await tx.olympiadEdition.create({ data: { year: year + 1, title: "Следующий тестовый выпуск" } });
    assert.notEqual(first.id, next.id);
    assert.equal(first.timezone, "Asia/Novosibirsk");
    throw rollback;
  }), (e: unknown) => e === rollback);
  // Unique-index check in a separate transaction, since a constraint failure aborts PostgreSQL transactions.
  await assert.rejects(db.$transaction(async (tx) => {
    const row = { year: 9999, title: "Проверка уникальности" };
    await tx.olympiadEdition.create({ data: row });
    await tx.olympiadEdition.create({ data: row });
  }), (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002");
});
