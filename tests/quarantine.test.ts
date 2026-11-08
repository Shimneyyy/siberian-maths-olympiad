import { spawnSync, execFileSync } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat, chmod, symlink, writeFile, readFile, readdir, link } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { DemoQuarantine } from "../src/lib/private-files/quarantine";
process.env.DEMO_REGISTRATION = "true";
async function fixture(run: (base: string, root: string, store: DemoQuarantine) => Promise<void>) {
  const base = await mkdtemp(join(tmpdir(), "synthetic-quarantine-")), root = join(base, "private");
  try { const store = new DemoQuarantine(root, 1024); await store.initialize(); await run(base, root, store); }
  finally { await rm(base, { recursive: true, force: true }); }
}
test("E09a private quarantine preserves bytes/hash, uses private permissions and unique opaque keys", async () => fixture(async (_base, root, store) => {
  const bytes=Buffer.from("synthetic bytes only");
  const a=await store.put(bytes), b=await store.put(bytes);
  assert.notEqual(a.key,b.key); assert.equal(a.sha256,createHash("sha256").update(bytes).digest("hex"));
  assert.deepEqual(await store.read(a.key,a.sha256),bytes);
  assert.equal((await stat(root)).mode & 0o077,0);
  assert.equal((await stat(join(root,`${a.key}.quarantine`))).mode & 0o077,0);
  await assert.rejects(store.read(a.key,"a".repeat(64)));
  await writeFile(join(root,`${a.key}.quarantine`),"modified synthetic bytes");
  await assert.rejects(store.read(a.key,a.sha256));
}));
test("E09a bounds, traversal, symlinks and hardlinks fail without altering outside files", async () => fixture(async (base,root,store) => {
  await assert.rejects(store.put(Buffer.alloc(1025)));await assert.rejects(store.put(Buffer.alloc(0)));
  assert.deepEqual(await readdir(root),[]);
  const outside=join(base,"outside"), bytes=Buffer.from("synthetic outside");await writeFile(outside,bytes,{mode:0o600});
  const hash=createHash("sha256").update(bytes).digest("hex");
  for(const key of ["../outside","/outside",`${randomUUID()}/../outside`,"%2e%2e%2foutside"]) await assert.rejects(store.read(key,hash));
  const key=randomUUID();await symlink(outside,join(root,`${key}.quarantine`));await assert.rejects(store.read(key,hash));
  const hard=randomUUID();await link(outside,join(root,`${hard}.quarantine`));await assert.rejects(store.read(hard,hash));
  const fifo=randomUUID();execFileSync("mkfifo",[join(root,`${fifo}.quarantine`)]);await assert.rejects(store.read(fifo,hash));
  assert.deepEqual(await readFile(outside),bytes);
}));
test("E09a public roots and symlink roots reject; disabled demo mode cannot initialize or read", async () => fixture(async (base,root,store) => {
  const entry=await store.put(Buffer.from("synthetic"));
  await chmod(root,0o755);await assert.rejects(store.put(Buffer.from("synthetic")));await assert.rejects(store.read(entry.key,entry.sha256));await chmod(root,0o700);
  const alias=join(base,"alias");await symlink(root,alias);await assert.rejects(new DemoQuarantine(alias,1024).initialize());
  process.env.DEMO_REGISTRATION="false";
  try {await assert.rejects(store.initialize());await assert.rejects(store.read(entry.key,entry.sha256));}
  finally {process.env.DEMO_REGISTRATION="true";}
  for (const folder of ["public", ".next", "out"]) assert.throws(()=>new DemoQuarantine(join(process.cwd(),folder,"private"),1024));
  assert.throws(()=>new DemoQuarantine(root,Infinity));assert.throws(()=>new DemoQuarantine(root,-1));
}));

test("E09a production refuses even when demo flag is enabled", async () => fixture(async (_base,root) => {
  const code=`import { DemoQuarantine } from './src/lib/private-files/quarantine.ts'; import assert from 'node:assert/strict'; await assert.rejects(new DemoQuarantine(${JSON.stringify(root)},1024).initialize());`;
  const run=spawnSync(process.execPath,["--import","tsx","--input-type=module","-e",code],{env:{...process.env,NODE_ENV:"production",DEMO_REGISTRATION:"true"},encoding:"utf8"});
  assert.equal(run.status,0);
}));
