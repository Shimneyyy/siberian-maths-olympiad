import "dotenv/config";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "../src/lib/pg-adapter";
import { DemoBackupStore } from "../src/lib/managed-backups";
import { DemoQuarantine } from "../src/lib/private-files/quarantine";
import { requireDemoOperator } from "../src/lib/data-lifecycle";
import { demoKeyringPath, loadDemoKeyProtector } from "../src/lib/external-secrets/local-keys";
import { pgTool } from "./lib/postgres-tools";
async function main() {
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
try {
  requireDemoOperator();
  if (process.argv.slice(2).join() !== "--confirmed-quiesced") throw new Error("Stop app and worker first");
  if (await db.user.count({ where: { NOT: { email: { endsWith: "@example.test" } } } })) throw new Error("Non-synthetic source");
  if (!process.env.BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET.length < 32) throw new Error("Missing authentication key");
  await loadDemoKeyProtector();
  const store = new DemoBackupStore(".local/backups", ".local/backup-key"); await store.initialize();
  const source = new DemoQuarantine(resolve(process.env.DIPLOMA_DIRECTORY || ".local/diplomas"), 10485760);
  const items = await db.diplomaItem.findMany({ where: { error: null }, select: { fileKey: true, fileHash: true } });
  const refs = new Map<string, string>();
  for (const file of items) { if (!file.fileKey || !file.fileHash) throw new Error("Invalid file reference"); if (refs.has(file.fileKey) && refs.get(file.fileKey) !== file.fileHash) throw new Error("Hash conflict"); refs.set(file.fileKey, file.fileHash); }
  const files = []; for (const [key, hash] of refs) files.push({ key, hash, bytes: await source.read(key, hash) });
  const database = await pgTool("pg_dump", new URL(process.env.DATABASE_URL!).pathname.slice(1));
  const secrets = Buffer.from(JSON.stringify({ keyring: JSON.parse(await readFile(demoKeyringPath(), "utf8")), authSecret: process.env.BETTER_AUTH_SECRET }));
  try { console.log(JSON.stringify(await store.create({ database, secrets, files }))); }
  finally { database.fill(0); secrets.fill(0); for (const file of files) file.bytes.fill(0); }
} catch { console.error("Учебная копия не создана. Проверьте синтетическую локальную БД, остановку app/worker, ключи и приватные файлы. Подробности с данными не выводятся."); process.exitCode = 1; }
finally { await db.$disconnect(); }

}
void main();
