import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { registrationsScope } from "./registrations";
import { AccessDenied, authorizeStaff } from "./access";
import { OlympiadError } from "./olympiad-rules";
const schema = z.object({ editionId: z.uuid(), participationId: z.uuid(), revision: z.int().nonnegative(), status: z.enum(["UNMARKED", "PRESENT", "ABSENT"]) }).strict();
export async function markAttendance(db: PrismaClient, actorId: string, raw: unknown) {
  const input = schema.parse(raw);
  return db.$transaction(async tx => {
    const scope = await registrationsScope(tx, actorId, input.editionId);
    const where = { AND: [scope, { id: input.participationId }] };
    if (!await tx.participation.findFirst({ where, select: { id: true } })) throw new AccessDenied("FORBIDDEN");
    await tx.$queryRaw`SELECT "id" FROM "Participation" WHERE "id" = ${input.participationId}::uuid FOR UPDATE`;
    const participant = await tx.participation.findFirst({ where, include: { attendance: true } });
    if (!participant) throw new AccessDenied("FORBIDDEN");
    await authorizeStaff(tx, actorId, "attendance:write", input.editionId, participant.editionVenueId ?? undefined);
    const old = participant.attendance;
    if ((old?.revision ?? 0) !== input.revision) throw new OlympiadError("CONFLICT", "Явка уже изменена. Обновите список.");
    const result = await tx.attendance.upsert({ where: { participationId: participant.id },
      create: { participationId: participant.id, status: input.status, markedById: actorId },
      update: { status: input.status, revision: { increment: 1 }, markedById: actorId },
    });
    await tx.auditEvent.create({ data: { actorId, action: "ATTENDANCE_UPDATED", objectType: "Participation", objectId: participant.id, editionId: input.editionId, outcome: "SUCCESS", details: { before: old?.status ?? "UNMARKED", after: result.status, revision: result.revision } } });
    return { status: result.status, revision: result.revision };
  });
}
