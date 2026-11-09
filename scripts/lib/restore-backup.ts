import { mkdir, realpath, stat, writeFile, rm } from "node:fs/promises";
import { resolve, join, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { z } from "zod";
import { DemoBackupStore } from "../../src/lib/managed-backups";
import { DemoLocalKeyProtector } from "../../src/lib/external-secrets/local-keys";
import { requireDemoOperator } from "../../src/lib/data-lifecycle";
import { pgTool } from "./postgres-tools";
// Restores only into a newly generated database/directory; never replaces the current app DB or .env.
export async function restoreDemoBackup(store: DemoBackupStore, id: string, parent = ".local/restores") {
  requireDemoOperator(); const copy = await store.read(id);
  const secrets = z.object({ authSecret: z.string().min(32).max(1024).regex(/^[^\r\n]+$/), keyring: z.unknown() }).strict().parse(JSON.parse(copy.secrets.toString("utf8")));
  new DemoLocalKeyProtector(secrets.keyring);
  const root = resolve(parent);
  for (const folder of ["public", ".next", "out"]) { const exposed = resolve(folder); if (root === exposed || root.startsWith(exposed + sep)) throw new Error("Public restore directory forbidden"); }
  await mkdir(root, { recursive: true, mode: 0o700 });
  if (await realpath(root) !== root || ((await stat(root)).mode & 0o077)) throw new Error("Private restore directory required");
  const suffix = randomUUID().replaceAll("-", ""), database = `smo_restore_${suffix}`, directory = join(root, suffix);
  const control = new Client({ connectionString: process.env.DATABASE_URL }); await control.connect(); let created = false;
  try {
    await mkdir(directory, { mode: 0o700 }); await control.query(`CREATE DATABASE "${database}"`); created = true;
    await pgTool("pg_restore", database, copy.database);
    const keyring = join(directory, "keyring.json"), files = join(directory, "diplomas"); await mkdir(files, { mode: 0o700 });
    await writeFile(keyring, JSON.stringify(secrets.keyring), { mode: 0o600, flag: "wx" });
    for (const file of copy.files) await writeFile(join(files, `${file.key}.quarantine`), file.bytes, { mode: 0o600, flag: "wx" });
    const url = new URL(process.env.DATABASE_URL!); url.pathname = `/${database}`;
    const runtimeConfig = join(directory, "runtime.env");
    await writeFile(runtimeConfig, [
      `DATABASE_URL=${JSON.stringify(url.toString())}`, `BETTER_AUTH_SECRET=${JSON.stringify(secrets.authSecret)}`,
      `NSUHW_KEYRING_FILE=${JSON.stringify(keyring)}`, `DIPLOMA_DIRECTORY=${JSON.stringify(files)}`,
      'BETTER_AUTH_URL="http://localhost:3000"', 'DEMO_REGISTRATION="true"', '',
    ].join("\n"), { mode: 0o600, flag: "wx" });
    return { database, directory, runtimeConfig, files: copy.files.length, snapshotCreatedAt: copy.createdAt };
  } catch {
    if (created) await control.query(`DROP DATABASE "${database}" WITH (FORCE)`);
    await rm(directory, { recursive: true, force: true }); throw new Error("Isolated restore failed");
  } finally { copy.database.fill(0); copy.secrets.fill(0); for (const file of copy.files) file.bytes.fill(0); await control.end(); }
}
