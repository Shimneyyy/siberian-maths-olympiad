import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Demo seed is not allowed in production");
  await db.university.upsert({
    where: { id: "00000000-0000-4000-8000-000000000001" },
    update: {}, create: { id: "00000000-0000-4000-8000-000000000001", name: "Демонстрационный университет", abbreviation: "ДЕМО" },
  });
  await db.courseOption.upsert({
    where: { id: "00000000-0000-4000-8000-000000000002" },
    update: {}, create: { id: "00000000-0000-4000-8000-000000000002", label: "Демонстрационный курс" },
  });
}
main().catch(() => { console.error("Demo seed failed"); process.exitCode = 1; }).finally(() => db.$disconnect());
