import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { scanWithClamav } from "./clamav";
export class PdfRejected extends Error { constructor() { super("DIPLOMA_PDF_REJECTED"); } }
export class PdfInspectorUnavailable extends Error { constructor() { super("PDF_INSPECTOR_UNAVAILABLE"); } }
export async function inspectPassivePdf(input: Uint8Array, mime: string) {
  if (process.env.DEMO_REGISTRATION !== "true" || process.env.NODE_ENV === "production") throw new PdfInspectorUnavailable();
  if (mime !== "application/pdf" || !input.byteLength || input.byteLength > 10 * 1024 * 1024) throw new PdfRejected();
  const bytes = Buffer.from(input);
  return new Promise<{ pages: number; sha256: string }>((ok, bad) => {
    let settled = false, output = "";
    // jitless avoids V8's large executable CodeRange reservation under RLIMIT_DATA.
    const child = spawn("/usr/bin/prlimit", ["--core=0", "--data=268435456", "--cpu=10", "--", process.execPath, "--jitless", "--max-old-space-size=96", resolve("scripts/check-passive-pdf.mjs")], { stdio: ["pipe", "pipe", "ignore"], env: { NODE_ENV: "production", TZ: "UTC" } });
    const finish = (error?: Error, pages?: number) => { if (settled) return; settled = true; clearTimeout(timer); child.kill("SIGKILL"); if (error) bad(error); else ok({ pages: pages!, sha256: createHash("sha256").update(bytes).digest("hex") }); };
    const timer = setTimeout(() => finish(new PdfInspectorUnavailable()), 12000);
    child.on("error", () => finish(new PdfInspectorUnavailable()));
    child.stdin.on("error", () => { /* Child may reject or terminate before reading all input. */ });
    child.stdout.on("data", chunk => { output += chunk.toString("utf8"); if (output.length > 512) finish(new PdfInspectorUnavailable()); });
    child.on("close", code => {
      try {
        const result = JSON.parse(output);
        if (code === 1 && result.valid === false) return finish(new PdfRejected());
        if (code !== 0 || result.valid !== true || !Number.isInteger(result.pages) || result.pages < 1 || result.pages > 100) return finish(new PdfInspectorUnavailable());
        finish(undefined, result.pages);
      } catch { finish(new PdfInspectorUnavailable()); }
    });
    child.stdin.end(bytes);
  });
}
// Both stages operate on the exact same private copy; a CLEAN answer alone cannot
// bypass structural inspection, and caller mutation cannot change the scanned PDF.
export async function inspectDiplomaPdf(input: Uint8Array, mime: string) {
  if (!input.byteLength || input.byteLength > 10 * 1024 * 1024) throw new PdfRejected();
  const bytes = Buffer.from(input);
  const structure = await inspectPassivePdf(bytes, mime);
  if (await scanWithClamav(bytes) !== "CLEAN") throw new PdfRejected();
  return { ...structure, scan: "CLEAN" as const };
}
