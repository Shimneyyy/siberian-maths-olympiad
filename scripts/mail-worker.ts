import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "../src/lib/pg-adapter";
import { setTimeout } from "node:timers/promises";
import { processEmail } from "../src/lib/outbox";
import { sendMail } from "../src/lib/mail-transport";
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
let running = true;
process.on("SIGTERM", () => { running = false; }); process.on("SIGINT", () => { running = false; });
async function main() {
  try {
    if (process.env.DEMO_REGISTRATION !== "true" || process.env.NODE_ENV === "production") {
      console.error("MAIL_WORKER_DEMO_CONFIGURATION_REQUIRED"); process.exitCode = 1; return;
    }
    do {
      try {
        const counts: Record<string, number> = {};
        for (let i = 0; i < 20 && running; i++) {
          const result = await processEmail(db, sendMail);
          if (result === "EMPTY") break;
          counts[result] = (counts[result] ?? 0) + 1;
        }
        if (Object.keys(counts).length) console.log(JSON.stringify(counts));
      } catch (error) {
        if (process.argv.includes("--once")) throw error;
        console.error("MAIL_WORKER_CYCLE_FAILED: retrying");
      }
      if (process.argv.includes("--once") || !running) break;
      await setTimeout(2000);
    } while (running);
  } finally { await db.$disconnect(); }
}
main().catch(() => { console.error("MAIL_WORKER_CYCLE_FAILED: jobs recover after lease expiry; inspect database status without logging personal data."); process.exitCode = 1; });
