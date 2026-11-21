import "dotenv/config";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";
process.env.DEMO_REGISTRATION="true";
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
    const snapshot = async () => {
      const rows = [];
      for (const table of ["User", "EditionStaffGrant", "Participation"]) rows.push((await db.query(`SELECT * FROM "${table}" ORDER BY 1`)).rows.map(row => {
        const result = { ...row }; if (table === "Participation") delete result.revision; if (table === "User") delete result.twoFactorEnabled; return result;
      }));
      return rows;
    };
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

test("removing TOTP preserves enrolled accounts, credentials, sessions and year grants", async () => {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  const schema = `retire_factor_${randomUUID().replaceAll("-", "")}`;
  await db.connect();
  try {
    await db.query(`CREATE SCHEMA "${schema}"`); await db.query(`SET search_path TO "${schema}"`);
    const migrations = (await readdir("prisma/migrations")).filter(x => /^\d/.test(x)).sort();
    const removal = "20261109130000_remove_totp";
    for (const m of migrations.filter(x => x < removal)) await db.query(await readFile(`prisma/migrations/${m}/migration.sql`, "utf8"));
    const user = randomUUID(), edition = randomUUID();
    await db.query('INSERT INTO "User" (id,email,name,role,"emailVerified","twoFactorEnabled","updatedAt") VALUES ($1,$2,$3,\'CHIEF_ORGANIZER\',true,true,now())', [user, `${user}@example.test`, "Учебный организатор"]);
    await db.query('INSERT INTO "OlympiadEdition" (id,year,title) VALUES ($1,2027,$2)', [edition, "Учебный выпуск"]);
    await db.query('INSERT INTO "EditionStaffGrant" ("userId","editionId") VALUES ($1,$2)', [user, edition]);
    await db.query('INSERT INTO "Account" (id,"accountId","providerId","userId",password,"updatedAt") VALUES ($1,$2,\'credential\',$4,$3,now())', [randomUUID(), user, "synthetic-password-hash", user]);
    await db.query('INSERT INTO "Session" (id,token,"userId","expiresAt","updatedAt") VALUES ($1,$2,$3,now()+interval \'1 day\',now())', [randomUUID(), randomUUID(), user]);
    await db.query('INSERT INTO "TwoFactor" (id,"userId",secret,"backupCodes") VALUES ($1,$2,$3,$4)', [randomUUID(), user, "synthetic-encrypted-secret", "synthetic-encrypted-backup"]);
    const snapshot = async () => {
      const result = [];
      for (const table of ["User", "Account", "Session", "EditionStaffGrant", "OlympiadEdition"]) {
        result.push((await db.query(`SELECT * FROM "${table}" ORDER BY 1`)).rows.map(row => { const copy = { ...row }; delete copy.twoFactorEnabled; return copy; }));
      }
      return result;
    };
    const before = await snapshot();
    await db.query(await readFile(`prisma/migrations/${removal}/migration.sql`, "utf8"));
    assert.deepEqual(await snapshot(), before);
    assert.equal((await db.query("SELECT to_regclass('\"TwoFactor\"') AS name")).rows[0].name, null);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema=$1 AND table_name='User' AND column_name='twoFactorEnabled'", [schema])).rows[0].n, 0);
  } finally { await db.query('SET search_path TO public'); await db.query(`DROP SCHEMA "${schema}" CASCADE`); await db.end(); }
});

test("self-reported login migration preserves both pending and approved old logins and removes moderation columns", async () => {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  const schema = `self_reported_${randomUUID().replaceAll("-", "")}`;
  await db.connect();
  try {
    await db.query(`CREATE SCHEMA "${schema}"`); await db.query(`SET search_path TO "${schema}"`);
    const migrations = (await readdir("prisma/migrations")).filter(x => /^\d/.test(x)).sort();
    const change = "20261120090000_self_reported_nsuhw_login";
    for (const m of migrations.filter(x => x < change)) await db.query(await readFile(`prisma/migrations/${m}/migration.sql`, "utf8"));
    const [chief, first, second, third, edition] = Array.from({length: 5}, () => randomUUID());
    for (const user of [chief, first, second, third]) await db.query('INSERT INTO "User" (id,email,name,"updatedAt") VALUES ($1,$2,$3,now())', [user, `${user}@example.test`, "Учебный владелец"]);
    await db.query('INSERT INTO "OlympiadEdition" (id,year,title) VALUES ($1,2027,$2)', [edition,"Учебный выпуск"]);
    await db.query('INSERT INTO "LegacyNsuhwClaim" (id,"userId",login) VALUES ($1,$2,$3)', [randomUUID(),first,"legacy.same"]);
    await db.query('INSERT INTO "LegacyNsuhwClaim" (id,"userId",login,"approvedAt","approvedById","approvedEditionId") VALUES ($1,$2,$3,now(),$4,$5)', [randomUUID(),second,"legacy.same",chief,edition]);
    const before = (await db.query('SELECT id,"userId",login,revision,"createdAt" FROM "LegacyNsuhwClaim" ORDER BY id')).rows;
    await db.query(await readFile(`prisma/migrations/${change}/migration.sql`, "utf8"));
    assert.deepEqual((await db.query('SELECT * FROM "LegacyNsuhwClaim" ORDER BY id')).rows,before);
    const columns = (await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='LegacyNsuhwClaim'",[schema])).rows.map(x=>x.column_name);
    assert.ok(!columns.includes("approvedAt")); assert.ok(!columns.includes("approvedById")); assert.ok(!columns.includes("approvedEditionId"));
    await db.query('INSERT INTO "LegacyNsuhwClaim" (id,"userId",login) VALUES ($1,$2,$3)', [randomUUID(),third,"legacy.same"]);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM "LegacyNsuhwClaim"')).rows[0].n,3);
  } finally { await db.query('SET search_path TO public'); await db.query(`DROP SCHEMA "${schema}" CASCADE`); await db.end(); }
});

test("result version migration backfills published achievements and preserves immutable original imports",async()=>{
 const {PrismaClient}=await import("@prisma/client"),{PrismaPg}=await import("../src/lib/pg-adapter"),{personalHistory}=await import("../src/lib/personal-history");
 const schema=`result_backfill_${randomUUID().replaceAll("-","")}`,connection=process.env.DATABASE_URL!;
 const sql=new Client({connectionString:connection});const db=new PrismaClient({adapter:new PrismaPg({connectionString:connection,options:`-c search_path=${schema}`},{schema})});
 await sql.connect();await sql.query(`CREATE SCHEMA "${schema}"`);await sql.query(`SET search_path TO "${schema}"`);
 try{
  const change="20261121090000_result_versions_and_team_snapshots";
  for(const m of(await readdir("prisma/migrations")).filter(x=>/^\d/.test(x)&&x<change).sort())await sql.query(await readFile(`prisma/migrations/${m}/migration.sql`,"utf8"));
  const chief=await db.user.create({data:{email:`${randomUUID()}@example.test`,name:"Учебный главный",role:"CHIEF_ORGANIZER",emailVerified:true}}),owner=await db.user.create({data:{email:`${randomUUID()}@example.test`,name:"Учебный владелец",emailVerified:true}}),edition=await db.olympiadEdition.create({data:{year:9998,title:"Учебный перенос"}}),uni=await db.university.create({data:{name:"Учебный вуз",abbreviation:"УВ"}}),course=await db.courseOption.create({data:{label:"Учебный курс"}}),consent=await db.consentRecord.create({data:{userId:owner.id,purpose:"synthetic-demo-only",textVersion:"demo",textHash:"a".repeat(64)}});
  const p=await db.participation.create({data:{userId:owner.id,editionId:edition.id,format:"REMOTE",remoteZone:"NSK",fullName:owner.name,universityId:uni.id,universityName:uni.name,universityAbbreviation:uni.abbreviation,courseId:course.id,courseLabel:course.label,consentId:consent.id}}),batch=await db.resultImportBatch.create({data:{id:randomUUID(),editionId:edition.id,actorId:chief.id,kind:"FINAL",sourceHash:"a".repeat(64),importedCount:1,rejectedCount:0,report:[]}}),problem=await db.editionProblem.create({data:{editionId:edition.id,ordinal:1}}),result=await db.individualResult.create({data:{editionId:edition.id,participationId:p.id,batchId:batch.id,kind:"FINAL",total:0,prize:"Учебный приз"}});
  await db.resultProblemScore.create({data:{resultId:result.id,editionId:edition.id,problemId:problem.id,score:0}});await db.resultPublication.create({data:{batchId:batch.id,actorId:chief.id}});
  await sql.query(await readFile(`prisma/migrations/${change}/migration.sql`,"utf8"));
  const doc=await db.resultDocument.findUniqueOrThrow({where:{sourceResultId:result.id},include:{currentVersion:true,recipients:true}});
  assert.equal(doc.currentVersion?.total,0);assert.equal(doc.recipients[0].courseLabel,course.label);assert.equal((await personalHistory(db,owner.id)).rows[0].prize,"Учебный приз");assert.deepEqual(await db.individualResult.findUniqueOrThrow({where:{id:result.id}}),result);
  await assert.rejects(db.resultVersion.update({where:{id:doc.currentVersionId!},data:{total:1}}));
  await assert.rejects(db.resultVersion.create({data:{documentId:doc.id,editionId:edition.id,actorId:chief.id,number:2,scores:[1],total:1}}));
 }finally{await db.$disconnect();await sql.query('SET search_path TO public');await sql.query(`DROP SCHEMA "${schema}" CASCADE`);await sql.end();}
});
