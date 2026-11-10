import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "../src/lib/pg-adapter";
import { auditRetention, markWithdrawalReviewed, requireDemoOperator } from "../src/lib/data-lifecycle";
async function main() {
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
try {
  requireDemoOperator(); const [command, ...args] = process.argv.slice(2);
  if (command === "audit" && (args.length === 0 || args.join() === "--apply")) console.log(JSON.stringify(await auditRetention(db, args[0] === "--apply")));
  else if (command === "requests" && !args.length) console.log(JSON.stringify(await db.consentWithdrawalRequest.findMany({ where: { reviewedAt: null }, select: { id: true, userId: true, createdAt: true }, orderBy: { createdAt: "asc" }, take: 100 })));
  else if (command === "reviewed" && args.length === 2 && args[1] === "--confirmed-external-review") console.log(JSON.stringify(await markWithdrawalReviewed(db, args[0])));
  else throw new Error("Invalid command");
} catch { console.error("Учебное обслуживание недоступно: проверьте команду и локальную конфигурацию. Секреты не выводятся."); process.exitCode = 1; }
finally { await db.$disconnect(); }

}
void main();
