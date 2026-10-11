import { createSequentialIds } from "@lucid/core";
import { describe, expect, it } from "vitest";
import { registry } from "../defaultRegistry";
import { parseLmd } from "./parse";
import { blocksToLmd, printPlacement } from "./serialize";

/**
 * Golden samples for LMD. For valid input the snapshot holds the placement, one outline
 * line per block (what the model would see) and the canonical LMD written back; for invalid input, the errors.
 * Review the files in __golden__/ whenever one changes.
 */

const VALID: Record<string, string> = {
  "01-load-balancer": `## Load Balancer
A load balancer sits in front of several application servers and distributes incoming traffic across them.
- **Health checks** keep traffic away from unhealthy servers.
- The **database** can become the bottleneck as app servers scale out.`,
  "02-headings": "# Title\n## Section\n### Sub-section",
  "03-heading-status": "## Old plan {struck}\n### Chosen approach {chosen}",
  "04-soft-wrapped-paragraph":
    "A cache sits in front of the database\nso most reads never reach it.\n\nSecond paragraph.",
  "05-inline-styles":
    "**bold** *italic* __underline__ ~~strike~~ ==highlight== `code` and ***both***",
  "06-nested-inline": "**bold with *italic inside* and ~~strike~~** then plain",
  "07-math-inline": "The hit rate is $h = hits / (hits + misses)$ for a warm cache.",
  "08-links": "Read [the **Redis** docs](https://redis.io/docs) first.",
  "09-escapes": "Literal \\*stars\\*, snake\\_case, a\\=\\=b, \\{struck\\} and \\$5.",
  "10-bullets-status": "- PostgreSQL\n- MongoDB {struck}\n- DynamoDB {chosen}",
  "11-nested-lists": "- Caching\n  - CDN\n  - Redis\n    - cluster mode\n- Queues",
  "12-numbered": "1. Resolve the domain\n2. Send the request\n3. Read the response",
  "13-checklist":
    "- [ ] Benchmark with 32k context\n- [x] Read the paper\n- [ ] Compare MLX and GGUF {struck}",
  "14-mixed-lists": "- bullet\n1. number\n- [ ] check",
  "15-callout-decision": "> [!decision] Database choice\n> DynamoDB for key-value access at scale.",
  "16-callout-body-blocks":
    "> [!warning] Hot partitions\n> Writes to one key throttle.\n>\n> - spread keys\n> - add a suffix",
  "17-plain-quote": "> an aside the user made",
  "18-callout-kinds":
    "> [!key] Takeaway\n> x\n\n> [!tradeoff] Cost\n> y\n\n> [!question] Open\n> z",
  "19-math-block": "$$\nM_{KV} = 2 \\cdot L \\cdot H \\cdot d_{head} \\cdot b \\cdot T\n$$",
  "20-math-one-line": "$$ \\text{hit rate} = \\frac{hits}{hits + misses} $$",
  "21-code-sql": "```sql\nSELECT * FROM urls\n  WHERE short_code = $1;\n```",
  "22-code-no-language": "```\nGET /api/v1/short/abc\n```",
  "23-table-comparison": `Table: SQL vs NoSQL
| Property | SQL | NoSQL |
| --- | --- | --- |
| Schema | Fixed | Flexible |
| Relationships | Joins | Denormalised |
| Scaling | Vertical | Horizontal |
| Use cases | Transactions | Large-scale reads |`,
  "24-table-row-status":
    "| Option | Verdict |\n| --- | --- |\n| PostgreSQL | not needed | {struck}\n| DynamoDB | fits | {chosen}",
  "25-table-no-edge-pipes": "Tool | Use\n--- | ---\nvLLM | serving\nllama.cpp | local",
  "26-table-escaped-pipe": "| A | B |\n| --- | --- |\n| a \\| b | c |",
  "27-diagram-request-flow": `\`\`\`graph type=flowchart dir=LR title="Request flow"
user [actor]: User
client [client]: Client
web [service]: Web Server
redis [cache]: Redis
pg [datastore]: PostgreSQL
user -> client: enters domain
client -> web: HTTP request
web -> redis: check cache
web -.-> pg: cache miss: query
group app: Application boundary {web, redis}
\`\`\``,
  "28-diagram-sequence": `\`\`\`graph type=sequence title="Cache lookup"
c [client]: Client
w [service]: Web
r [cache]: Redis
c -> w: GET
alt hit
w -> r: lookup
else miss
w -> r: set
end
\`\`\``,
  "29-chart-bar":
    '```chart kind=bar title="Decode speed" y="Decode" unit="tok/s"\ncategories: Qwen 27B, Gemma 26B\nseries tok/s: 15.1, 17.7\n```',
  "30-chart-line-two-series":
    '```chart kind=line title="Latency" x="Batch size" unit="ms"\ncategories: 1, 4, 16\nseries p50: 100, 150, 300\nseries p95: 120, 180, 410\n```',
  "31-placement-after": "@@ after b7\n- extra point",
  "32-placement-section": '@@ section "Trade-offs"\n> [!tradeoff] Latency\n> Extra hop.',
  "33-placement-append-to": "@@ append_to b9\n- Cassandra\n- ScyllaDB",
  "34-command-handoff": "@@ command",
  "35-document": `# Designing a URL shortener
## Requirements
- 100M new URLs per day
- Reads outnumber writes 100 to 1
## Design
Table: Key generation options
| Approach | Collisions |
| --- | --- |
| Hash | possible |
| Counter | none |
> [!decision] Use a counter
> Base62-encode a distributed counter.`,
  "36-guarded-lines":
    "\\# not a heading\n\n\\- not a bullet\n\n1\\. not a list\n\nTable\\: not a caption",
  "37-rule-and-blank-lines": "first\n\n---\n\n\n\nsecond",
  "38-crlf": "## Title\r\n- a\r\n- b\r\n",
  "39-code-fence-with-backticks": "````\nuse ``` for fences\n````",
  "40-unprocessed-looking-text": "um so kafka partitions keep ordering only inside a partition",
};

const INVALID: Record<string, string> = {
  "e01-deep-heading": "#### too deep",
  "e02-unknown-callout": "text\n\n> [!tip] Hint\n> body",
  "e03-unclosed-fence": "intro\n```sql\nSELECT 1",
  "e04-unclosed-math": "$$\nx = 1",
  "e05-unsafe-latex": "$$\n\\write18{ls}\n$$",
  "e06-ragged-table": "| a | b |\n| --- | --- |\n| 1 | 2 |\n| only one |",
  "e07-bad-graph-arrow": "```graph\na -> b\nc => d\n```",
  "e08-bad-chart-number": "```chart\ncategories: a, b\nseries x: 1, many\n```",
  "e09-directive-not-first": "text\n@@ end",
  "e10-several-errors": "#### x\n\n> [!tip] y\n\n```sql\nnever closed",
};

const outlineOf = (source: string): string => {
  const r = parseLmd(source, { ids: createSequentialIds("n") });
  if (!r.ok) return `ERRORS ${JSON.stringify(r.errors)}`;
  const lines = [
    `placement: ${printPlacement(r.placement) || "cursor"}${r.command ? " (command)" : ""}`,
  ];
  const walk = (blocks: typeof r.blocks, depth: number) => {
    for (const b of blocks) {
      lines.push(
        `${"  ".repeat(depth)}${registry.get(b.type).outline(b, "full")}`.replace(
          /\n/g,
          `\n${"  ".repeat(depth)}`,
        ),
      );
      if (b.children) walk(b.children, depth + 1);
    }
  };
  walk(r.blocks, 0);
  lines.push("--- canonical LMD", blocksToLmd(r.blocks));
  return lines.join("\n");
};

describe("LMD golden samples (valid)", () => {
  for (const [name, source] of Object.entries(VALID)) {
    it(name, async () => {
      const text = outlineOf(source);
      expect(text.startsWith("ERRORS"), text).toBe(false);
      await expect(`${text}\n`).toMatchFileSnapshot(`./__golden__/${name}.txt`);
    });
  }
});

describe("LMD golden samples (errors)", () => {
  for (const [name, source] of Object.entries(INVALID)) {
    it(name, async () => {
      const r = parseLmd(source, { ids: createSequentialIds("n") });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      await expect(
        `${r.errors.map((e) => `line ${String(e.line)}: ${e.message}`).join("\n")}\n`,
      ).toMatchFileSnapshot(`./__golden__/${name}.txt`);
    });
  }
});
