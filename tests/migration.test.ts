import "dotenv/config";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";
test("R03 migration preserves old users, grants and annual history and enforces one administrator", async () => {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  const schema = `migration_${randomUUID().replaceAll("-", "")}`;
  await db.connect();
  try {
    await db.query(`CREATE SCHEMA "${schema}"`);
    await db.query(`SET search_path TO "${schema}"`);
    const migrations = (await readdir("prisma/migrations")).filter(x => /^\d/.test(x)).sort();
    for (const migration of migrations.filter(x => x < "20261107080000")) await db.query(await readFile(`prisma/migrations/${migration}/migration.sql`, "utf8"));
    const [student, chief, staff, edition, university, course, consent, participation] = Array.from({ length: 8 }, () => randomUUID());
    for (const [id, role] of [[student, "STUDENT"], [chief, "CHIEF_ORGANIZER"], [staff, "VENUE_ORGANIZER"]]) {
      await db.query('INSERT INTO "User" (id,email,name,role,"updatedAt") VALUES ($1,$2,$3,$4,now())', [id, `${id}@example.test`, "Синтетический аккаунт", role]);
    }
    await db.query('INSERT INTO "OlympiadEdition" (id,year,title) VALUES ($1,2027,$2)', [edition, "Учебный выпуск"]);
    await db.query('INSERT INTO "EditionStaffGrant" ("userId","editionId") VALUES ($1,$2)', [chief, edition]);
    await db.query('INSERT INTO "University" (id,name,abbreviation) VALUES ($1,$2,$3)', [university, "Учебный вуз", "УВ"]);
    await db.query('INSERT INTO "CourseOption" (id,label) VALUES ($1,$2)', [course, "Учебный курс"]);
    await db.query('INSERT INTO "ConsentRecord" (id,"userId",purpose,"textVersion","textHash") VALUES ($1,$2,$3,$4,$5)', [consent, student, "synthetic-demo-only", "demo", "a".repeat(64)]);
    await db.query('INSERT INTO "Participation" (id,"userId","editionId",format,"remoteZone","fullName","universityId","universityName","universityAbbreviation","courseId","courseLabel","consentId") VALUES ($1,$2,$3,\'REMOTE\',\'NSK\',$4,$5,$6,$7,$8,$9,$10)', [participation, student, edition, "Учебный участник", university, "Учебный вуз", "УВ", course, "Учебный курс", consent]);
    const snapshot = async () => Promise.all(["User", "EditionStaffGrant", "Participation"].map(async table => (await db.query(`SELECT * FROM "${table}" ORDER BY 1`)).rows));
    const before = await snapshot();
    for (const migration of migrations.filter(x => x >= "20261107080000")) await db.query(await readFile(`prisma/migrations/${migration}/migration.sql`, "utf8"));
    assert.deepEqual(await snapshot(), before);
    const createAdmin = () => db.query('INSERT INTO "User" (id,email,name,role,"updatedAt") VALUES ($1,$2,$3,\'TECHNICAL_ADMIN\',now())', [randomUUID(), `${randomUUID()}@example.test`, "Учебный администратор"]);
    await createAdmin();
    await assert.rejects(createAdmin(), (e: unknown) => (e as { code: string }).code === "23505");
  } finally {
    await db.query('SET search_path TO public');
    await db.query(`DROP SCHEMA "${schema}" CASCADE`);
    await db.end();
  }
});
