import { test } from "node:test";
import assert from "node:assert/strict";
import { BodyTooLarge, readJsonBody } from "../src/lib/http-body";

function request(bytes: Uint8Array | ReadableStream<Uint8Array>) {
  return new Request("http://localhost/api/synthetic", { method: "POST", body: bytes as BodyInit, duplex: "half" } as RequestInit);
}

test("JSON reader rejects malformed UTF-8 as invalid input, not an internal failure", async () => {
  await assert.rejects(readJsonBody(request(Uint8Array.of(0x22, 0xc3, 0x28, 0x22))), SyntaxError);
});

test("JSON reader decodes multibyte text split between stream chunks", async () => {
  const text = JSON.stringify({ name: "Учебное имя" });
  const bytes = new TextEncoder().encode(text);
  const stream = new ReadableStream<Uint8Array>({ start(controller) {
    for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
    controller.close();
  } });
  assert.deepEqual(await readJsonBody(request(stream)), { raw: text, value: { name: "Учебное имя" } });
});

test("JSON reader enforces byte limits and cancels a chunked oversized request", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(new Uint8Array(8)); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(readJsonBody(request(stream), 10), BodyTooLarge);
  assert.equal(cancelled, true);
  const bytes = new TextEncoder().encode('"Я"');
  assert.equal((await readJsonBody(request(bytes), bytes.length)).value, "Я");
  await assert.rejects(readJsonBody(request(bytes), bytes.length - 1), BodyTooLarge);
});

test("JSON reader rejects missing and malformed JSON bodies", async () => {
  await assert.rejects(readJsonBody(new Request("http://localhost")), SyntaxError);
  await assert.rejects(readJsonBody(request(new TextEncoder().encode('{"broken":'))), SyntaxError);
});
