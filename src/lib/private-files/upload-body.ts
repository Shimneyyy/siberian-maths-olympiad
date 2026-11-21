import { BodyTooLarge } from "../http-body";
export class UploadReadTimeout extends Error {}
export async function readUploadBody(request: Request, limit: number, timeoutMs = 30000) {
  if (!request.body) throw new SyntaxError();
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) throw new BodyTooLarge();
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0, timer: ReturnType<typeof setTimeout>;
  const expired = new Promise<never>((_, reject) => { timer = setTimeout(() => {
    reject(new UploadReadTimeout()); void reader.cancel().catch(() => {});
  }, timeoutMs); });
  try {
    for (;;) {
      const {done,value} = await Promise.race([reader.read(), expired]);
      if (done) break;
      size += value.byteLength;
      if (size > limit) { void reader.cancel().catch(() => {}); throw new BodyTooLarge(); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
  } finally { clearTimeout(timer!); reader.releaseLock(); }
}
