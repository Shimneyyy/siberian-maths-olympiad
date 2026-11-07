import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { registrationsOptions, listRegistrations } from "../src/lib/registrations";
import { AccessDenied } from "../src/lib/access";
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
async function setup() {
  return db.$transaction(async (tx) => {
    const university = await tx.university.create({ data: { name: "Текущий справочник вузов", abbreviation: "ТЕСТ" } });
    const course = await tx.courseOption.create({ data: { label: "Текущий справочник курсов" } });
    const editions = [];
    for (const year of [6600,6601,6602]) editions.push(await tx.olympiadEdition.create({ data: { year, title: `Учебный выпуск ${year}` } }));
    const user = (role: "STUDENT" | "CHIEF_ORGANIZER" | "VENUE_ORGANIZER", mfa = true) => tx.user.create({ data: { email: `${randomUUID()}@example.test`, name: "Синтетический пользователь", role, emailVerified: true, twoFactorEnabled: mfa } });
    const chief = await user("CHIEF_ORGANIZER"), staff = await user("VENUE_ORGANIZER"), otherStaff = await user("VENUE_ORGANIZER"), student = await user("STUDENT"), noMfa = await user("CHIEF_ORGANIZER", false);
    const actorIds = [chief.id, staff.id, otherStaff.id, student.id, noMfa.id];
    await tx.editionStaffGrant.create({ data: { userId: chief.id, editionId: editions[0].id } });
    const sites = [];
    for (const [index, edition] of [editions[0], editions[0], editions[0], editions[1], editions[2]].entries()) {
      const venue = await tx.venue.create({ data: { name: `Учебная площадка ${index}` } });
      sites.push(await tx.editionVenue.create({ data: { editionId: edition.id, venueId: venue.id, label: venue.name, address: "Синтетический адрес", active: index !== 0 } }));
    }
    for (const index of [0,1,3]) await tx.venueStaffAssignment.create({ data: { userId: staff.id, editionId: sites[index].editionId, editionVenueId: sites[index].id } });
    await tx.venueStaffAssignment.create({ data: { userId: otherStaff.id, editionId: editions[0].id, editionVenueId: sites[2].id } });
    const aIds: string[] = [], participantIds: string[] = [];
    const create = async (editionId: string, siteId: string | null, name: string, universityName: string, courseLabel: string, status: "REGISTERED" | "CANCELLED" = "REGISTERED") => {
      const person = await user("STUDENT"); participantIds.push(person.id);
      const consent = await tx.consentRecord.create({ data: { userId: person.id, purpose: "synthetic-demo-only", textVersion: "demo-only-v1", textHash: "a".repeat(64) } });
      return tx.participation.create({ data: { userId: person.id, editionId, fullName: name, universityId: university.id, universityName, universityAbbreviation: "ТЕСТ", courseId: course.id, courseLabel,
        format: siteId ? "ONSITE" : "REMOTE", editionVenueId: siteId, remoteZone: siteId ? null : "NSK", status, consentId: consent.id, createdAt: new Date("2026-11-06T10:00:00Z") } });
    };
    for (let i=0;i<14;i++) aIds.push((await create(editions[0].id, sites[0].id, "Повторяющееся имя", "Свой вуз", i%2 ? "Курс Б" : "Курс А", i===13 ? "CANCELLED" : "REGISTERED")).id);
    for (let i=0;i<3;i++) await create(editions[0].id, sites[1].id, `Другой свой ${i}`, "Свой второй вуз", "Курс В");
    for (let i=0;i<4;i++) await create(editions[0].id, sites[2].id, `Чужой участник ${i}`, "Закрытый вуз", "Закрытый курс");
    for (let i=0;i<2;i++) await create(editions[0].id, null, `Дистанционный ${i}`, "Дистанционный вуз", "Дистанционный курс");
    for (let i=0;i<2;i++) await create(editions[1].id, sites[3].id, `Исторический ${i}`, "Вуз другого года", "Исторический курс");
    await create(editions[2].id, sites[4].id, "Недоступный год", "Недоступный вуз", "Недоступный курс");
    return { university, course, editions, chief, staff, otherStaff, student, noMfa, actorIds, participantIds, sites, aIds };
  }, { timeout: 15000 });
}
let f: Awaited<ReturnType<typeof setup>>;
before(async () => { f = await setup(); });
after(async () => {
  if (f) await db.$transaction(async (tx) => {
    const editions = f.editions.map((e) => e.id), users = [...f.actorIds, ...f.participantIds];
    await tx.participation.deleteMany({ where: { editionId: { in: editions } } });
    await tx.auditEvent.deleteMany({ where: { OR: [{ editionId: { in: editions } }, { actorId: { in: users } }] } });
    await tx.venueStaffAssignment.deleteMany({ where: { userId: { in: f.actorIds } } });
    await tx.editionStaffGrant.deleteMany({ where: { userId: { in: f.actorIds } } });
    await tx.editionVenue.deleteMany({ where: { id: { in: f.sites.map((v) => v.id) } } });
    await tx.venue.deleteMany({ where: { id: { in: f.sites.map((v) => v.venueId) } } });
    await tx.olympiadEdition.deleteMany({ where: { id: { in: editions } } });
    await tx.consentRecord.deleteMany({ where: { userId: { in: users } } });
    await tx.user.deleteMany({ where: { id: { in: users } } });
    await tx.courseOption.delete({ where: { id: f.course.id } }); await tx.university.delete({ where: { id: f.university.id } });
  });
  await db.$disconnect();
});

test("roster options expose only assigned editions/sites, including disabled and historical sites", async () => {
  const staff = await registrationsOptions(db, f.staff.id);
  assert.deepEqual(staff.editions.map((e) => e.year), [6601,6600]);
  assert.equal(staff.canSeeRemote, false);
  assert.deepEqual(new Set(staff.editions.find((e) => e.year===6600)!.venues.map((v) => v.id)), new Set([f.sites[0].id,f.sites[1].id]));
  assert.equal(staff.editions.find((e) => e.year===6600)!.venues.find((v) => v.id===f.sites[0].id)!.active, false);
  assert.deepEqual((await registrationsOptions(db, f.chief.id)).editions.map((e) => e.year), [6600]);
});
test("rows, totals and filter values all respect the same scope", async () => {
  const staff = await listRegistrations(db, f.staff.id, { editionId: f.editions[0].id, pageSize: 100 });
  assert.equal(staff.total,17); assert.equal(staff.rows.length,17);
  assert.ok(staff.rows.every((p) => p.format==="ONSITE"));
  assert.ok(!JSON.stringify(staff).includes("Закрытый"));
  assert.ok(!JSON.stringify(staff).includes("Дистанционный"));
  assert.ok(!JSON.stringify(staff).includes("Исторический"));
  assert.equal((await listRegistrations(db, f.chief.id, { editionId: f.editions[0].id })).total,23);
  assert.equal((await listRegistrations(db, f.otherStaff.id, { editionId: f.editions[0].id })).total,4);
  const historical = await listRegistrations(db, f.staff.id, { editionId: f.editions[1].id });
  assert.equal(historical.total,2); assert.equal(historical.filters.universityNames[0],"Вуз другого года");
});
test("students, missing MFA, foreign years/sites and revoked grants cannot fetch a roster", async () => {
  await assert.rejects(listRegistrations(db, f.student.id, { editionId: f.editions[0].id }), AccessDenied);
  await assert.rejects(listRegistrations(db, f.noMfa.id, { editionId: f.editions[0].id }), (e: unknown) => e instanceof AccessDenied && e.reason==="MFA_REQUIRED");
  await assert.rejects(listRegistrations(db, f.staff.id, { editionId: f.editions[2].id }), AccessDenied);
  await assert.rejects(listRegistrations(db, f.chief.id, { editionId: f.editions[1].id }), AccessDenied);
  await assert.rejects(listRegistrations(db, f.staff.id, { editionId: f.editions[0].id, editionVenueId: f.sites[2].id }), AccessDenied);
  await db.venueStaffAssignment.updateMany({ where: { userId: f.staff.id, editionId: f.editions[0].id }, data: { revokedAt: new Date() } });
  try { await assert.rejects(listRegistrations(db, f.staff.id, { editionId: f.editions[0].id }), AccessDenied); }
  finally { await db.venueStaffAssignment.updateMany({ where: { userId: f.staff.id }, data: { revokedAt: null } }); }
});
test("filters use snapshots and literal search, and default includes cancellation statuses", async () => {
  const query = { editionId: f.editions[0].id };
  assert.equal((await listRegistrations(db, f.staff.id, { ...query, universityName: "Свой вуз", courseLabel: "Курс А" })).total,7);
  assert.equal((await listRegistrations(db, f.staff.id, { ...query, status: "CANCELLED" })).total,1);
  assert.equal((await listRegistrations(db, f.staff.id, { ...query, search: "повТОРяющееся" })).total,14);
  assert.equal((await listRegistrations(db, f.staff.id, { ...query, search: "@EXAMPLE.TEST" })).total,17);
  assert.equal((await listRegistrations(db, f.staff.id, { ...query, search: "%" })).total,0);
  assert.equal((await listRegistrations(db, f.staff.id, { ...query, search: "_" })).total,0);
  assert.equal((await listRegistrations(db, f.staff.id, { ...query, format: "REMOTE" })).total,0);
  assert.equal((await listRegistrations(db, f.chief.id, { ...query, format: "REMOTE" })).total,2);
});
test("pagination has a unique tie-breaker, bounded pages, and an allowlisted DTO/sort", async () => {
  const query = { editionId: f.editions[0].id, editionVenueId: f.sites[0].id, sort: "fullName", pageSize: 10 };
  const first = await listRegistrations(db, f.staff.id, query);
  const second = await listRegistrations(db, f.staff.id, { ...query, page: 2 });
  assert.deepEqual([...first.rows,...second.rows].map((r) => r.id), [...f.aIds].sort());
  assert.equal(first.pages,2); assert.equal(second.rows.length,4);
  assert.deepEqual((await listRegistrations(db, f.staff.id, query)).rows,first.rows);
  assert.equal((await listRegistrations(db, f.staff.id, { ...query, page: 9999 })).page,2);
  const emailAsc = await listRegistrations(db, f.chief.id, { editionId: f.editions[0].id, sort: "email", pageSize: 100 });
  const emailDesc = await listRegistrations(db, f.chief.id, { editionId: f.editions[0].id, sort: "email", direction: "desc", pageSize: 100 });
  assert.deepEqual(emailAsc.rows.map((r) => r.email).reverse(), emailDesc.rows.map((r) => r.email));
  assert.deepEqual(Object.keys(first.rows[0]).sort(),["id","fullName","email","universityName","courseLabel","status","format","remoteZone","registeredAt","venue"].sort());
  await assert.rejects(listRegistrations(db, f.staff.id, { ...query, pageSize: 1000 }));
  await assert.rejects(listRegistrations(db, f.staff.id, { ...query, sort: "consentId" }));
  await assert.rejects(listRegistrations(db, f.staff.id, { ...query, actorId: f.chief.id }));
});

test("CSV export applies server scope and filters across all pages and audits no personal data", async () => {
  const { exportRegistrations } = await import("../src/lib/registrations");
  const query = { editionId: f.editions[0].id, pageSize: 10, page: 2 };
  const csv = await exportRegistrations(db, f.staff.id, query);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.equal(csv.trimEnd().split("\r\n").length, 18, "Header plus all 17 scoped rows, not just a page");
  for (const secret of ["Чужой участник", "Закрытый вуз", "Дистанционный", "Исторический", "consentId", "userId", "password"]) assert.ok(!csv.includes(secret));
  const filtered = await exportRegistrations(db, f.staff.id, { ...query, universityName: "Свой вуз", status: "CANCELLED" });
  assert.equal(filtered.trimEnd().split("\r\n").length, 2);
  assert.ok(filtered.includes("Участие отменено"));
  assert.equal((await exportRegistrations(db, f.chief.id, { editionId: f.editions[0].id, format: "REMOTE" })).trimEnd().split("\r\n").length, 3);
  for (const actor of [f.student, f.noMfa]) await assert.rejects(exportRegistrations(db, actor.id, query), AccessDenied);
  await assert.rejects(exportRegistrations(db, f.staff.id, { ...query, editionVenueId: f.sites[2].id }), AccessDenied);
  await assert.rejects(exportRegistrations(db, f.staff.id, { ...query, editionId: f.editions[2].id }), AccessDenied);
  await assert.rejects(exportRegistrations(db, f.staff.id, { ...query, rows: [] }));
  await db.venueStaffAssignment.updateMany({ where: { userId: f.staff.id }, data: { revokedAt: new Date() } });
  try { await assert.rejects(exportRegistrations(db, f.staff.id, query), AccessDenied); }
  finally { await db.venueStaffAssignment.updateMany({ where: { userId: f.staff.id }, data: { revokedAt: null } }); }
  const audits = await db.auditEvent.findMany({ where: { actorId: f.staff.id, action: "REGISTRATIONS_EXPORTED" } });
  assert.ok(audits.some(x => (x.details as { rowCount: number }).rowCount === 17));
  assert.ok(!JSON.stringify(audits).includes("Свой вуз"));
  assert.ok(!JSON.stringify(audits).includes("@example.test"));
});

test("CSV neutralizes formulas, leading controls, whitespace and quoted multiline cells", async () => {
  const { csvCell, csvRow } = await import("../src/lib/csv");
  const { exportRegistrations } = await import("../src/lib/registrations");
  for (const value of ["=1+1", "+SUM(A1)", "-1+2", "@SUM(A1)", "\t=1+1", " \r\n=1+1", "\uFEFF=1+1", "\u0000text", "\ntext"]) assert.equal(csvCell(value), `"'${value}"`);
  assert.equal(csvRow(['Учебный, "вуз"\r\nстрока', "Обычный текст"]), '"Учебный, ""вуз""\r\nстрока","Обычный текст"\r\n');
  const old = await db.participation.findUniqueOrThrow({ where: { id: f.aIds[0] } });
  try {
    await db.participation.update({ where: { id: old.id }, data: { fullName: '=HYPERLINK("https://example.test")', universityName: '\t=1+1', courseLabel: 'Курс, "Тест"\nстрока' } });
    const csv = await exportRegistrations(db, f.staff.id, { editionId: f.editions[0].id, search: "HYPERLINK" });
    assert.ok(csv.includes('"\'=HYPERLINK(""https://example.test"")"'));
    assert.ok(csv.includes('"\'\t=1+1"'));
    assert.ok(csv.includes('"Курс, ""Тест""\nстрока"'));
  } finally { await db.participation.update({ where: { id: old.id }, data: { fullName: old.fullName, universityName: old.universityName, courseLabel: old.courseLabel } }); }
});
