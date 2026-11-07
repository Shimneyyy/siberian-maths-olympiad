import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { editableParticipation, reauthenticateParticipationChief } from "./corrections";
import { AccessDenied } from "./access";
import { OlympiadError } from "./olympiad-rules";
import { assertDemoRegistration } from "./registration-rules";
const schema = z.object({ editionId: z.uuid(), participationId: z.uuid(), revision: z.int().nonnegative(), confirmed: z.literal(true),
  reason: z.string().trim().max(1000).optional(), password: z.string().min(1).max(128).optional() }).strict();
export async function cancellationView(db: PrismaClient, actorId: string, editionId: string, participationId: string) {
  const { p, actor } = await editableParticipation(db, actorId, editionId, participationId, new Date());
  const team = await db.team.findUnique({ where: { captainParticipationId: p.id }, select: { name: true } });
  return { editionId, participationId, fullName: p.fullName, year: p.edition.year, revision: p.revision, chief: actor.role === "CHIEF_ORGANIZER", dissolvedTeamName: team?.name ?? null };
}
export async function cancelParticipation(db: PrismaClient, actorId: string, raw: unknown, clock: () => Date = () => new Date()) {
  const input = schema.parse(raw);
  const { actor } = await editableParticipation(db, actorId, input.editionId, input.participationId, clock(), false);
  if (actor.role === "CHIEF_ORGANIZER") {
    if (!input.reason || !input.password) throw new AccessDenied("FORBIDDEN");
    await reauthenticateParticipationChief(db, actorId, input.password);
  } else if (input.reason || input.password) throw new AccessDenied("FORBIDDEN");
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "OlympiadEdition" WHERE "id" = ${input.editionId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "Participation" WHERE "id" = ${input.participationId}::uuid FOR UPDATE`;
    const { p } = await editableParticipation(tx, actorId, input.editionId, input.participationId, clock(), false);
    assertDemoRegistration(p.user.email);
    if (p.status === "CANCELLED" || p.revision !== input.revision) throw new OlympiadError("CONFLICT", "Заявка уже изменена или отменена. Восстановление недоступно.");
    const team = await tx.team.findUnique({ where: { captainParticipationId: p.id }, include: { members: { select: { participationId: true } } } });
    if (team) {
      await tx.team.delete({ where: { id: team.id } });
      await tx.auditEvent.create({ data: { actorId, action: "TEAM_DISSOLVED_CAPTAIN_CANCELLED", objectType: "Team", objectId: team.id, editionId: p.editionId, outcome: "SUCCESS", details: { participationIds: team.members.map(m => m.participationId) } } });
    } else {
      await tx.captainTransfer.deleteMany({ where: { targetParticipationId: p.id } });
      await tx.teamMember.deleteMany({ where: { participationId: p.id } });
    }
    await tx.teamInvitation.updateMany({ where: { targetParticipationId: p.id, status: "PENDING" }, data: { status: "REVOKED", revision: { increment: 1 } } });
    const result = await tx.participation.update({ where: { id: p.id }, data: { status: "CANCELLED", revision: { increment: 1 } } });
    const reason = input.reason ? await tx.participationCorrection.create({ data: { participationId: p.id, actorId, reason: input.reason } }) : null;
    await tx.auditEvent.create({ data: { actorId, action: "PARTICIPATION_CANCELLED", objectType: "Participation", objectId: p.id, editionId: p.editionId, outcome: "SUCCESS", details: { revision: result.revision, ...(reason ? { correctionId: reason.id } : {}) } } });
    return { id: result.id, status: result.status, revision: result.revision };
  });
}
