import "dotenv/config";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "../src/lib/pg-adapter";
// Operator-only local CLI, never exposed by an application endpoint.
async function main() {
  const input = z.object({ email: z.email(), name: z.string().trim().min(3).max(200) }).parse({ email: process.argv[2]?.toLowerCase(), name: process.argv[3] });
  if (process.env.NODE_ENV === "production" || !input.email.endsWith("@example.test")) throw new Error("Synthetic only");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(4726, 2)`;
      const existing = await tx.user.findUnique({ where: { email: input.email } });
      if (existing && existing.role !== "TECHNICAL_ADMIN") throw new Error("Role change forbidden");
      const admin = await tx.user.findFirst({ where: { role: "TECHNICAL_ADMIN" } });
      if (admin && admin.email !== input.email) throw new Error("Only one administrator");
      const user = existing ?? await tx.user.create({ data: { ...input, role: "TECHNICAL_ADMIN" } });
      await tx.session.deleteMany({ where: { userId: user.id } });
      await tx.auditEvent.create({ data: { action: "TECHNICAL_ADMIN_BOOTSTRAPPED", objectType: "User", objectId: user.id, outcome: "SUCCESS" } });
    });
    console.log("Administrator prepared. Recover password, verify email. No password generated.");
  } finally { await db.$disconnect(); }
}
main().catch(() => { console.error("Administrator bootstrap failed: check synthetic account and singleton/single-role requirements."); process.exitCode = 1; });
