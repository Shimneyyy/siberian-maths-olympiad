import "dotenv/config";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { Client } from "pg";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "../src/lib/pg-adapter";
import { hashPassword } from "better-auth/crypto";
import { parseResultCsv } from "../src/lib/result-csv";
import { previewResultImport, applyResultImport, resultImportOptions, reviewResultImports } from "../src/lib/result-imports";
process.env.DEMO_REGISTRATION = "true";
const schema = `results_${randomUUID().replaceAll("-", "")}`, connection = process.env.DATABASE_URL!;
const sql = new Client({ connectionString: connection });
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: connection, options: `-c search_path=${schema}` }, { schema }) });
const password = `Synthetic-${randomUUID()}`;
let hash: string, serial = 8600;
before(async () => {
  await sql.connect(); await sql.query(`CREATE SCHEMA "${schema}"`); await sql.query(`SET search_path TO "${schema}"`);
  for (const m of (await readdir("prisma/migrations")).filter(x => /^\d/.test(x)).sort()) await sql.query(await readFile(`prisma/migrations/${m}/migration.sql`, "utf8"));
  hash = await hashPassword(password);
});
after(async () => { await db.$disconnect(); await sql.query("SET search_path TO public"); await sql.query(`DROP SCHEMA "${schema}" CASCADE`); await sql.end(); });
async function fixture() {
  const edition = await db.olympiadEdition.create({ data: { year: serial++, title: "Учебные результаты" } });
  const foreign = await db.olympiadEdition.create({ data: { year: serial++, title: "Другой год" } });
  const chief = await db.user.create({ data: { name: "Учебный главный", email: `${randomUUID()}@example.test`, role: "CHIEF_ORGANIZER", emailVerified: true } });
  await db.account.create({ data: { userId: chief.id, accountId: chief.id, providerId: "credential", password: hash } });
  await db.editionStaffGrant.create({ data: { userId: chief.id, editionId: edition.id } });
  const uni = await db.university.create({ data: { name: "Учебный вуз", abbreviation: "УВ" } }), course = await db.courseOption.create({ data: { label: "Учебный курс" } });
  const people = [];
  for (let i = 0; i < 5; i++) {
    const user = await db.user.create({ data: { email: `${randomUUID()}@example.test`, name: `Синтетический участник ${i}`, emailVerified: i !== 4 } });
    const consent = await db.consentRecord.create({ data: { userId: user.id, purpose: "synthetic-demo-only", textVersion: "demo", textHash: "a".repeat(64) } });
    const p = await db.participation.create({ data: { userId: user.id, editionId: i === 3 ? foreign.id : edition.id, status: i === 2 ? "CANCELLED" : "REGISTERED", format: "REMOTE", remoteZone: "NSK", fullName: user.name, universityId: uni.id, universityName: uni.name, universityAbbreviation: uni.abbreviation, courseId: course.id, courseLabel: course.label, consentId: consent.id } });
    const login = `Legacy.${randomUUID()}`;
    await db.legacyNsuhwClaim.create({ data: { userId: user.id, login } });
    people.push({ user, p, login });
  }
  const csv = (lines: string[]) => "\uFEFFЛогин,Задача 1,Задача 2,Сумма,Приз\r\n" + lines.join("\r\n") + "\r\n";
  const input = (lines: string[]) => ({ editionId: edition.id, kind: "PRELIMINARY" as const, csv: csv(lines) });
  const preview = (lines: string[]) => previewResultImport(db, chief.id, input(lines));
  const command = async (lines: string[]) => ({ ...input(lines), id: randomUUID(), selectionHash: (await preview(lines)).selectionHash, password, confirmed: true });
  return { edition, foreign, chief, people, csv, input, preview, command };
}
test("E07 CSV preserves quoted text, zero/null and rejects malformed framing, unsafe numbers and bounds", () => {
  const parsed = parseResultCsv('\uFEFFЛогин,Задача 1,Сумма,Приз\r\nlegacy,0,,"Приз, \"\"учебный\"\"\nтекст"\r\n');
  assert.equal(parsed.rows.length, 1); assert.deepEqual(parsed.rows[0].scores, [0]); assert.equal(parsed.rows[0].total, null); assert.equal(parsed.rows[0].prize, 'Приз, "учебный"\nтекст');
  for (const value of ["-1", "1.5", "1e2", "2147483648", "=1", "NaN"]) assert.equal(parseResultCsv(`Логин,Задача 1,Сумма,Приз\nx,${value},,`).rows[0].error, "INVALID_SCORE");
  for (const csv of ['Логин,Задача 1,Сумма,Приз\nx,"1,,', 'Логин,Задача 2,Сумма,Приз\nx,1,,', 'x'.repeat(524289), 'Логин,Задача 1,Сумма,Приз\nx,"1"x,,']) assert.throws(() => parseResultCsv(csv));
});
test("E07 partial apply matches exact self-reported logins in year, persists scores and imported sum without publication", async () => {
  const f = await fixture(), [a,b,c,foreign,pending] = f.people;
  const lines = [`${a.login},0,,99,"Приз, учебный"`, `${b.login},1.5,2,3,`, `${c.login},3,4,7,`, `${foreign.login},1,2,3,`, `${pending.login},1,2,3,`, `unknown,1,2,3,`];
  const preview = await f.preview(lines); assert.equal(preview.validCount, 2); assert.equal(preview.rejectedCount, 4);
  assert.equal(await db.individualResult.count(), 0); assert.ok(!JSON.stringify(preview).includes(a.user.email));
  const body = await f.command(lines); const done = await applyResultImport(db, f.chief.id, body);
  assert.equal(done.importedCount, 2); assert.equal(done.rejectedCount, 4);
  assert.deepEqual(await applyResultImport(db, f.chief.id, body), done);
  const result = await db.individualResult.findUniqueOrThrow({ where: { participationId_kind: { participationId: a.p.id, kind: "PRELIMINARY" } }, include: { scores: { include: { problem: true } } } });
  assert.equal(result.total, 99); assert.equal(result.prize, "Приз, учебный"); assert.deepEqual(result.scores.sort((a,b) => a.problem.ordinal - b.problem.ordinal).map(s => s.score), [0,null]);
  assert.equal(await db.outboxEvent.count({ where: { editionId: f.edition.id } }), 0);
  const audit = await db.auditEvent.findMany({ where: { editionId: f.edition.id, action: "RESULTS_IMPORTED" } });
  assert.equal(audit.length, 1); assert.ok(!JSON.stringify(audit).includes(a.login));
  assert.ok(!JSON.stringify(await db.resultImportBatch.findUniqueOrThrow({ where: { id: done.id } })).includes(a.login));
  assert.equal((await f.preview([`${a.login},1,2,3,`])).rows[0].error, "ALREADY_EXISTS");
  const finalInput = { ...f.input([`${a.login},1,2,3,`]), kind: "FINAL" };
  const finalPreview = await previewResultImport(db, f.chief.id, finalInput);
  await applyResultImport(db, f.chief.id, { ...finalInput, id: randomUUID(), selectionHash: finalPreview.selectionHash, confirmed: true, password });
  assert.equal(await db.individualResult.count({ where: { participationId: a.p.id } }), 2);
});
test("E07 duplicates all fail, stale preview and concurrent imports never overwrite or duplicate", async () => {
  const f = await fixture(), [a,b] = f.people;
  const duplicates = await f.preview([`${a.login},1,2,3,`, `${a.login},invalid,2,3,`, `${b.login},1,2,3,`]);
  assert.deepEqual(duplicates.rows.map(r => r.error), ["DUPLICATE", "DUPLICATE", null]);
  const body = await f.command([`${a.login},1,2,3,`]);
  const race = await Promise.allSettled([applyResultImport(db, f.chief.id, body), applyResultImport(db, f.chief.id, { ...body, id: randomUUID() })]);
  assert.equal(race.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(await db.individualResult.count({ where: { participationId: a.p.id } }), 1);
  const stale = await f.command([`${b.login},1,2,3,`]);
  await db.participation.update({ where: { id: b.p.id }, data: { revision: { increment: 1 } } });
  await assert.rejects(applyResultImport(db, f.chief.id, stale));
  await assert.rejects(previewResultImport(db, f.chief.id, { ...f.input([`${b.login},1,2,3,`]), csv: `Логин,Задача 1,Сумма,Приз\n${b.login},1,1,` }));
});
test("E07 roles, year, email, demo mode, reauth, confirmation and spoofed fields are enforced", async () => {
  const f = await fixture(), body = await f.command([`${f.people[0].login},1,2,3,`]);
  for (const role of ["STUDENT", "VENUE_ORGANIZER", "TECHNICAL_ADMIN"] as const) {
    const user = await db.user.create({ data: { email: `${randomUUID()}@example.test`, name: "Учебная чужая роль", role, emailVerified: true } });
    await assert.rejects(previewResultImport(db, user.id, f.input([`${f.people[0].login},1,2,3,`])));
    await assert.rejects(applyResultImport(db, user.id, body)); await assert.rejects(resultImportOptions(db, user.id));
  }
  await assert.rejects(applyResultImport(db, f.chief.id, { ...body, password: "wrong" }));
  await assert.rejects(applyResultImport(db, f.chief.id, { ...body, confirmed: false }));
  await assert.rejects(applyResultImport(db, f.chief.id, { ...body, actorId: f.chief.id }));
  await assert.rejects(previewResultImport(db, f.chief.id, { ...f.input([]), editionId: f.foreign.id }));
  for (const field of ["emailVerified"] as const) { await db.user.update({ where: { id: f.chief.id }, data: { [field]: false } }); await assert.rejects(applyResultImport(db, f.chief.id, body)); await db.user.update({ where: { id: f.chief.id }, data: { [field]: true } }); }
  process.env.DEMO_REGISTRATION = "false"; try { await assert.rejects(applyResultImport(db, f.chief.id, body)); } finally { process.env.DEMO_REGISTRATION = "true"; }
  await db.editionStaffGrant.update({ where: { userId_editionId: { userId: f.chief.id, editionId: f.edition.id } }, data: { revokedAt: new Date() } });
  await assert.rejects(applyResultImport(db, f.chief.id, body));
});
test("E07 audit failure rolls back every valid row and DB guards reject negative/cross-year changes", async () => {
  const f = await fixture(), body = await f.command(f.people.slice(0,2).map(p => `${p.login},1,2,3,`));
  const broken = db.$extends({ query: { auditEvent: { async create() { throw new Error("Synthetic audit outage"); } } } });
  await assert.rejects(applyResultImport(broken as unknown as PrismaClient, f.chief.id, body));
  assert.equal(await db.resultImportBatch.count({ where: { editionId: f.edition.id } }), 0); assert.equal(await db.editionProblem.count({ where: { editionId: f.edition.id } }), 0);
  const done = await applyResultImport(db, f.chief.id, body);
  const result = await db.individualResult.findFirstOrThrow({ where: { batchId: done.id } });
  await assert.rejects(db.individualResult.update({ where: { id: result.id }, data: { total: 4 } }));
  await assert.rejects(db.individualResult.create({ data: { editionId: f.edition.id, participationId: f.people[3].p.id, batchId: done.id, kind: "PRELIMINARY", total: 1 } }));
  await assert.rejects(db.individualResult.create({ data: { editionId: f.edition.id, participationId: f.people[2].p.id, batchId: done.id, kind: "PRELIMINARY", total: -1 } }));
  const otherProblem = await db.editionProblem.create({ data: { editionId: f.foreign.id, ordinal: 1 } });
  await assert.rejects(db.resultProblemScore.create({ data: { resultId: result.id, editionId: f.edition.id, problemId: otherProblem.id, score: 1 } }));
  const p = await db.editionProblem.findFirstOrThrow({ where: { editionId: f.edition.id } });
  const another = await db.individualResult.create({ data: { editionId: f.edition.id, participationId: f.people[2].p.id, batchId: done.id, kind: "PRELIMINARY" } });
  await assert.rejects(db.resultProblemScore.create({ data: { resultId: another.id, editionId: f.edition.id, problemId: p.id, score: -1 } }));
});

test("E08a stored import review is paginated, chief-scoped and never exposes authentication or draft data to other roles", async () => {
  const f = await fixture(), body = await f.command([`${f.people[0].login},0,,19,Учебный приз`]);
  const done = await applyResultImport(db, f.chief.id, body);
  const history = await reviewResultImports(db, f.chief.id, { editionId: f.edition.id });
  assert.equal(history.total, 1); assert.equal(history.batches[0].id, done.id);
  const input = { editionId: f.edition.id, batchId: done.id };
  const review = await reviewResultImports(db, f.chief.id, input);
  assert.equal(review.results[0].fullName, f.people[0].user.name); assert.equal(review.results[0].total, 19);
  assert.deepEqual(review.results[0].scores.map(s => s.score), [0, null]);
  for (const forbidden of ["email", "userId", "secretEnvelope", "sourceHash", "password", "login"]) assert.ok(!JSON.stringify(review).includes(`"${forbidden}"`));
  assert.equal((await reviewResultImports(db, f.chief.id, { ...input, page: 2 })).results.length, 0);
  await assert.rejects(reviewResultImports(db, f.people[0].user.id, input));
  await assert.rejects(reviewResultImports(db, f.chief.id, { ...input, editionId: f.foreign.id }));
  await assert.rejects(reviewResultImports(db, f.chief.id, { ...input, userId: f.chief.id }));
  await db.user.update({ where: { id: f.chief.id }, data: { emailVerified: false } });
  await assert.rejects(reviewResultImports(db, f.chief.id, input));
  await db.user.update({ where: { id: f.chief.id }, data: { emailVerified: true } });
  await db.editionStaffGrant.update({ where: { userId_editionId: { userId: f.chief.id, editionId: f.edition.id } }, data: { revokedAt: new Date() } });
  await assert.rejects(reviewResultImports(db, f.chief.id, input));
});

test("E08 publishes only selected batches atomically, retries deduplicate, final suppresses only its owner's preliminary", async () => {
  const { publishResults, resultsView } = await import("../src/lib/results");
  const f = await fixture(), [a,b] = f.people;
  const first = await applyResultImport(db, f.chief.id, await f.command([`${a.login},0,,7,Учебный приз`, `${b.login},1,2,3,`]));
  const read = (actorId: string) => resultsView(db, actorId, { editionId: f.edition.id });
  assert.equal((await read(a.user.id)).total, 0);
  const command = { editionId: f.edition.id, batchId: first.id, password, confirmed: true };
  await Promise.all([publishResults(db, f.chief.id, command), publishResults(db, f.chief.id, command)]);
  assert.equal((await read(a.user.id)).rows[0].kind, "PRELIMINARY");
  assert.deepEqual((await read(a.user.id)).rows[0].scores.map(s => s.score), [0,null]);
  assert.equal((await read(a.user.id)).total,1); assert.equal((await read(f.chief.id)).total,2);
  assert.equal(await db.outboxJob.count({where:{editionId:f.edition.id}}),2);
  const input = {...f.input([`${a.login},3,4,7,Итоговый приз`]),kind:"FINAL"};
  const preview=await previewResultImport(db,f.chief.id,input);
  const final=await applyResultImport(db,f.chief.id,{...input,id:randomUUID(),selectionHash:preview.selectionHash,password,confirmed:true});
  assert.equal((await read(a.user.id)).rows[0].kind,"PRELIMINARY");
  await publishResults(db,f.chief.id,{...command,batchId:final.id});
  assert.deepEqual((await read(a.user.id)).rows.map(r=>r.kind),["FINAL"]);
  assert.deepEqual((await read(b.user.id)).rows.map(r=>r.kind),["PRELIMINARY"]);
  assert.equal(await db.auditEvent.count({where:{editionId:f.edition.id,action:"RESULTS_PUBLISHED"}}),2);
  assert.equal(await db.outboxJob.count({where:{editionId:f.edition.id}}),3);
  await assert.rejects(db.resultPublication.delete({where:{batchId:first.id}}));
});
test("E08 scopes reads to own results or assigned venues and rejects spoofing, unverified email, foreign years and revoked grants", async () => {
  const { publishResults, resultsView } = await import("../src/lib/results");
  const f=await fixture(),a=f.people[0];
  const venue=await db.editionVenue.create({data:{edition:{connect:{id:f.edition.id}},address:"Учебный адрес",venue:{create:{name:"Учебная площадка"}}}});
  await db.participation.update({where:{id:a.p.id},data:{format:"ONSITE",remoteZone:null,editionVenueId:venue.id}});
  const batch=await applyResultImport(db,f.chief.id,await f.command(f.people.slice(0,2).map(p=>`${p.login},1,2,3,`)));
  const command={editionId:f.edition.id,batchId:batch.id,password,confirmed:true};
  await assert.rejects(publishResults(db,a.user.id,command));
  await assert.rejects(publishResults(db,f.chief.id,{...command,confirmed:false}));
  await assert.rejects(publishResults(db,f.chief.id,{...command,password:"wrong"}));
  await assert.rejects(publishResults(db,f.chief.id,{...command,editionId:f.foreign.id}));
  await assert.rejects(resultsView(db,a.user.id,{editionId:f.edition.id,userId:f.people[1].user.id}));
  await publishResults(db,f.chief.id,command);
  const staff=await db.user.create({data:{email:`${randomUUID()}@example.test`,name:"Учебный площадочный",role:"VENUE_ORGANIZER",emailVerified:true}});
  await db.venueStaffAssignment.create({data:{userId:staff.id,editionId:f.edition.id,editionVenueId:venue.id}});
  const input={editionId:f.edition.id};
  assert.equal((await resultsView(db,staff.id,input)).total,1);
  await assert.rejects(publishResults(db,staff.id,command));
  await db.user.update({where:{id:staff.id},data:{emailVerified:false}});await assert.rejects(resultsView(db,staff.id,input));
  await db.user.update({where:{id:staff.id},data:{emailVerified:true}});
  await db.venueStaffAssignment.update({where:{userId_editionVenueId:{userId:staff.id,editionVenueId:venue.id}},data:{revokedAt:new Date()}});
  await assert.rejects(resultsView(db,staff.id,input));
  await db.editionStaffGrant.update({where:{userId_editionId:{userId:f.chief.id,editionId:f.edition.id}},data:{revokedAt:new Date()}});
  await assert.rejects(resultsView(db,f.chief.id,input));await assert.rejects(publishResults(db,f.chief.id,command));
});
test("E08 outbox or audit failure rolls publication back without exposing scores", async () => {
  const { publishResults, resultsView } = await import("../src/lib/results");
  const f=await fixture(),a=f.people[0],batch=await applyResultImport(db,f.chief.id,await f.command([`${a.login},1,2,3,`]));
  for(const broken of [
    db.$extends({query:{outboxEvent:{async create(){throw new Error("Synthetic failure");}}}}),
    db.$extends({query:{auditEvent:{async create(){throw new Error("Synthetic failure");}}}}),
  ]){
    await assert.rejects(publishResults(broken as unknown as PrismaClient,f.chief.id,{editionId:f.edition.id,batchId:batch.id,password,confirmed:true}));
    assert.equal(await db.resultPublication.count({where:{batchId:batch.id}}),0);
    assert.equal((await resultsView(db,a.user.id,{editionId:f.edition.id})).total,0);
    assert.equal(await db.outboxEvent.count({where:{editionId:f.edition.id}}),0);
  }
});

test("result CSV accepts customer columns and matches immediately entered old login, then publishes own achievement", async () => {
  const { submitLegacyNsuhw } = await import("../src/lib/legacy-nsuhw");
  const { publishResults, resultsView } = await import("../src/lib/results");
  const { personalHistory } = await import("../src/lib/personal-history");
  const f = await fixture(), owner = f.people[0];
  await db.legacyNsuhwClaim.delete({ where: { userId: owner.user.id } });
  await submitLegacyNsuhw(db, owner.user.id, { login: owner.login });
  const csv = `ФИО,Курс,Вуз,Логин,Задача 1,Задача 2,Сумма баллов\n${owner.user.name},2,Учебный вуз,${owner.login},5,7,12`;
  const input = { editionId: f.edition.id, kind: "FINAL", csv };
  const preview = await previewResultImport(db, f.chief.id, input);
  assert.equal(preview.validCount, 1); assert.equal(preview.taskCount, 2);
  assert.equal(preview.rows[0].fullName, owner.user.name); assert.equal(preview.rows[0].course, "2");
  assert.equal(preview.rows[0].university, "Учебный вуз"); assert.deepEqual(preview.rows[0].scores, [5,7]);
  const done = await applyResultImport(db, f.chief.id, { ...input, id: randomUUID(), selectionHash: preview.selectionHash, password, confirmed: true });
  assert.equal((await resultsView(db, owner.user.id, { editionId: f.edition.id })).total, 0);
  await publishResults(db, f.chief.id, { editionId: f.edition.id, batchId: done.id, password, confirmed: true });
  assert.equal((await resultsView(db, owner.user.id, { editionId: f.edition.id })).rows[0].total, 12);
  assert.equal((await personalHistory(db, owner.user.id)).rows[0].total, 12);
  assert.equal((await resultsView(db, f.people[1].user.id, { editionId: f.edition.id })).total, 0);
  assert.equal((await db.participation.findUniqueOrThrow({where:{id:owner.p.id}})).courseLabel, owner.p.courseLabel, "CSV metadata must not rewrite the annual snapshot");
});

test("ambiguous self-reported login never assigns results or silently falls back to FIO", async () => {
  const f = await fixture(), [a,b] = f.people;
  await db.legacyNsuhwClaim.update({where:{userId:b.user.id},data:{login:a.login}});
  const preview = await f.preview([`${a.login},1,2,3,`]);
  assert.equal(preview.validCount,0); assert.equal(preview.rows[0].error,"PARTICIPANT_UNAVAILABLE");
  const data = parseResultCsv(`ФИО,Курс,Вуз,Логин,Задача 1,Сумма баллов,Приз\nСинтетическое имя,2,УВ,unknown,0,,Номинация`);
  assert.equal(data.rows[0].prize,"Номинация"); assert.equal(data.rows[0].total,null);
  assert.throws(() => parseResultCsv("ФИО,Курс,Вуз,Задача 1,Сумма баллов\nx,2,УВ,1,1"), "Login column is required");
});
