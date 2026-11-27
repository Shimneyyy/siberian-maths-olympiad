import type { PrismaClient } from "@prisma/client";
import { AccessDenied } from "./access";
import { registrationState } from "./olympiad-rules";

export async function studentOlympiadView(db: PrismaClient, actorId: string) {
  const user = await db.user.findUnique({ where: { id: actorId }, include: { profile: true } });
  if (!user?.emailVerified || user.role !== "STUDENT") throw new AccessDenied("FORBIDDEN");
  const [editions, participations, universities, courses] = await Promise.all([
    db.olympiadEdition.findMany({ orderBy: { year: "desc" }, include: {
      venues: { where: { active: true }, select: { id: true, label: true, address: true, venue: { select: { name: true } } } },
    } }),
    db.participation.findMany({ where: { userId: actorId }, orderBy: { edition: { year: "desc" } }, include: {
      edition: { select: { year: true, title: true } },
      editionVenue: { select: { label: true, active: true, address: true, room: true, instructions: true, venue: { select: { name: true } } } },
    } }),
    db.university.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.courseOption.findMany({ where: { active: true }, select: { id: true, label: true }, orderBy: { label: "asc" } }),
  ]);
  const now = new Date();
  return {
    profile: user.profile ? { fullName: user.profile.fullName, universityId: user.profile.universityId, courseId: user.profile.courseId } : null,
    universities, courses,
    editions: editions.map((e) => ({ id: e.id, year: e.year, title: e.title,
      state: registrationState(e, now), opensAt: e.registrationOpensAt?.toISOString() ?? null, closesAt: e.registrationClosesAt?.toISOString() ?? null,
      venues: e.venues.map((v) => ({ id: v.id, label: v.label || v.venue.name, address: v.address })) })),
    // An explicit DTO: no consent IDs, user IDs, staff assignments or other participants.
    participations: participations.map((p) => ({ id: p.id, editionId: p.editionId, year: p.edition.year, title: p.edition.title,
      status: p.status, format: p.format, remoteZone: p.remoteZone, fullName: p.fullName,
      universityName: p.universityName, courseLabel: p.courseLabel, registeredAt: p.createdAt.toISOString(),
      venue: p.editionVenue ? { label: p.editionVenue.label || p.editionVenue.venue.name, active: p.editionVenue.active,
        address: p.editionVenue.address, room: p.editionVenue.room, instructions: p.editionVenue.instructions } : null,
    })),
  };
}
export async function organizerOlympiadView(db: PrismaClient, actorId: string) {
  const user = await db.user.findUnique({ where: { id: actorId } });
  if (!user?.emailVerified || user.role !== "CHIEF_ORGANIZER") throw new AccessDenied("FORBIDDEN");
  const editions = await db.olympiadEdition.findMany({ where: { staffGrants: { some: { userId: actorId, revokedAt: null } } },
    orderBy: { year: "desc" }, include: { venues: { orderBy: { id: "asc" }, include: { venue: { select: { name: true } } } } },
  });
  return editions.map((e) => ({ id: e.id, title: e.title, year: e.year, revision: e.revision,
    venues: e.venues.map((v) => ({ id: v.id, venueId: v.venueId, label: v.label || v.venue.name, address: v.address, room: v.room ?? "",
      instructions: v.instructions ?? "", active: v.active, revision: v.revision })),
  }));
}
