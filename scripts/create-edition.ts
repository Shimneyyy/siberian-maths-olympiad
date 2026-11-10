import "dotenv/config";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "../src/lib/pg-adapter";
async function main() {
  const input = z.object({ year: z.coerce.number().int().min(1).max(9999), title: z.string().trim().min(1).max(200) }).parse({ year: process.argv[2], title: process.argv[3] });
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    const edition = await db.$transaction(async (tx) => {
      const edition = await tx.olympiadEdition.upsert({ where: { year: input.year }, create: input, update: {} });
      await tx.auditEvent.create({ data: { action: "EDITION_PROVISIONED", objectType: "OlympiadEdition", objectId: edition.id, editionId: edition.id, outcome: "SUCCESS" } });
      return edition;
    });
    console.log(`Edition ${edition.year}: ${edition.id}. Existing settings were preserved; grant chief access separately.`);
  } finally { await db.$disconnect(); }
}
main().catch(() => { console.error("Edition creation failed. Check year, title and local database configuration."); process.exitCode = 1; });
