import { applyPatch } from "@lucid/core";
import { describe, expect, it } from "vitest";
import { LmStudioClient } from "../client";
import { runCommand } from "../commandPipeline";
import { DEFAULT_LANES } from "../lanes";
import { COMMAND_DOC, buildCommandMessages } from "./command";
import { buildInputMessages } from "./input";
import { STATIC_PREFIX } from "./prefix";

/**
 * Measures, with the real model, how many tokens the static part of each lane's prompt is (everything before the part
 * that changes with the page and the words). `LUCID_LIVE=1 pnpm exec vitest run --project @lucid/llm prefix.live --silent=false`.
 */
const live = process.env["LUCID_LIVE"] === "1";

/** The prompt length the server counts (a one-token answer is enough; the client would call that empty). */
async function tokens(
  lane: typeof DEFAULT_LANES.input,
  messages: { role: "system" | "user" | "assistant"; content: string }[],
): Promise<number> {
  const res = await fetch(
    `${process.env["LMSTUDIO_URL"] ?? "http://127.0.0.1:1234"}/v1/chat/completions`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: lane.model,
        messages,
        max_tokens: 1,
        reasoning_effort: "none",
        stream: false,
      }),
    },
  );
  const body = (await res.json()) as { usage?: { prompt_tokens?: number } };
  return body.usage?.prompt_tokens ?? 0;
}

describe.skipIf(!live)("static prompt prefix (real model)", () => {
  it("command lane", { timeout: 300_000 }, async () => {
    const { messages } = buildCommandMessages({ doc: { blocks: [] }, utterance: "x" });
    const stat = messages.slice(0, -1);
    const a = await tokens(DEFAULT_LANES.command, [...stat, { role: "user", content: "x" }]);
    const b = await tokens(DEFAULT_LANES.command, [
      ...stat,
      { role: "user", content: "x x x x x x x x x x" },
    ]);
    console.log(
      `COMMAND static ≈ ${String(a - 6)} tokens (with one-token message ${String(a)}, ten-token ${String(b)})`,
    );
    // STATIC_PREFIX must say what the server counts (a few tokens of template overhead aside).
    expect(Math.abs(a - 6 - STATIC_PREFIX.command.tokens)).toBeLessThanOrEqual(8);
    const full = buildCommandMessages({
      doc: COMMAND_DOC,
      utterance: "Add a CDN in front of the web server.",
      cursorBlockId: "d1",
    });
    console.log(
      `COMMAND full for COMMAND_DOC: ${String(await tokens(DEFAULT_LANES.command, full.messages))}`,
    );
  });
  it("input lane", { timeout: 300_000 }, async () => {
    const { messages } = buildInputMessages({ doc: { blocks: [] }, utterance: "x" });
    const stat = messages.slice(0, -1);
    const a = await tokens(DEFAULT_LANES.input, [...stat, { role: "user", content: "x" }]);
    console.log(`INPUT static ≈ ${String(a - 6)} tokens (with one-token message ${String(a)})`);
  });

  it(
    "turn after turn on a changing page: time to the first token",
    { timeout: 600_000 },
    async () => {
      const client = new LmStudioClient({
        baseUrl: process.env["LMSTUDIO_URL"] ?? "http://127.0.0.1:1234",
      });
      let doc = COMMAND_DOC;
      const says = [
        ["Add a CDN in front of the web server.", "d1"],
        ["Cross out MongoDB.", "b6"],
        ["Add a row for consistency to the table.", "t1"],
        ["Rename the SQL column to Relational.", "t1"],
      ] as const;
      for (const [say, cursor] of says) {
        const t0 = Date.now();
        const out = await runCommand({ doc, utterance: say, cursorBlockId: cursor }, { client });
        const call = out.calls[0];
        const first = call?.timings.firstTokenAt
          ? (call.timings.firstTokenAt - call.timings.sentAt) / 1000
          : NaN;
        console.log(
          `TURN "${say}" -> ${out.kind}: first token ${first.toFixed(1)}s, total ${((Date.now() - t0) / 1000).toFixed(1)}s, prompt ${String(call?.usage.prompt)}`,
        );
        if (out.kind === "edit") doc = applyPatch(doc, out.patch);
      }
    },
  );
});
