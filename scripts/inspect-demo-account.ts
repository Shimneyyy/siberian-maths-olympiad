import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "../src/lib/pg-adapter";
import { z } from "zod";
import { requireDemoOperator } from "../src/lib/data-lifecycle";
async function main() {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    requireDemoOperator();
    if (process.argv.length !== 3) throw new Error("One synthetic email required");
    const email = z.email().parse(process.argv[2].trim().toLowerCase());
    if (!email.endsWith("@example.test")) throw new Error("Synthetic accounts only");
    const user = await db.user.findUnique({ where: { email }, select: { id: true, role: true, emailVerified: true, profile: { select: { userId: true } } } });
    const hasLocalPassword = user ? (await db.account.count({ where: { userId: user.id, accountId: user.id, providerId: "credential", password: { not: null }, NOT: { password: "" } } })) > 0 : false;
    const database = new URL(process.env.DATABASE_URL!);
    console.log(JSON.stringify({ exists: !!user, ...(user ? { role: user.role, emailVerified: user.emailVerified, hasLocalPassword, hasStudentProfile: !!user.profile } : {}), temporaryTestDatabase: /^\/smo_test_[a-f0-9]+$/.test(database.pathname) }));
  } catch { console.error("Диагностика доступна только для синтетического email @example.test в локальной учебной БД. Проверьте аргумент, конфигурацию и доступность PostgreSQL."); process.exitCode = 1; }
  finally { await db.$disconnect(); }
}
void main();
