import "dotenv/config";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
// Run manually by the repository operator; not an application role or public endpoint.
async function main() {
const input = z.object({ email: z.email(), name: z.string().trim().min(3), editionId: z.uuid() }).parse({ email: process.argv[2]?.toLowerCase(), name: process.argv[3], editionId: process.argv[4] });
if (process.env.NODE_ENV === "production" || !input.email.endsWith("@example.test")) throw new Error("Bootstrap is limited to synthetic demo accounts until production readiness review");
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
try {
  await db.$transaction(async (tx) => {
    await tx.olympiadEdition.findUniqueOrThrow({ where: { id: input.editionId } });
    const existing = await tx.user.findUnique({ where: { email: input.email } });
    if (existing && existing.role !== "CHIEF_ORGANIZER") throw new Error("Cannot combine or silently change roles");
    const user = existing ?? await tx.user.create({ data: { email: input.email, name: input.name, role: "CHIEF_ORGANIZER" } });
    await tx.editionStaffGrant.upsert({ where: { userId_editionId: { userId: user.id, editionId: input.editionId } }, create: { userId: user.id, editionId: input.editionId }, update: { revokedAt: null } });
    await tx.session.deleteMany({ where: { userId: user.id } });
    await tx.auditEvent.create({ data: { action: "CHIEF_BOOTSTRAPPED", objectType: "User", objectId: user.id, editionId: input.editionId, outcome: "SUCCESS" } });
  });
  console.log("Chief prepared. Use password recovery, verify email, then enroll TOTP. No password was generated or printed.");
} finally { await db.$disconnect(); }

}
main().catch(() => { console.error("Bootstrap failed: check the demo account, edition and single-role requirement."); process.exitCode = 1; });
