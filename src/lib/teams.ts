import { z } from "zod";
import type { Prisma, PrismaClient } from "@prisma/client";
import { AccessDenied } from "./access";
import { assertDemoRegistration } from "./registration-rules";
import { OlympiadError } from "./olympiad-rules";
type Tx = Prisma.TransactionClient;
export async function lockTeamEdition(tx: Tx, editionId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "OlympiadEdition" WHERE "id" = ${editionId}::uuid FOR UPDATE`;
  if (!rows.length) throw new AccessDenied("FORBIDDEN");
}
export function teamChangesOpen(e: { registrationClosesAt: Date | null; registrationManuallyClosed: boolean }, now: Date) {
  return !!e.registrationClosesAt && now < e.registrationClosesAt && !e.registrationManuallyClosed;
}
export async function teamParticipant(tx: Tx, actorId: string, editionId: string, now: Date) {
  const user = await tx.user.findUnique({ where: { id: actorId } });
  if (!user?.emailVerified || user.role !== "STUDENT") throw new AccessDenied("FORBIDDEN");
  assertDemoRegistration(user.email);
  const p = await tx.participation.findUnique({ where: { userId_editionId: { userId: actorId, editionId } }, include: { edition: true, teamMembership: true } });
  if (!p || p.status !== "REGISTERED" || !teamChangesOpen(p.edition, now)) throw new AccessDenied("FORBIDDEN");
  return p;
}
const createSchema = z.object({ editionId: z.uuid(), coachName: z.string().trim().min(3).max(200) }).strict();
export async function createTeam(db: PrismaClient, actorId: string, raw: unknown, clock: () => Date = () => new Date()) {
  const input = createSchema.parse(raw);
  return db.$transaction(async tx => {
    await lockTeamEdition(tx, input.editionId);
    const p = await teamParticipant(tx, actorId, input.editionId, clock());
    if (p.teamMembership) throw new OlympiadError("CONFLICT", "Вы уже состоите в команде этого года");
    const used = await tx.team.findMany({ where: { editionId: p.editionId, universityId: p.universityId }, select: { slot: true } });
    const slot = [1,2,3].find(n => !used.some(t => t.slot === n));
    if (!slot) throw new OlympiadError("CONFLICT", "От вуза допускается не более трёх команд в год");
    const team = await tx.team.create({ data: { editionId: p.editionId, universityId: p.universityId, captainParticipationId: p.id, slot,
      name: `${p.universityAbbreviation}-${slot}`, coachName: input.coachName } });
    await tx.teamMember.create({ data: { participationId: p.id, teamId: team.id, editionId: p.editionId, universityId: p.universityId } });
    await tx.auditEvent.create({ data: { actorId, action: "TEAM_CREATED", objectType: "Team", objectId: team.id, editionId: p.editionId, outcome: "SUCCESS", details: { slot } } });
    return { id: team.id };
  });
}
export async function teamsView(db: PrismaClient, actorId: string) {
  const actor = await db.user.findUnique({ where: { id: actorId } });
  if (!actor?.emailVerified || actor.role !== "STUDENT") throw new AccessDenied("FORBIDDEN");
  const rows = await db.participation.findMany({ where: { userId: actorId }, orderBy: { edition: { year: "desc" } }, select: {
    id: true, status: true, fullName: true, universityName: true, editionId: true,
    edition: { select: { year: true, title: true, registrationClosesAt: true, registrationManuallyClosed: true } },
    teamMembership: { select: { team: { select: { id: true, name: true, coachName: true, captainParticipationId: true,
      members: { orderBy: { joinedAt: "asc" }, select: { participation: { select: { id: true, fullName: true } } } } } } } },
  } });
  return rows.map(p => ({ participationId: p.id, editionId: p.editionId, year: p.edition.year, title: p.edition.title,
    fullName: p.fullName, universityName: p.universityName, canChange: p.status === "REGISTERED" && teamChangesOpen(p.edition, new Date()),
    team: p.teamMembership ? { id: p.teamMembership.team.id, name: p.teamMembership.team.name, coachName: p.teamMembership.team.coachName,
      captainParticipationId: p.teamMembership.team.captainParticipationId,
      members: p.teamMembership.team.members.map(m => m.participation) } : null,
  }));
}
