import { constants } from "node:fs";
import { mkdir, open, realpath, stat, unlink } from "node:fs/promises";
import { resolve, join, sep } from "node:path";
import { randomUUID, createHash } from "node:crypto";
export class QuarantineError extends Error {
  constructor() { super("PRIVATE_QUARANTINE_UNAVAILABLE"); }
}
const validKey = (key: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(key);
// Internal storage primitive only. No HTTP/public URL, PDF validation, malware
// clearance or authorization is implied by possession of this opaque key.
export class DemoQuarantine {
  readonly #root: string;
  readonly #maxBytes: number;
  constructor(root: string, maxBytes: number) {
    this.#root = resolve(root);
    for (const folder of ["public", ".next", "out"]) {
      const exposed = resolve(process.cwd(), folder);
      if (this.#root === exposed || this.#root.startsWith(exposed + sep)) throw new QuarantineError();
    }
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 67108864) throw new QuarantineError();
    this.#maxBytes = maxBytes;
  }
  #demo() {
    if (process.env.DEMO_REGISTRATION !== "true" || process.env.NODE_ENV === "production") throw new QuarantineError();
  }
  async #check() {
    this.#demo();
    const info = await stat(this.#root);
    if (await realpath(this.#root) !== this.#root || !info.isDirectory() || (info.mode & 0o077) !== 0) throw new QuarantineError();
  }
  async initialize() {
    try { this.#demo(); await mkdir(this.#root, { recursive: true, mode: 0o700 }); await this.#check(); }
    catch { throw new QuarantineError(); }
  }
  #path(key: string) { if (!validKey(key)) throw new QuarantineError(); return join(this.#root, `${key}.quarantine`); }
  async put(bytes: Uint8Array) {
    let handle;
    let path: string | undefined;
    try {
      await this.#check();
      if (!bytes.byteLength || bytes.byteLength > this.#maxBytes) throw new QuarantineError();
      // Copy once so caller mutation cannot change bytes between hash and write.
      const copy = Buffer.from(bytes), key = randomUUID();
      const target = this.#path(key);
      handle = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      path = target;
      await handle.writeFile(copy); await handle.sync(); await handle.close(); handle = undefined;
      return { key, size: copy.byteLength, sha256: createHash("sha256").update(copy).digest("hex") };
    } catch {
      await handle?.close().catch(() => {});
      if (path) await unlink(path).catch(() => {});
      throw new QuarantineError();
    }
  }
  async read(key: string, expectedHash: string) {
    let handle;
    try {
      await this.#check();
      if (!/^[a-f0-9]{64}$/.test(expectedHash)) throw new QuarantineError();
      handle = await open(this.#path(key), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const info = await handle.stat();
      if (!info.isFile() || info.nlink !== 1 || (info.mode & 0o077) !== 0 || info.size < 1 || info.size > this.#maxBytes) throw new QuarantineError();
      const bytes = Buffer.alloc(info.size + 1);
      let length = 0;
      while (length < bytes.length) {
        const result = await handle.read(bytes, length, bytes.length - length, null);
        if (!result.bytesRead) break;
        length += result.bytesRead;
      }
      if (length !== info.size) throw new QuarantineError();
      const content = bytes.subarray(0, length);
      if (createHash("sha256").update(content).digest("hex") !== expectedHash) throw new QuarantineError();
      return content;
    } catch { throw new QuarantineError(); }
    finally { await handle?.close().catch(() => {}); }
  }
}
