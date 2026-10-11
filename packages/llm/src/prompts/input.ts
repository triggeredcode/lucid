import { LMD_REFERENCE, buildOutline, getFormat, registry } from "@lucid/kit";
import type { Block, LucidDoc } from "@lucid/core";
import type { ChatMessage } from "../client";

export const INPUT_PROMPT_VERSION = 1;

const BLOCK_ORDER = [
  "heading",
  "paragraph",
  "bulletListItem",
  "checkListItem",
  "callout",
  "table",
  "diagram",
  "chart",
  "math",
  "code",
] as const;

const blockGuide = (): string =>
  BLOCK_ORDER.map((type) => `- ${registry.get(type).describe.replace(/\n/g, "\n  ")}`).join("\n");

/** Static for every request, so the model server can reuse its cache of this part. */
export function inputSystemPrompt(): string {
  return `You are Lucid's note structurer. The user is thinking out loud while studying system design and inference engineering. Turn what they just said into clean, well-organised notes.

Principles:
1. Preserve the user's meaning. Do NOT add facts, numbers, components or relationships they did not say. You may fix grammar, drop filler words ("um", "like", "you know") and fix obvious speech-recognition mistakes in technical terms ("post gress" is PostgreSQL, "red is" is Redis).
2. Choose the lightest structure that fits:
   - a few related points: a short heading and bullets
   - an explanation: a paragraph, with the key term in bold once
   - components that interact, a flow, an architecture or a sequence of calls: a graph block
   - an explicit comparison across attributes: a table; advantages against disadvantages: a two-column table (Pros | Cons)
   - numbers measured across models or runs: a table, and a chart only if they ask for a chart or say "plot"
   - a decision or conclusion: a callout
   - formulas: $...$ inline or a $$ block
   Never turn ordinary text into a diagram or table unless relationships or attributes are actually described.
3. Use a heading only when the utterance starts a new topic; if it continues the current section, add no heading. The page already has its title, so never write one: use # for a main topic, ## for a sub-topic of it and ### for a detail.
4. Placement: the first line MAY be a directive: "@@ after bN", "@@ before bN", "@@ append_to bN" (add items to the list bN, or rows to the table bN), "@@ section Heading text" or "@@ end". Use append_to when the user adds to something that already exists. With no directive the notes go after the cursor.
5. Be terse. No preamble, no closing remarks, no code fence around the whole answer. Only the notes.
6. If the utterance is clearly an instruction to edit the document (for example "turn that into a table", "cross out MongoDB", "undo"), answer with exactly: @@ command

${LMD_REFERENCE}

What each kind of block is for:
${blockGuide()}`;
}

export interface Example {
  doc: LucidDoc;
  utterance: string;
  answer: string;
  focus?: string;
}

const text = (t: string) => [{ type: "text" as const, text: t, styles: {} }];
const para = (id: string, t: string): Block => ({
  id,
  type: "paragraph",
  props: {},
  content: text(t),
});
const head = (id: string, level: number, t: string): Block => ({
  id,
  type: "heading",
  props: { level },
  content: text(t),
});
const bullet = (id: string, t: string): Block => ({
  id,
  type: "bulletListItem",
  props: {},
  content: text(t),
});

const requirements: LucidDoc = {
  blocks: [
    head("h1", 1, "Requirements"),
    bullet("q1", "100M new URLs per day"),
    bullet("q2", "Reads far outnumber writes"),
  ],
};

/** Few-shot examples, as real (outline, utterance) to answer pairs. Tested to parse and to be grounded. */
export const INPUT_EXAMPLES: readonly Example[] = [
  {
    doc: { blocks: [] },
    utterance:
      "Load balancer. Multiple application servers behind it. Distribute incoming traffic. Health checks to avoid unhealthy servers. Database can become the bottleneck.",
    answer: `# Load Balancer
A **load balancer** sits in front of multiple application servers and distributes incoming traffic across them.
- **Health checks** keep traffic away from unhealthy servers.
- The **database** can become the bottleneck.`,
  },
  {
    doc: {
      blocks: [head("h1", 1, "How a request flows"), para("p1", "Walking through one page load.")],
    },
    utterance:
      "Request flow. The user enters a domain. DNS resolves the domain and returns an IP address. The client sends a request to the web server. The web server checks Redis. If the cache misses it queries PostgreSQL. PostgreSQL returns the data, Redis stores the result, and the web server returns JSON to the client.",
    answer: `\`\`\`graph type=flowchart dir=TB title="Request flow"
user [actor]: User
client [client]: Client
dns [external]: DNS
web [service]: Web Server
redis [cache]: Redis
pg [datastore]: PostgreSQL
user -> client: enters domain
client -> dns: resolve domain
dns -> client: IP address
client -> web: HTTP request
web -> redis: check cache
web -.-> pg: cache miss: query
pg -.-> web: data
web -.-> redis: store result
web -> client: JSON response
\`\`\``,
  },
  {
    doc: { blocks: [head("h1", 1, "Databases")] },
    utterance:
      "Compare SQL and NoSQL. Schema is fixed for SQL but flexible for NoSQL. Relationships use joins in SQL and NoSQL denormalises. Scaling is vertical for SQL and horizontal for NoSQL.",
    answer: `Table: SQL vs NoSQL
| Property | SQL | NoSQL |
| --- | --- | --- |
| Schema | Fixed | Flexible |
| Relationships | Joins | Denormalised |
| Scaling | Vertical | Horizontal |`,
  },
  {
    // Asking for a table, with its columns and rows named, is content for Input Mode: the table is made, cells left empty.
    doc: { blocks: [head("h1", 1, "Messaging")] },
    utterance:
      "Create a comparison table. Three columns: feature, Kafka, SQS. Rows: ordering, retention and replay.",
    answer: `Table: Kafka vs SQS
| Feature | Kafka | SQS |
| --- | --- | --- |
| Ordering |  |  |
| Retention |  |  |
| Replay |  |  |`,
  },
  {
    doc: requirements,
    utterance: "Also custom aliases and expiry dates for links.",
    focus: "q2",
    answer: `@@ append_to b2
- Custom aliases
- Expiry dates for links`,
  },
  {
    doc: { blocks: [head("h1", 1, "Inference notes")] },
    utterance:
      "KV cache memory is two times layers times heads times head dimension times bytes per element times sequence length. It grows linearly with context.",
    answer: `$$
M_{KV} = 2 \\cdot L \\cdot H \\cdot d_{head} \\cdot b \\cdot T
$$
The **KV cache** grows linearly with context length.`,
  },
  {
    // A formula said in words, inside a sentence about a rule of thumb: the formula is written as math, the rest stays text.
    doc: { blocks: [head("h1", 1, "Inference notes")] },
    utterance:
      "Prefill is compute bound: the time to first token is roughly the prompt length times the FLOPs per token divided by the GPU's FLOPs per second.",
    answer: `**Prefill** is compute bound.
$$
t_{first} \\approx \\frac{N_{prompt} \\cdot F_{token}}{F_{GPU}}
$$`,
  },
  {
    // A sentence that sounds like an instruction but is content: in Input Mode it is a note, never a command.
    doc: requirements,
    utterance: "Then we delete old entries after thirty days.",
    focus: "q2",
    answer: "- Delete old entries after thirty days",
  },
];

export interface InputContext {
  doc: LucidDoc;
  title?: string | undefined;
  format?: string | undefined;
  cursorBlockId?: string | undefined;
  /** The last few things the user said, oldest first. */
  recent?: readonly { mode: "input" | "command"; text: string }[] | undefined;
  utterance: string;
  /** Block ids the utterance or the user's recent work points at; shown in full in the outline. */
  focusIds?: readonly string[] | undefined;
}

/** The part of the request that changes every time: the document as an outline, where the cursor is, what was said. */
export function inputUserMessage(ctx: InputContext): {
  text: string;
  refMap: ReturnType<typeof buildOutline>["refMap"];
} {
  // The outline depends on the document only (not on the cursor or the words), so the model server can reuse its work on
  // everything before the cursor line; the Input lane only needs references, not details.
  const format = getFormat(ctx.format);
  const outline = buildOutline(ctx.doc, {
    title: ctx.title,
    format: format?.name ?? ctx.format,
    full: ctx.focusIds,
  });
  const cursorRef = ctx.cursorBlockId ? outline.refMap.refOf(ctx.cursorBlockId) : undefined;
  const lines = [
    "OUTLINE",
    outline.text,
    "",
    `CURSOR: ${cursorRef ? `in [${cursorRef}]` : "none (the end of the document)"}`,
  ];
  if (format) {
    // The page is a note of this kind: say where each sort of note belongs, so dictation lands in the right section.
    lines.push(
      "",
      `SECTIONS of this ${format.name.toLowerCase()} (to put notes in one, start with "@@ section <heading>"; never write the heading itself):`,
      ...format.sections.map((s) => `- ${s.heading}: ${s.hint} Suits: ${s.prefer.join(", ")}.`),
    );
  }
  if (ctx.recent && ctx.recent.length > 0) {
    lines.push("", "RECENT:", ...ctx.recent.slice(-3).map((r) => `- (${r.mode}) ${r.text}`));
  }
  lines.push("", "UTTERANCE:", ctx.utterance.trim());
  return { text: lines.join("\n"), refMap: outline.refMap };
}

export function buildInputMessages(ctx: InputContext): {
  messages: ChatMessage[];
  refMap: ReturnType<typeof buildOutline>["refMap"];
} {
  const messages: ChatMessage[] = [{ role: "system", content: inputSystemPrompt() }];
  for (const ex of INPUT_EXAMPLES) {
    const user = inputUserMessage({
      doc: ex.doc,
      utterance: ex.utterance,
      cursorBlockId: ex.focus,
      title: "Example",
    });
    messages.push({ role: "user", content: user.text }, { role: "assistant", content: ex.answer });
  }
  const { text, refMap } = inputUserMessage(ctx);
  messages.push({ role: "user", content: text });
  return { messages, refMap };
}
