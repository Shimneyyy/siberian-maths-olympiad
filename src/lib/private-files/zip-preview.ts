import { createHash } from "node:crypto";
import { crc32 } from "node:zlib";
import type { Readable } from "node:stream";
import { fromBuffer, type ZipFile } from "yauzl";
export type ZipLimits = { archiveBytes: number; fileBytes: number; entries: number; expandedBytes: number; ratio: number; timeoutMs: number };
// Approved business maxima; ratio/time remain technical fail-closed safeguards.
export const DIPLOMA_ZIP_LIMITS: ZipLimits = { archiveBytes: 50 * 1024 * 1024, fileBytes: 10 * 1024 * 1024, entries: 1000, expandedBytes: 1000 * 10 * 1024 * 1024, ratio: 200, timeoutMs: 60000 };
export type ZipPreviewRow = { index: number; fileName: string; login: string | null; size: number; sha256: string | null; error: "UNSUPPORTED_ENTRY" | "INVALID_NAME" | "NOT_PDF" | "DUPLICATE" | null };
export class UnsafeZip extends Error { constructor() { super("DIPLOMA_ZIP_REJECTED"); } }
// Preflight only: no disk extraction, user matching, malware clearance or upload.
// Required limits are supplied by the future service, not invented business defaults.
export async function previewDiplomaZip(input: Uint8Array, limits: ZipLimits): Promise<ZipPreviewRow[]> {
  if ([limits.archiveBytes, limits.fileBytes, limits.entries, limits.expandedBytes, limits.ratio, limits.timeoutMs].some(n => !Number.isSafeInteger(n) || n < 1) || limits.archiveBytes > 67108864 || limits.fileBytes > 67108864 || limits.entries > 10000 || limits.timeoutMs > 60000 || input.byteLength > limits.archiveBytes || input.byteLength < 22) throw new UnsafeZip();
  const buffer = Buffer.from(input);
  return new Promise((resolve, reject) => {
    let zip: ZipFile | undefined, stream: Readable | undefined, settled = false, expanded = 0;
    const rows: ZipPreviewRow[] = [];
    const fail = () => { if (settled) return; settled = true; clearTimeout(timer); stream?.destroy(); zip?.close(); reject(new UnsafeZip()); };
    const timer = setTimeout(fail, limits.timeoutMs);
    fromBuffer(buffer, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true }, (error, opened) => {
      if (error || !opened) return fail();
      zip = opened;
      if (settled) { zip.close(); return; }
      zip.on("error", fail);
      if (!zip.entryCount || zip.entryCount > limits.entries) return fail();
      zip.on("end", () => {
        if (settled) return;
        settled = true; clearTimeout(timer); zip?.close();
        const counts = new Map<string, number>();
        for (const row of rows) if (row.login !== null) counts.set(row.login, (counts.get(row.login) ?? 0) + 1);
        for (const row of rows) if (row.login !== null && counts.get(row.login)! > 1) row.error = "DUPLICATE";
        resolve(rows);
      });
      zip.on("entry", async entry => {
        try {
          expanded += entry.uncompressedSize;
          if (++entries > limits.entries || !Number.isSafeInteger(expanded) || expanded > limits.expandedBytes || entry.uncompressedSize > limits.fileBytes || entry.uncompressedSize > Math.max(1, entry.compressedSize) * limits.ratio) return fail();
          const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
          const name = entry.fileName;
          const row: ZipPreviewRow = { index: entries, fileName: name, login: null, size: entry.uncompressedSize, sha256: null, error: null };
          rows.push(row);
          const invalidName = /[\\/:\u0000-\u001f\u007f]/.test(name) || name.length > 258 || !/\.pdf$/i.test(name) || ["", ".", ".."].includes(name.slice(0, -4)) || name.slice(0, -4).trim() !== name.slice(0, -4);
          if (!invalidName) row.login = name.slice(0, -4);
          if (entry.isEncrypted() || ![0, 8].includes(entry.compressionMethod) || (mode !== 0 && mode !== 0x8000) || (entry.externalFileAttributes & 0x10)) row.error = "UNSUPPORTED_ENTRY";
          else if (invalidName) row.error = "INVALID_NAME";
          else {
            row.login = name.slice(0, -4); // preserve exact external spelling
            stream = await new Promise<Readable>((ok, bad) => opened.openReadStream(entry, (err, source) => err ? bad(err) : ok(source)));
            let bytes = 0, crc = 0, prefix = Buffer.alloc(0);
            const hash = createHash("sha256");
            for await (const part of stream) {
              const chunk = Buffer.from(part); bytes += chunk.length;
              if (settled || bytes > limits.fileBytes || bytes > entry.uncompressedSize) throw new UnsafeZip();
              if (prefix.length < 5) prefix = Buffer.concat([prefix, chunk.subarray(0, 5 - prefix.length)]);
              hash.update(chunk); crc = crc32(chunk, crc);
            }
            stream = undefined;
            if (bytes !== entry.uncompressedSize || crc !== entry.crc32) return fail();
            if (prefix.toString("ascii") !== "%PDF-") row.error = "NOT_PDF";
            row.sha256 = hash.digest("hex");
          }
          if (!settled) opened.readEntry();
        } catch { fail(); }
      });
      let entries = 0;
      zip.readEntry();
    });
  });
}
