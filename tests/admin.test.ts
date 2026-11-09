import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { manageChief, saveRegistrationWindow, adminView, AdminRateLimit } from "../src/lib/admin";
import { authorizeStaff, AccessDenied } from "../src/lib/access";
import { registrationsOptions } from "../src/lib/registrations";
import { saveEdition } from "../src/lib/olympiad";
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
after(() => db.$disconnect());
test("admin global schedule and chief lifecycle require verified email/password; roles and history survive revocation", async () => {
  const password = "Synthetic-admin-password", tag = randomUUID();
  const create = (role: "STUDENT" | "CHIEF_ORGANIZER" | "VENUE_ORGANIZER" | "TECHNICAL_ADMIN") => db.user.create({ data: { name: "Учебный аккаунт", email: `${role.toLowerCase()}-${tag}@example.test`, role, emailVerified: true } });
  const admin = await create("TECHNICAL_ADMIN"), chief = await create("CHIEF_ORGANIZER"), student = await create("STUDENT"), staff = await create("VENUE_ORGANIZER");
  const users = [admin.id, chief.id, student.id, staff.id];
  const e = await db.olympiadEdition.create({ data: { year: 6700, title: "Учебный год" } });
  const other = await db.olympiadEdition.create({ data: { year: 6701, title: "Другой учебный год" } });
  const passwordInput = { password, editionId: e.id }, input = { ...passwordInput, operation: "assign", email: chief.email, name: chief.name };
  const schedule = { ...passwordInput, revision: 0, registrationOpensAt: "2026-11-01T00:00:00Z", registrationClosesAt: "2026-12-01T00:00:00Z", registrationManuallyClosed: false };
  try {
    await db.account.create({ data: { userId: admin.id, accountId: admin.id, providerId: "credential", password: await hashPassword(password) } });
    for (const user of [chief, student, staff]) {
      await assert.rejects(manageChief(db, user.id, input), AccessDenied);
      await assert.rejects(saveRegistrationWindow(db, user.id, schedule), AccessDenied);
    }
    await db.user.update({ where: { id: admin.id }, data: { emailVerified: false } });
    await assert.rejects(manageChief(db, admin.id, input), AccessDenied);
    await db.user.update({ where: { id: admin.id }, data: { emailVerified: true } });
    await assert.rejects(manageChief(db, admin.id, { ...input, password: "wrong" }), AccessDenied);
    await manageChief(db, admin.id, input);
    await authorizeStaff(db, chief.id, "registrations:read", e.id);
    await db.editionStaffGrant.create({ data: { userId: chief.id, editionId: other.id } });
    await saveRegistrationWindow(db, admin.id, schedule);
    await assert.rejects(saveEdition(db, chief.id, { ...schedule, revision: 1, title: e.title, isCurrent: false, registrationManuallyClosed: true, password: undefined }), /./);
    await assert.rejects(saveEdition(db, chief.id, { editionId: e.id, revision: 1, title: e.title, isCurrent: false, registrationOpensAt: schedule.registrationOpensAt, registrationClosesAt: schedule.registrationClosesAt, registrationManuallyClosed: true }), AccessDenied);
    await assert.rejects(registrationsOptions(db, admin.id), AccessDenied);
    await assert.rejects(authorizeStaff(db, admin.id, "venues:manage", e.id), AccessDenied);
    assert.equal((await adminView(db, admin.id)).length >= 2, true);
    await manageChief(db, admin.id, { ...input, operation: "revoke" });
    await assert.rejects(authorizeStaff(db, chief.id, "registrations:read", e.id), AccessDenied);
    await authorizeStaff(db, chief.id, "registrations:read", other.id);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: chief.id } })).role, "CHIEF_ORGANIZER");
    await assert.rejects(manageChief(db, admin.id, { ...input, password: "wrong" }), AccessDenied);
    await assert.rejects(manageChief(db, admin.id, input), AdminRateLimit);
    await db.rateLimit.deleteMany({ where: { key: `admin-reauth:${admin.id}` } });
    await assert.rejects(manageChief(db, admin.id, { ...input, email: student.email }), AccessDenied);
    await manageChief(db, admin.id, { ...input, editionId: other.id, email: `replacement-${tag}@example.test`, operation: "replace" });
    const replacement = await db.user.findUniqueOrThrow({ where: { email: `replacement-${tag}@example.test` } }); users.push(replacement.id);
    await assert.rejects(authorizeStaff(db, chief.id, "registrations:read", other.id), AccessDenied);
    await assert.rejects(authorizeStaff(db, replacement.id, "registrations:read", other.id), AccessDenied);
    await db.user.update({ where: { id: replacement.id }, data: { emailVerified: true } });
    await authorizeStaff(db, replacement.id, "registrations:read", other.id);
    const audit = await db.auditEvent.findMany({ where: { actorId: admin.id } });
    assert.ok(audit.some(x => x.action === "REGISTRATION_WINDOW_UPDATED"));
    assert.ok(audit.some(x => x.action === "ADMIN_REAUTH_DENIED"));
    assert.ok(!JSON.stringify(audit).includes(password)); assert.ok(!JSON.stringify(audit).includes(chief.email));
  } finally {
    await db.auditEvent.deleteMany({ where: { OR: [{ actorId: { in: users } }, { editionId: { in: [e.id, other.id] } }] } });
    await db.editionStaffGrant.deleteMany({ where: { editionId: { in: [e.id, other.id] } } });
    await db.olympiadEdition.deleteMany({ where: { id: { in: [e.id, other.id] } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.rateLimit.deleteMany({ where: { key: `admin-reauth:${admin.id}` } });
  }
});
