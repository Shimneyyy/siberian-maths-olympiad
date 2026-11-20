import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Prisma, PrismaClient } from "@prisma/client";
import { AccessDenied } from "./access";
import { AdminRateLimit } from "./admin";
import { OlympiadError } from "./olympiad-rules";
import { lockTeamEdition, teamParticipant } from "./teams";
const editionId = z.uuid(), teamId = z.uuid(), revision = z.int().nonnegative(), participationId = z.uuid();
const schema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("invite"), editionId, teamId, email: z.email().max(254).transform(x => x.toLowerCase()) }).strict(),
  z.object({ operation: z.literal("acceptInvitation"), editionId, invitationId: z.uuid(), revision }).strict(),
  z.object({ operation: z.literal("declineInvitation"), editionId, invitationId: z.uuid(), revision }).strict(),
  z.object({ operation: z.literal("revokeInvitation"), editionId, teamId, invitationId: z.uuid(), revision }).strict(),
  z.object({ operation: z.literal("leave"), editionId, teamId }).strict(),
  z.object({ operation: z.literal("delete"), editionId, teamId, confirmed: z.literal(true) }).strict(),
  z.object({ operation: z.literal("exclude"), editionId, teamId, participationId }).strict(),
  z.object({ operation: z.literal("requestCaptain"), editionId, teamId, participationId }).strict(),
  z.object({ operation: z.literal("acceptCaptain"), editionId, teamId, revision }).strict(),
  z.object({ operation: z.literal("declineCaptain"), editionId, teamId, revision }).strict(),
  z.object({ operation: z.literal("cancelCaptain"), editionId, teamId, revision }).strict(),
]);
export async function teamAction(db: PrismaClient, actorId: string, raw: unknown) {
  const input = schema.parse(raw);
  if (input.operation === "invite") {
    const actor = await db.user.findUnique({ where: { id: actorId } });
    if (!actor?.emailVerified || actor.role !== "STUDENT") throw new AccessDenied("FORBIDDEN");
    const now = BigInt(Date.now()), threshold = now - 60000n, key = `team-invite:${actorId}`;
    const [bucket] = await db.$queryRaw<{ count: number }[]>`INSERT INTO "RateLimit" ("id","key","count","lastRequest") VALUES (${randomUUID()}::uuid,${key},1,${now})
      ON CONFLICT ("key") DO UPDATE SET "count" = CASE WHEN "RateLimit"."lastRequest" < ${threshold} THEN 1 ELSE "RateLimit"."count" + 1 END,
      "lastRequest" = CASE WHEN "RateLimit"."lastRequest" < ${threshold} THEN ${now} ELSE "RateLimit"."lastRequest" END RETURNING "count"`;
    if (bucket.count > 20) throw new AdminRateLimit();
  }
  return db.$transaction(async tx => {
    await lockTeamEdition(tx, input.editionId);
    const p = await teamParticipant(tx, actorId, input.editionId, new Date());
    if (input.operation === "acceptInvitation" || input.operation === "declineInvitation") {
      const invite = await tx.teamInvitation.findFirst({ where: { id: input.invitationId, editionId: p.editionId, targetParticipationId: p.id }, include: { team: { include: { members: true } } } });
      if (!invite) throw new AccessDenied("FORBIDDEN");
      if (invite.status !== "PENDING" || invite.revision !== input.revision) throw new OlympiadError("CONFLICT", "Приглашение уже изменено. Обновите страницу.");
      if (input.operation === "acceptInvitation") {
        if (invite.team.universityId !== p.universityId) throw new AccessDenied("FORBIDDEN");
        if (p.teamMembership) throw new OlympiadError("CONFLICT", "Вы уже состоите в команде этого года");
        if (invite.team.members.length >= 5) throw new OlympiadError("CONFLICT", "В команде уже пять участников");
        await tx.teamMember.create({ data: { participationId: p.id, teamId: invite.teamId, editionId: p.editionId, universityId: p.universityId } });
      }
      await tx.teamInvitation.update({ where: { id: invite.id }, data: { status: input.operation === "acceptInvitation" ? "ACCEPTED" : "DECLINED", revision: { increment: 1 } } });
      await tx.auditEvent.create({ data: { actorId, action: input.operation === "acceptInvitation" ? "TEAM_INVITATION_ACCEPTED" : "TEAM_INVITATION_DECLINED", objectType: "Team", objectId: invite.teamId, editionId: p.editionId, outcome: "SUCCESS" } });
      return { status: "ok" };
    }
    const team = await tx.team.findFirst({ where: { id: input.teamId, editionId: p.editionId, members: { some: { participationId: p.id } } }, include: { members: true, captainTransfer: true } });
    if (!team) throw new AccessDenied("FORBIDDEN");
    const captain = team.captainParticipationId === p.id;
    const requireCaptain = () => { if (!captain) throw new AccessDenied("FORBIDDEN"); };
    if (input.operation === "invite") {
      requireCaptain();
      // Exact address only. Do not expose another university/year's account or a user catalog.
      const target = await tx.participation.findFirst({ where: { editionId: p.editionId, universityId: p.universityId, status: "REGISTERED", user: { email: input.email, emailVerified: true, role: "STUDENT" }, id: { not: p.id }, OR: [{ teamMembership: null }, { teamMembership: { is: { teamId: { not: team.id } } } }] } });
      if (target) await tx.teamInvitation.upsert({ where: { teamId_targetParticipationId: { teamId: team.id, targetParticipationId: target.id } },
        create: { teamId: team.id, editionId: p.editionId, targetParticipationId: target.id }, update: { status: "PENDING", revision: { increment: 1 } } });
    } else if (input.operation === "delete") {
      requireCaptain();
      await tx.team.delete({ where: { id: team.id } });
      await tx.auditEvent.create({ data: { actorId, action: "TEAM_DELETED", objectType: "Team", objectId: team.id, editionId: p.editionId, outcome: "SUCCESS", details: { memberCount: team.members.length } } });
      return { status: "ok" };
    } else if (input.operation === "revokeInvitation") {
      requireCaptain();
      const invite = await tx.teamInvitation.findFirst({ where: { id: input.invitationId, teamId: team.id, revision: input.revision, status: "PENDING" } });
      if (!invite) throw new OlympiadError("CONFLICT", "Приглашение уже изменено");
      await tx.teamInvitation.update({ where: { id: invite.id }, data: { status: "REVOKED", revision: { increment: 1 } } });
    } else if (input.operation === "leave" || input.operation === "exclude") {
      const targetId = input.operation === "leave" ? p.id : input.participationId;
      if (input.operation === "exclude") requireCaptain();
      if (targetId === team.captainParticipationId) throw new OlympiadError("CONFLICT", "Капитан сначала передаёт капитанство; отмена его участия удалит команду");
      if (!team.members.some(m => m.participationId === targetId)) throw new AccessDenied("FORBIDDEN");
      await tx.captainTransfer.deleteMany({ where: { teamId: team.id, targetParticipationId: targetId } });
      await tx.teamMember.delete({ where: { participationId: targetId } });
    } else if (input.operation === "requestCaptain") {
      requireCaptain();
      if (input.participationId === p.id || !team.members.some(m => m.participationId === input.participationId)) throw new AccessDenied("FORBIDDEN");
      await tx.captainTransfer.upsert({ where: { teamId: team.id }, create: { teamId: team.id, editionId: p.editionId, universityId: p.universityId, targetParticipationId: input.participationId }, update: { targetParticipationId: input.participationId, revision: { increment: 1 } } });
    } else {
      const transfer = team.captainTransfer;
      if (!transfer || transfer.revision !== input.revision) throw new OlympiadError("CONFLICT", "Предложение капитанства уже изменено");
      if (input.operation === "cancelCaptain") requireCaptain();
      else if (transfer.targetParticipationId !== p.id) throw new AccessDenied("FORBIDDEN");
      if (input.operation === "acceptCaptain") await tx.team.update({ where: { id: team.id }, data: { captainParticipationId: p.id } });
      await tx.captainTransfer.delete({ where: { teamId: team.id } });
    }
    const details: Prisma.InputJsonObject = { participationId: p.id,
      ...("participationId" in input ? { targetParticipationId: input.participationId } : {}),
      ...("revision" in input ? { revision: input.revision } : {}),
      ...(input.operation === "acceptCaptain" ? { previousCaptainParticipationId: team.captainParticipationId } : {}),
    };
    await tx.auditEvent.create({ data: { details, actorId, action: `TEAM_${input.operation.toUpperCase()}`, objectType: "Team", objectId: team.id, editionId: p.editionId, outcome: "SUCCESS" } });
    return { status: "ok" };
  });
}
