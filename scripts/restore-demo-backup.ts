import "dotenv/config";
import { DemoBackupStore } from "../src/lib/managed-backups";
import { restoreDemoBackup } from "./lib/restore-backup";
async function main() {
  try {
    const [id, confirmed, ...rest] = process.argv.slice(2);
    if (!id || confirmed !== "--confirmed-isolated" || rest.length) throw new Error("Invalid command");
    console.log(JSON.stringify(await restoreDemoBackup(new DemoBackupStore(".local/backups", ".local/backup-key"), id)));
  } catch { console.error("Восстановление учебной копии недоступно. Текущая БД и .env не заменяются; проверьте целостность, ключ и локальные права."); process.exitCode = 1; }
}
void main();
