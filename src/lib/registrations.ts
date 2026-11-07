import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { AccessDenied, authorizeStaff } from "./access";

export const registrationsQuerySchema = z.object({
  editionId: z.uuid(), editionVenueId: z.uuid().optional(),
  search: z.string().trim().max(100).default(""),
  universityName: z.string().max(300).optional(), courseLabel: z.string().max(200).optional(),
  status: z.enum(["REGISTERED", "CANCELLED"]).optional(), format: z.enum(["ONSITE", "REMOTE"]).optional(),
  sort: z.enum(["fullName", "email", "universityName", "courseLabel", "registeredAt", "status", "format"]).default("fullName"),
  direction: z.enum(["asc", "desc"]).default("asc"),
  page: z.int().min(1).max(10000).default(1),
  pageSize: z.union([z.literal(10), z.literal(25), z.literal(50), z.literal(100)]).default(25),
}).strict().refine((x) => !(x.format === "REMOTE" && x.editionVenueId), "Дистанционный формат не имеет очной площадки");
export type RegistrationsQuery = z.infer<typeof registrationsQuerySchema>;
type Tx = Prisma.TransactionClient;
async function staffActor(tx: Tx, actorId: string) {
  const actor = await tx.user.findUnique({ where: { id: actorId } });
  if (!actor?.emailVerified || !["CHIEF_ORGANIZER", "VENUE_ORGANIZER"].includes(actor.role)) throw new AccessDenied("FORBIDDEN");
  if (!actor.twoFactorEnabled) throw new AccessDenied("MFA_REQUIRED");
  return actor;
}

// Shared by rows, total and filter values. Future export must reuse this scope.
export async function registrationsScope(tx: Tx, actorId: string, editionId: string, editionVenueId?: string): Promise<Prisma.ParticipationWhereInput> {
  const actor = await staffActor(tx, actorId);
  if (actor.role === "CHIEF_ORGANIZER") {
    await authorizeStaff(tx, actorId, "registrations:read", editionId, editionVenueId);
    return { editionId, ...(editionVenueId ? { editionVenueId } : {}),
      edition: { staffGrants: { some: { userId: actorId, revokedAt: null } } } };
  }
  const assignments = await tx.venueStaffAssignment.findMany({
    where: { userId: actorId, editionId, revokedAt: null }, select: { editionVenueId: true },
  });
  if (!assignments.length || (editionVenueId && !assignments.some((x) => x.editionVenueId === editionVenueId))) throw new AccessDenied("FORBIDDEN");
  return { editionId, ...(editionVenueId ? { editionVenueId } : {}),
    editionVenue: { assignments: { some: { userId: actorId, editionId, revokedAt: null } } } };
}
export async function registrationsOptions(db: PrismaClient, actorId: string) {
  return db.$transaction(async (tx) => {
    const actor = await staffActor(tx, actorId);
    const chief = actor.role === "CHIEF_ORGANIZER";
    const editions = await tx.olympiadEdition.findMany({
      where: chief ? { staffGrants: { some: { userId: actorId, revokedAt: null } } } : { venueAssignments: { some: { userId: actorId, revokedAt: null } } },
      orderBy: [{ isCurrent: "desc" }, { year: "desc" }],
      select: { id: true, year: true, title: true, venues: {
        // Disabled venues still contain participants. Do not filter by active here.
        where: chief ? {} : { assignments: { some: { userId: actorId, revokedAt: null } } },
        orderBy: { id: "asc" }, select: { id: true, label: true, active: true, venue: { select: { name: true } } },
      } },
    });
    return { canSeeRemote: chief, editions: editions.map((e) => ({ id: e.id, year: e.year, title: e.title,
      venues: e.venues.map((v) => ({ id: v.id, label: v.label || v.venue.name, active: v.active })) })) };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
function orderBy(input: RegistrationsQuery): Prisma.ParticipationOrderByWithRelationInput[] {
  const direction = input.direction;
  const primary: Prisma.ParticipationOrderByWithRelationInput = input.sort === "email" ? { user: { email: direction } }
    : input.sort === "registeredAt" ? { createdAt: direction } : { [input.sort]: direction };
  return [primary, { id: "asc" }];
}
// Prisma contains uses LIKE; escape wildcard characters so the search is literal.
function literalLike(value: string) { return value.replace(/[\\%_]/g, "\\$&"); }
export async function listRegistrations(db: PrismaClient, actorId: string, raw: unknown) {
  const input = registrationsQuerySchema.parse(raw);
  return db.$transaction(async (tx) => {
    const scope = await registrationsScope(tx, actorId, input.editionId, input.editionVenueId);
    const predicates: Prisma.ParticipationWhereInput[] = [scope];
    if (input.search) predicates.push({ OR: [
      { fullName: { contains: literalLike(input.search), mode: "insensitive" } },
      { user: { email: { contains: literalLike(input.search), mode: "insensitive" } } },
    ] });
    if (input.universityName !== undefined) predicates.push({ universityName: input.universityName });
    if (input.courseLabel !== undefined) predicates.push({ courseLabel: input.courseLabel });
    if (input.status) predicates.push({ status: input.status });
    if (input.format) predicates.push({ format: input.format });
    const where = { AND: predicates };
    const total = await tx.participation.count({ where });
    const pages = Math.max(1, Math.ceil(total / input.pageSize));
    const page = Math.min(input.page, pages);
    // An interactive PostgreSQL transaction owns one connection; run its queries sequentially.
    const rows = await tx.participation.findMany({ where, orderBy: orderBy(input), skip: (page - 1) * input.pageSize, take: input.pageSize,
      select: { id: true, fullName: true, universityName: true, courseLabel: true, status: true, format: true, remoteZone: true, createdAt: true,
        user: { select: { email: true } },
        editionVenue: { select: { label: true, active: true, venue: { select: { name: true } } } },
      },
    });
    const universityNames = await tx.participation.findMany({ where: scope, distinct: ["universityName"], select: { universityName: true }, orderBy: { universityName: "asc" } });
    const courseLabels = await tx.participation.findMany({ where: scope, distinct: ["courseLabel"], select: { courseLabel: true }, orderBy: { courseLabel: "asc" } });
    const edition = await tx.olympiadEdition.findUniqueOrThrow({ where: { id: input.editionId }, select: { title: true, year: true } });
    return { editionId: input.editionId, editionTitle: edition.title, year: edition.year, page, pages, pageSize: input.pageSize, total,
      filters: { universityNames: universityNames.map((x) => x.universityName), courseLabels: courseLabels.map((x) => x.courseLabel) },
      rows: rows.map((p) => ({ id: p.id, fullName: p.fullName, email: p.user.email, universityName: p.universityName, courseLabel: p.courseLabel,
        status: p.status, format: p.format, remoteZone: p.remoteZone, registeredAt: p.createdAt.toISOString(),
        venue: p.editionVenue ? { label: p.editionVenue.label || p.editionVenue.venue.name, active: p.editionVenue.active } : null,
      })),
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
