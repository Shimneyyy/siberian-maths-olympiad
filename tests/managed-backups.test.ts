import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, symlink, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { DemoBackupStore } from "../src/lib/managed-backups";
process.env.DEMO_REGISTRATION = "true";
test("F01b encrypted managed copies expire at 30 days, preserve current copies/key, and default to dry run", async t => {
  const root = await mkdtemp(join(tmpdir(), "smo-backups-"));
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-01T00:00:00Z") });
  try {
    const store = new DemoBackupStore(join(root, "copies"), join(root, "key")); await store.initialize();
    const bytes = Buffer.from("Synthetic private document"), payload = { database: Buffer.from("Synthetic database"), secrets: Buffer.from("Synthetic key bundle"), files: [{ key: randomUUID(), hash: createHash("sha256").update(bytes).digest("hex"), bytes }] };
    const first = await store.create(payload); t.mock.timers.tick(86400000); const second = await store.create(payload); t.mock.timers.tick(29 * 86400000);
    assert.equal((await store.retention()).count, 1); assert.deepEqual((await store.read(first.id)).database, payload.database);
    assert.ok(!(await readFile(join(root, "copies", first.id, "database.box"), "utf8")).includes("Synthetic database"));
    assert.equal((await store.retention(true)).count, 1); await assert.rejects(store.read(first.id));
    assert.deepEqual((await store.read(second.id)).files[0].bytes, bytes); assert.equal((await readFile(join(root, "key"))).length, 32);
    await assert.rejects(store.retention(true, new Date(Date.now() + 86400000)));
  } finally { t.mock.timers.reset(); await rm(root, { recursive: true, force: true }); }
});
test("F01b fails closed for tampered/missing keys, paths/symlinks and unknown backup content", async () => {
  const root = await mkdtemp(join(tmpdir(), "smo-backups-"));
  try {
    const store = new DemoBackupStore(join(root, "copies"), join(root, "key")); await store.initialize();
    const created = await store.create({ database: Buffer.from("synthetic"), secrets: Buffer.from("synthetic"), files: [] });
    await assert.rejects(store.read("../other"));
    await writeFile(join(root, "copies", created.id, "unexpected"), "synthetic", { mode: 0o600 });
    await assert.rejects(store.retention(true)); await rm(join(root, "copies", created.id, "unexpected"));
    await writeFile(join(root, "copies", created.id, "database.box"), "tampered", { mode: 0o600 }); await assert.rejects(store.read(created.id));
    await rm(join(root, "key")); await assert.rejects(store.initialize());
    await mkdir(join(root, "other"), { mode: 0o700 }); await symlink(join(root, "other"), join(root, "link"));
    await assert.rejects(new DemoBackupStore(join(root, "link"), join(root, "key2")).initialize());
    assert.throws(() => new DemoBackupStore("public/backups", join(root, "key")));
    assert.throws(() => new DemoBackupStore(join(root, "copies"), join(root, "copies", "key")));
  } finally { await rm(root, { recursive: true, force: true }); }
});
