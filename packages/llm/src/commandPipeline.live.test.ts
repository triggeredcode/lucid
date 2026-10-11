import { applyPatch } from "@lucid/core";
import { blocksToLmd } from "@lucid/kit";
import { describe, expect, it } from "vitest";
import { LmStudioClient } from "./client";
import { runCommand } from "./commandPipeline";
import { COMMAND_DOC } from "./prompts/command";

/**
 * Runs the Command lane against the real model in LM Studio. Skipped unless LUCID_LIVE=1:
 * `LUCID_LIVE=1 pnpm exec vitest run --project @lucid/llm commandPipeline.live --silent=false`.
 */
const live = process.env["LUCID_LIVE"] === "1";
const client = new LmStudioClient({
  baseUrl: process.env["LMSTUDIO_URL"] ?? "http://127.0.0.1:1234",
});

const CASES: {
  name: string;
  say: string;
  cursor?: string;
  kind: string;
  check?: (summary: string, after: string) => void;
}[] = [
  {
    name: "C. add CDN to the diagram",
    say: "Add a CDN in front of the web server.",
    cursor: "d1",
    kind: "edit",
    check: (_s, after) => {
      expect(after).toContain("CDN");
    },
  },
  {
    name: "F. add a table row",
    say: "Add another row for consistency to this table.",
    cursor: "t1",
    kind: "edit",
    check: (_s, after) => {
      expect(after).toContain("Consistency");
    },
  },
  {
    name: "E. cross out two, choose one",
    say: "Cross out PostgreSQL and MongoDB. We're choosing DynamoDB, but I want to remember the alternatives.",
    kind: "edit",
    check: (_s, after) => {
      expect(after).toContain("{struck}");
    },
  },
  {
    name: "ambiguous removal",
    say: "Remove the connection between Redis and the client.",
    cursor: "d1",
    kind: "clarify",
  },
  {
    name: "first sentence a heading",
    say: "Make the first sentence a heading.",
    cursor: "p1",
    kind: "edit",
  },
  {
    name: "rename a node",
    say: "Rename the web server to API gateway.",
    cursor: "d1",
    kind: "edit",
    check: (_s, after) => {
      expect(after.toLowerCase()).toContain("api gateway");
    },
  },
  {
    name: "reverse an arrow",
    say: "Reverse the arrow between PostgreSQL and the web server.",
    cursor: "d1",
    kind: "edit",
  },
  {
    name: "group nodes",
    say: "Group the web server and Redis inside an application boundary.",
    cursor: "d1",
    kind: "edit",
  },
  { name: "move the table", say: "Move the table above the diagram.", kind: "edit" },
  {
    name: "list to table",
    say: "Turn those database options into a table.",
    cursor: "o2",
    kind: "edit",
  },
  { name: "delete asks nothing", say: "Delete the database options list.", kind: "edit" },
  {
    name: "vague cleanup asks first",
    say: "Get rid of the comparison table, it is not needed. Actually just tidy it up.",
    kind: "proposal",
  },
];

describe.skipIf(!live)("Command lane with the real model", () => {
  for (const c of CASES) {
    it(
      c.name,
      async () => {
        const started = Date.now();
        const out = await runCommand(
          { doc: COMMAND_DOC, utterance: c.say, cursorBlockId: c.cursor },
          { client },
        );
        const tokens = out.calls.reduce((n, call) => n + call.usage.completion, 0);
        console.log(
          `\n=== ${c.name}: "${c.say}" -> ${out.kind} (${String(Date.now() - started)} ms, ${String(tokens)} tokens${"repaired" in out && out.repaired ? ", repaired" : ""}) ===`,
        );
        for (const call of out.calls) {
          const ttft =
            call.timings.firstTokenAt === null
              ? "?"
              : String(call.timings.firstTokenAt - call.timings.sentAt);
          console.log(
            `call: prompt ${String(call.usage.prompt)} tok, ttft ${ttft} ms, ${String(call.usage.completion)} tok out, total ${String(call.timings.doneAt - call.timings.sentAt)} ms`,
          );
        }
        console.log(out.raw);
        if (out.kind === "edit" || out.kind === "proposal") {
          const next = applyPatch(COMMAND_DOC, out.patch);
          console.log(
            "summary:",
            out.summary,
            out.warnings.length > 0 ? `warnings: ${out.warnings.join(" | ")}` : "",
          );
          c.check?.(out.summary, blocksToLmd(next.blocks));
        }
        // "delete" with the verb is applied; the model may reasonably treat the last case as edit or proposal.
        if (c.kind === "proposal") expect(["proposal", "edit", "clarify"]).toContain(out.kind);
        else expect(out.kind).toBe(c.kind);
      },
      240_000,
    );
  }
});
