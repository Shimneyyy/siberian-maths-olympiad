import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { AccessDenied, authorizeStaff } from "./access";

// Caller obtains actorId from the current auth session. No role changes or combined roles.
export async function assignVenueStaff(db: PrismaClient, actorId: string,
  input: { editionId: string; editionVenueId: string; email: string; name: string }) {
  return db.$transaction(async (tx) => {
    await authorizeStaff(tx, actorId, "staff:manage", input.editionId, input.editionVenueId);
    let target = await tx.user.findUnique({ where: { email: input.email } });
    if (target && target.role !== "VENUE_ORGANIZER") throw new AccessDenied("FORBIDDEN");
    if (!target) target = await tx.user.create({ data: { id: randomUUID(), email: input.email, name: input.name, role: "VENUE_ORGANIZER" } });
    await tx.venueStaffAssignment.upsert({
      where: { userId_editionVenueId: { userId: target.id, editionVenueId: input.editionVenueId } },
      create: { userId: target.id, editionId: input.editionId, editionVenueId: input.editionVenueId },
      update: { revokedAt: null },
    });
    await tx.auditEvent.create({ data: { actorId, action: "VENUE_STAFF_ASSIGNED", objectType: "User", objectId: target.id, editionId: input.editionId, outcome: "SUCCESS" } });
    return target.id;
  });
}
export async function revokeVenueStaff(db: PrismaClient, actorId: string,
  input: { editionId: string; editionVenueId: string; userId: string }) {
  await db.$transaction(async (tx) => {
    await authorizeStaff(tx, actorId, "staff:manage", input.editionId, input.editionVenueId);
    await tx.venueStaffAssignment.updateMany({ where: { userId: input.userId, editionId: input.editionId, editionVenueId: input.editionVenueId }, data: { revokedAt: new Date() } });
    await tx.session.deleteMany({ where: { userId: input.userId } });
    await tx.auditEvent.create({ data: { actorId, action: "VENUE_STAFF_REVOKED", objectType: "User", objectId: input.userId, editionId: input.editionId, outcome: "SUCCESS" } });
  });
}
