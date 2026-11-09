import { constants } from "node:fs";
import { mkdir, open, readdir, realpath, rm, stat } from "node:fs/promises";
import { resolve, dirname, join, sep } from "node:path";
import { createHash, createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
const uuid = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
const manifestSchema = z.object({ format: z.literal(1), synthetic: z.literal(true), createdAt: z.iso.datetime(), files: z.array(z.object({ key: uuid, hash }).strict()).max(1000) }).strict();
export type BackupPayload = { database: Buffer; secrets: Buffer; files: { key: string; hash: string; bytes: Buffer }[] };
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
export class ManagedBackupError extends Error { constructor() { super("SYNTHETIC_BACKUP_UNAVAILABLE"); } }
// Demo only. The wrapping key is outside the managed backup directory, never in its manifest.
export class DemoBackupStore {
  readonly root: string; readonly keyPath: string;
  constructor(root: string, keyPath: string) {
    this.root = resolve(root); this.keyPath = resolve(keyPath);
    if (this.keyPath === this.root || this.keyPath.startsWith(this.root + sep)) throw new ManagedBackupError();
    for (const folder of ["public", ".next", "out"]) { const exposed = resolve(folder); if (this.root === exposed || this.root.startsWith(exposed + sep) || this.keyPath === exposed || this.keyPath.startsWith(exposed + sep)) throw new ManagedBackupError(); }
  }
  #guard() { if (process.env.DEMO_REGISTRATION !== "true" || process.env.NODE_ENV === "production") throw new ManagedBackupError(); }
  async #directory(path: string) { const info = await stat(path); if (!info.isDirectory() || (info.mode & 0o077) || await realpath(path) !== path) throw new ManagedBackupError(); }
  async #read(path: string, limit = 200 * 1024 * 1024) {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try { const info = await file.stat(); if (!info.isFile() || info.nlink !== 1 || (info.mode & 0o077) || info.size > limit) throw new ManagedBackupError(); const bytes = await file.readFile(); if (bytes.length !== info.size) throw new ManagedBackupError(); return bytes; } finally { await file.close(); }
  }
  async #write(path: string, bytes: Buffer) { const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); } }
  async initialize() {
    this.#guard(); await mkdir(this.root, { recursive: true, mode: 0o700 }); await this.#directory(this.root);
    await mkdir(dirname(this.keyPath), { recursive: true, mode: 0o700 }); await this.#directory(dirname(this.keyPath));
    try { if ((await this.#read(this.keyPath, 32)).length !== 32) throw new ManagedBackupError(); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT" || (await readdir(this.root)).length) throw new ManagedBackupError(); await this.#write(this.keyPath, randomBytes(32)); }
  }
  async #key() { this.#guard(); await this.#directory(this.root); await this.#directory(dirname(this.keyPath)); const key = await this.#read(this.keyPath, 32); if (key.length !== 32) throw new ManagedBackupError(); return key; }
  #aad(id: string, name: string) { return Buffer.from(`smo-synthetic-backup-v1:${uuid.parse(id)}:${name}`); }
  async #sealed(path: string, bytes: Buffer, key: Buffer, id: string, name: string) {
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv); cipher.setAAD(this.#aad(id, name));
    const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
    await this.#write(path, Buffer.concat([iv, cipher.getAuthTag(), encrypted]));
  }
  async #opened(path: string, key: Buffer, id: string, name: string) {
    const bytes = await this.#read(path); if (bytes.length < 28) throw new ManagedBackupError();
    const cipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12)); cipher.setAuthTag(bytes.subarray(12, 28)); cipher.setAAD(this.#aad(id, name));
    return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]);
  }
  async create(payload: BackupPayload) {
    const key = await this.#key(), id = randomUUID(), root = join(this.root, id);
    try {
      if (!payload.database.length || payload.database.length > 64 * 1024 * 1024 || !payload.secrets.length || payload.secrets.length > 65536 || payload.files.length > 1000) throw new ManagedBackupError();
      let size = payload.database.length; const keys = new Set<string>();
      for (const file of payload.files) { uuid.parse(file.key); hash.parse(file.hash); size += file.bytes.length; if (keys.has(file.key) || file.bytes.length > 10485760 || digest(file.bytes) !== file.hash) throw new ManagedBackupError(); keys.add(file.key); }
      if (size > 128 * 1024 * 1024) throw new ManagedBackupError();
      await mkdir(root, { mode: 0o700 });
      const manifest = { format: 1 as const, synthetic: true as const, createdAt: new Date().toISOString(), files: payload.files.map(f => ({ key: f.key, hash: f.hash })) };
      await this.#sealed(join(root, "database.box"), payload.database, key, id, "database");
      await this.#sealed(join(root, "secrets.box"), payload.secrets, key, id, "secrets");
      for (const file of payload.files) await this.#sealed(join(root, `${file.key}.box`), file.bytes, key, id, `file:${file.key}`);
      await this.#sealed(join(root, "manifest.box"), Buffer.from(JSON.stringify(manifest)), key, id, "manifest");
      return { id, createdAt: manifest.createdAt, files: payload.files.length };
    } catch { await rm(root, { recursive: true, force: true }); throw new ManagedBackupError(); } finally { key.fill(0); }
  }
  async #manifest(id: string, key: Buffer) {
    uuid.parse(id); const root = join(this.root, id); await this.#directory(root);
    const manifest = manifestSchema.parse(JSON.parse((await this.#opened(join(root, "manifest.box"), key, id, "manifest")).toString("utf8")));
    const expected = new Set(["manifest.box", "database.box", "secrets.box", ...manifest.files.map(f => `${f.key}.box`)]);
    const files = await readdir(root); if (files.length !== expected.size || files.some(f => !expected.has(f))) throw new ManagedBackupError();
    return manifest;
  }
  async read(id: string) {
    const key = await this.#key();
    try { const manifest = await this.#manifest(id, key), root = join(this.root, id), files = [];
      const database = await this.#opened(join(root, "database.box"), key, id, "database"), secrets = await this.#opened(join(root, "secrets.box"), key, id, "secrets");
      for (const file of manifest.files) { const bytes = await this.#opened(join(root, `${file.key}.box`), key, id, `file:${file.key}`); if (digest(bytes) !== file.hash) throw new ManagedBackupError(); files.push({ ...file, bytes }); }
      return { database, secrets, files, createdAt: manifest.createdAt };
    } catch { throw new ManagedBackupError(); } finally { key.fill(0); }
  }
  async retention(apply = false, now = new Date()) {
    const key = await this.#key();
    try {
      if (!Number.isFinite(now.getTime()) || now.getTime() > Date.now() + 60000) throw new ManagedBackupError();
      const cutoff = new Date(now.getTime() - 30 * 86400000), expired = [];
      for (const id of await readdir(this.root)) { const manifest = await this.#manifest(id, key); if (new Date(manifest.createdAt) <= cutoff) expired.push(id); }
      if (apply) { for (const id of expired) await this.read(id); for (const id of expired) await rm(join(this.root, id), { recursive: true }); }
      return { count: expired.length, applied: apply, cutoff };
    } finally { key.fill(0); }
  }
}
