import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { AccessDenied, authorizeStaff } from "./access";
import { verifyPassword } from "better-auth/crypto";
import { z } from "zod";
import { consumeRateLimit } from "./atomic-rate-limit";
import { assertDemoRegistration } from "./registration-rules";
const proof = { editionId: z.uuid(), editionVenueId: z.uuid(), password: z.string().min(1).max(128) };
const assignSchema = z.object({ ...proof, email: z.email().transform(s => s.toLowerCase()), name: z.string().trim().min(3).max(200) }).strict();
const revokeSchema = z.object({ ...proof, userId: z.uuid() }).strict();
async function reauthenticateStaff(db: PrismaClient, actorId: string, input: {editionId:string;editionVenueId:string;password:string}) {
  await authorizeStaff(db, actorId, "staff:manage", input.editionId, input.editionVenueId);
  await consumeRateLimit(db, `staff-reauth:${actorId}`, 5);
  const credential=await db.account.findFirst({where:{userId:actorId,providerId:"credential"},select:{password:true}});
  if(!credential?.password || !await verifyPassword({hash:credential.password,password:input.password})) {
    await db.auditEvent.create({data:{actorId,action:"STAFF_REAUTH_DENIED",objectType:"User",objectId:actorId,outcome:"DENIED"}});
    throw new AccessDenied("FORBIDDEN");
  }
}

// Caller obtains actorId from the current auth session. No role changes or combined roles.
export async function assignVenueStaff(db: PrismaClient, actorId: string,
  raw: unknown) {
  const input=assignSchema.parse(raw);
  assertDemoRegistration(input.email);
  await reauthenticateStaff(db,actorId,input);
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
  raw: unknown) {
  const input=revokeSchema.parse(raw);
  await reauthenticateStaff(db,actorId,input);
  await db.$transaction(async (tx) => {
    await authorizeStaff(tx, actorId, "staff:manage", input.editionId, input.editionVenueId);
    // A scoped venue alone does not authorize acting on an arbitrary account.
    const assignment = await tx.venueStaffAssignment.findFirst({ where: { userId: input.userId, editionId: input.editionId, editionVenueId: input.editionVenueId } });
    if (!assignment) throw new AccessDenied("FORBIDDEN");
    const changed = await tx.venueStaffAssignment.updateMany({ where: { userId: assignment.userId, editionId: assignment.editionId, editionVenueId: assignment.editionVenueId, revokedAt: null }, data: { revokedAt: new Date() } });
    // Replays are harmless and must not revoke sessions created after revocation.
    if (!changed.count) return;
    await tx.session.deleteMany({ where: { userId: input.userId } });
    await tx.auditEvent.create({ data: { actorId, action: "VENUE_STAFF_REVOKED", objectType: "User", objectId: input.userId, editionId: input.editionId, outcome: "SUCCESS" } });
  });
}
