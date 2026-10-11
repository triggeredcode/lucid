import { describe, expect, it } from "vitest";
import { readSse } from "./sse";

const stream = (parts: string[]): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const p of parts) controller.enqueue(encoder.encode(p));
      controller.close();
    },
  });
};
const collect = async (parts: string[]): Promise<string[]> => {
  const out: string[] = [];
  for await (const data of readSse(stream(parts))) out.push(data);
  return out;
};

describe("readSse", () => {
  it("yields each data payload", async () => {
    expect(await collect(['data: {"a":1}\n\ndata: [DONE]\n\n'])).toEqual(['{"a":1}', "[DONE]"]);
  });

  it("joins events split across chunks, even in the middle of a character", async () => {
    const encoded = new TextEncoder().encode("data: café\n\n");
    const cut = encoded.indexOf(0xc3) + 1; // between the two bytes of "é"
    const encoder = new TextEncoder();
    const parts = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(encoded.slice(0, cut));
        c.enqueue(encoded.slice(cut));
        c.enqueue(encoder.encode("data: x\n"));
        c.close();
      },
    });
    const out: string[] = [];
    for await (const data of readSse(parts)) out.push(data);
    expect(out).toEqual(["café", "x"]);
  });

  it("handles CRLF, comments and unknown fields", async () => {
    expect(await collect([": keep-alive\r\nevent: message\r\ndata: one\r\n\r\n"])).toEqual(["one"]);
  });
});
