import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { assignVenueStaff, revokeVenueStaff } from "../src/lib/staff";
import { AccessDenied } from "../src/lib/access";
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
after(() => db.$disconnect());
test("chief assigns and revokes staff in own edition; roles cannot be combined", async () => {
  const tag = randomUUID();
  const actor = await db.user.create({ data: { email: `chief-${tag}@example.test`, name: "Тестовый организатор", role: "CHIEF_ORGANIZER", emailVerified: true } });
  const student = await db.user.create({ data: { email: `student-${tag}@example.test`, name: "Тестовый студент" } });
  const email = `venue-${tag}@example.test`;
  const edition = await db.olympiadEdition.create({ data: { year: 6100, title: "Тест назначений" } });
  const other = await db.olympiadEdition.create({ data: { year: 6101, title: "Другой выпуск" } });
  const venue = await db.venue.create({ data: { name: "Синтетическая площадка" } });
  const site = await db.editionVenue.create({ data: { editionId: edition.id, venueId: venue.id, address: "Тестовый адрес" } });
  const foreign = await db.editionVenue.create({ data: { editionId: other.id, venueId: venue.id, address: "Тестовый адрес" } });
  try {
    await db.editionStaffGrant.create({ data: { userId: actor.id, editionId: edition.id } });
    const input = { editionId: edition.id, editionVenueId: site.id, email, name: "Тестовый организатор площадки" };
    await assert.rejects(assignVenueStaff(db, actor.id, { ...input, email: student.email }), AccessDenied);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: student.id } })).role, "STUDENT");
    await assert.rejects(assignVenueStaff(db, actor.id, { ...input, editionId: other.id, editionVenueId: foreign.id }), AccessDenied);
    const userId = await assignVenueStaff(db, actor.id, input);
    assert.equal(await assignVenueStaff(db, actor.id, input), userId, "Reassignment does not create duplicate users");
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: userId } })).role, "VENUE_ORGANIZER");
    const studentSession = await db.session.create({ data: { token: randomUUID(), userId: student.id, expiresAt: new Date(Date.now() + 60000) } });
    const foreignStaff = await db.user.create({ data: { email: `foreign-${tag}@example.test`, name: "Чужой организатор", role: "VENUE_ORGANIZER", emailVerified: true } });
    await db.venueStaffAssignment.create({ data: { userId: foreignStaff.id, editionId: other.id, editionVenueId: foreign.id } });
    const foreignSession = await db.session.create({ data: { token: randomUUID(), userId: foreignStaff.id, expiresAt: new Date(Date.now() + 60000) } });
    try {
      for (const targetId of [student.id, foreignStaff.id, randomUUID()]) {
        await assert.rejects(revokeVenueStaff(db, actor.id, { editionId: edition.id, editionVenueId: site.id, userId: targetId }), AccessDenied);
      }
      assert.ok(await db.session.findUnique({ where: { id: studentSession.id } }), "Unrelated student keeps their session");
      assert.ok(await db.session.findUnique({ where: { id: foreignSession.id } }), "Foreign organizer keeps their session");
      assert.equal((await db.venueStaffAssignment.findUniqueOrThrow({ where: { userId_editionVenueId: { userId: foreignStaff.id, editionVenueId: foreign.id } } })).revokedAt, null);
      assert.equal(await db.auditEvent.count({ where: { actorId: actor.id, action: "VENUE_STAFF_REVOKED" } }), 0);
    } finally {
      await db.venueStaffAssignment.deleteMany({ where: { userId: foreignStaff.id } });
      await db.user.delete({ where: { id: foreignStaff.id } });
    }
    const session = await db.session.create({ data: { token: randomUUID(), userId, expiresAt: new Date(Date.now() + 60000) } });
    await revokeVenueStaff(db, actor.id, { editionId: edition.id, editionVenueId: site.id, userId });
    assert.equal(await db.session.findUnique({ where: { id: session.id } }), null);
    assert.ok((await db.venueStaffAssignment.findUniqueOrThrow({ where: { userId_editionVenueId: { userId, editionVenueId: site.id } } })).revokedAt);
    // A replay must not terminate a session created after the assignment was revoked.
    const newSession = await db.session.create({ data: { token: randomUUID(), userId, expiresAt: new Date(Date.now() + 60000) } });
    await revokeVenueStaff(db, actor.id, { editionId: edition.id, editionVenueId: site.id, userId });
    assert.ok(await db.session.findUnique({ where: { id: newSession.id } }));
    assert.equal(await db.auditEvent.count({ where: { actorId: actor.id, action: "VENUE_STAFF_REVOKED" } }), 1);
    const audit = await db.auditEvent.findMany({ where: { actorId: actor.id } });
    assert.equal(audit.filter((a) => a.action === "VENUE_STAFF_ASSIGNED").length, 2);
    assert.ok(!JSON.stringify(audit).includes(email));
  } finally {
    const target = await db.user.findUnique({ where: { email } });
    const userIds = [actor.id, student.id, ...(target ? [target.id] : [])];
    await db.auditEvent.deleteMany({ where: { OR: [{ actorId: { in: userIds } }, { editionId: { in: [edition.id, other.id] } }] } });
    await db.venueStaffAssignment.deleteMany({ where: { editionId: { in: [edition.id, other.id] } } });
    await db.editionStaffGrant.deleteMany({ where: { editionId: edition.id } });
    await db.editionVenue.deleteMany({ where: { venueId: venue.id } });
    await db.venue.delete({ where: { id: venue.id } });
    await db.olympiadEdition.deleteMany({ where: { id: { in: [edition.id, other.id] } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
  }
});
