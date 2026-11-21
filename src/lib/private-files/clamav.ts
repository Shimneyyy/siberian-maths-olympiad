import { createConnection } from "node:net";
import { scannerDatabaseStatus, ScannerUnavailable } from "./scanner-health";
export { ScannerUnavailable } from "./scanner-health";
// Local demo transport; no filename, storage path or user metadata reaches clamd.
export async function scanWithClamav(input: Uint8Array, port = 3310, timeoutMs = 30000): Promise<"CLEAN" | "REJECTED"> {
  if (process.env.DEMO_REGISTRATION !== "true" || process.env.NODE_ENV === "production" || !input.byteLength || input.byteLength > 10 * 1024 * 1024 || !Number.isInteger(port) || port < 1 || port > 65535 || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw new ScannerUnavailable();
  if(!(await scannerDatabaseStatus(port,Math.min(timeoutMs,2000))).fresh)throw new ScannerUnavailable();
  const bytes = Buffer.from(input);
  return new Promise((resolve, reject) => {
    let finished = false, sent = false, response = "";
    const socket = createConnection({ host: "127.0.0.1", port });
    function fail() { if (finished) return; finished = true; clearTimeout(timer); socket.destroy(); reject(new ScannerUnavailable()); }
    const timer = setTimeout(fail, timeoutMs);
    socket.on("error", fail); socket.on("end", fail); socket.on("close", fail);
    socket.on("data", chunk => {
      response += chunk.toString("utf8");
      if (response.length > 1024) return fail();
      if (!response.includes("\0")) return;
      const result = response === "stream: OK\0" ? "CLEAN" : /^stream: [^\r\n\0]+ FOUND\0$/.test(response) ? "REJECTED" : null;
      if (!result || !sent) return fail();
      finished = true; clearTimeout(timer); socket.destroy(); resolve(result);
    });
    const write = (buffer: Buffer) => new Promise<void>((ok, bad) => socket.write(buffer, error => error ? bad(error) : ok()));
    socket.once("connect", () => {
      void (async () => {
        if (finished) return;
        await write(Buffer.from("zINSTREAM\0"));
        for (let offset = 0; offset < bytes.length; offset += 65536) {
          if (finished) return;
          const chunk = bytes.subarray(offset, offset + 65536), length = Buffer.alloc(4);
          length.writeUInt32BE(chunk.length); await write(length); await write(chunk);
        }
        sent = true;
        await write(Buffer.alloc(4));
      })().catch(fail);
    });
  });
}
