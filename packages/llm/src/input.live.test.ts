import { applyPatch, type LucidDoc } from "@lucid/core";
import { blocksToLmd } from "@lucid/kit";
import { describe, expect, it } from "vitest";
import { LmStudioClient } from "./client";
import { runInput } from "./input";

/**
 * Runs the Input lane against the real model in LM Studio. Skipped unless LUCID_LIVE=1 (the unit tests use the
 * mock server): `LUCID_LIVE=1 pnpm exec vitest run --project @lucid/llm input.live`.
 */
const live = process.env["LUCID_LIVE"] === "1";
const client = new LmStudioClient({
  baseUrl: process.env["LMSTUDIO_URL"] ?? "http://127.0.0.1:1234",
});

const CASES = [
  {
    name: "A. load balancer notes",
    utterance:
      "Load balancer. Multiple application servers behind it. Distribute incoming traffic. Health checks to avoid unhealthy servers. Database can become the bottleneck.",
    expect: (types: string[]) => {
      expect(types).toContain("heading");
      expect(types).not.toContain("diagram");
    },
  },
  {
    name: "B. request flow diagram",
    utterance:
      "Create a request flow. The user enters a domain. DNS resolves the domain and returns an IP address. The client sends a request to the web server. The web server checks Redis. If the cache misses, it queries PostgreSQL. PostgreSQL returns the data, Redis stores the result, and the web server returns JSON to the client.",
    expect: (types: string[]) => {
      expect(types).toContain("diagram");
    },
  },
  {
    name: "D. comparison table",
    utterance:
      "Create a comparison table. Three columns: property, SQL, NoSQL. Rows: schema, relationships, scaling, consistency, and use cases.",
    expect: (types: string[]) => {
      expect(types).toContain("table");
    },
  },
  {
    name: "wispr-style list",
    utterance:
      "Things to cover tomorrow:\n1. Consistent hashing\n2. Rate limiting\n3. Back pressure in queues",
    expect: (types: string[]) => {
      expect(types.some((t) => t.endsWith("ListItem"))).toBe(true);
    },
  },
] as const;

describe.skipIf(!live)("Input lane with the real model", () => {
  for (const c of CASES) {
    it(
      c.name,
      async () => {
        const doc: LucidDoc = { blocks: [] };
        const started = Date.now();
        const out = await runInput({ doc, utterance: c.utterance }, { client });
        const ms = Date.now() - started;
        const tokens = out.calls.reduce((n, call) => n + call.usage.completion, 0);
        console.log(
          `\n=== ${c.name} (${String(ms)} ms, ${String(tokens)} tokens, ${out.kind}) ===`,
        );
        for (const call of out.calls) {
          const ttft =
            call.timings.firstTokenAt === null
              ? "?"
              : String(call.timings.firstTokenAt - call.timings.sentAt);
          console.log(
            `call: prompt ${String(call.usage.prompt)} tok, ttft ${ttft} ms, ${String(call.usage.completion)} tok out`,
          );
        }
        console.log(out.raw);
        if (out.kind === "applied") {
          const next = applyPatch(doc, out.patch);
          console.log("--- document as LMD ---\n" + blocksToLmd(next.blocks));
          console.log("warnings:", out.warnings, "repaired:", out.repaired);
          c.expect(next.blocks.map((b) => b.type));
        } else {
          throw new Error(`not applied: ${out.kind}`);
        }
      },
      180_000,
    );
  }
});
