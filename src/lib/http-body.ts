export class BodyTooLarge extends Error {}
export async function readJsonBody(request: Request, limit = 16384): Promise<{ value: unknown; raw: string }> {
  if (!request.body) throw new SyntaxError("Missing body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) { await reader.cancel(); throw new BodyTooLarge(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const buffer = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }
  let raw: string;
  try { raw = new TextDecoder("utf-8", { fatal: true }).decode(buffer); }
  catch { throw new SyntaxError("Invalid UTF-8 body"); }
  return { value: JSON.parse(raw), raw };
}
