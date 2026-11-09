import "dotenv/config";
import { DemoBackupStore } from "../src/lib/managed-backups";
import { requireDemoOperator } from "../src/lib/data-lifecycle";
async function main() {
try {
  requireDemoOperator(); const args = process.argv.slice(2);
  if (args.length && args.join() !== "--apply") throw new Error("Invalid command");
  const store = new DemoBackupStore(".local/backups", ".local/backup-key");
  await store.initialize(); console.log(JSON.stringify(await store.retention(args[0] === "--apply")));
} catch { console.error("Учебные копии недоступны; проверьте права, целостность и ключ. Ничего не переинициализируйте поверх существующих копий."); process.exitCode = 1; }

}
void main();
