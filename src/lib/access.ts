import type { PrismaClient, Prisma } from "@prisma/client";
export type StaffAction = "edition:manage" | "venues:manage" | "registrations:read" | "attendance:write" | "results:publish" | "diplomas:publish" | "staff:manage";
export class AccessDenied extends Error {
  constructor(public readonly reason: "FORBIDDEN" | "MFA_REQUIRED") { super(reason); }
}

// actorId must originate from a verified server-side session, never a request body.
export async function authorizeStaff(db: PrismaClient | Prisma.TransactionClient, actorId: string,
  action: StaffAction, editionId: string, editionVenueId?: string) {
  const actor = await db.user.findUnique({ where: { id: actorId } });
  let allowed = false;
  if (actor?.emailVerified && actor.role !== "STUDENT") {
    if (!actor.twoFactorEnabled) throw new AccessDenied("MFA_REQUIRED");
    if (actor.role === "CHIEF_ORGANIZER") {
      const grant = await db.editionStaffGrant.findUnique({ where: { userId_editionId: { userId: actor.id, editionId } } });
      allowed = !!grant && !grant.revokedAt;
      if (allowed && editionVenueId) allowed = !!await db.editionVenue.findFirst({ where: { id: editionVenueId, editionId } });
    } else if (editionVenueId && (action === "registrations:read" || action === "attendance:write")) {
      allowed = !!await db.venueStaffAssignment.findFirst({ where: { userId: actor.id, editionId, editionVenueId, revokedAt: null } });
    }
  }
  if (!allowed) {
    await db.auditEvent.create({ data: { actorId, action: "ACCESS_DENIED", objectType: "OlympiadEdition", objectId: editionId, editionId, outcome: "DENIED" } });
    throw new AccessDenied("FORBIDDEN");
  }
}
