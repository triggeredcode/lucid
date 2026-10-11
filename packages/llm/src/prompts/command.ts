import type { LucidDoc } from "@lucid/core";
import {
  LMD_REFERENCE,
  OPS_REFERENCE,
  SAMPLE_DOC,
  blockMentionNotes,
  buildHints,
  buildOutline,
  registry,
} from "@lucid/kit";
import type { ChatMessage } from "../client";

export const COMMAND_PROMPT_VERSION = 1;

/** Static for every request, so the model server can reuse its cache of this part. */
export function commandSystemPrompt(): string {
  return commandInstructions();
}

function commandInstructions(): string {
  return `You are Lucid's document editor. The user speaks an instruction about the document shown below. Answer with ONE JSON object: {"kind": "edit" | "clarify" | "none", "summary", "ops", "question", "options", "reason"}; fields that do not apply to the kind are null.

Rules:
1. Make the smallest targeted change. Never rewrite blocks you were not asked to change.
2. Refer to blocks only by the references in the outline ([b5] is "b5", an item [b9.2] is "b9.2"); inside a table use its row and column ids (r3, c2), inside a diagram its node ids and edge ids. Never invent references.
3. Work out "this", "that" and "the last X" from FOCUS, LAST_TOUCHED and HINTS. If two or more blocks are still plausible, answer kind "clarify" with 2 to 4 options (label, and ref when there is one).
4. Crossing out, discarding or "we are not choosing X" means set_status struck on the whole item, row or node, or a strike mark on a phrase inside a sentence. Never delete unless the user says delete, remove, get rid of, drop or erase.
5. "Choose", "pick" or "go with X" means set_status chosen.
6. Diagrams: prefer graph.insert_between for "add X between, in front of or behind Y"; graph.patch for new nodes, edges and labels; graph.rename, graph.reverse; graph.remove only when asked to remove. Use the node ids already in the diagram. New node ids are short snake_case.
7. Tables: cells are short phrases. When asked to "fill in" cells, give brief, standard, uncontroversial facts. If the user gave no content and the fact is not standard knowledge, leave the cell "" and say so in the summary.
8. Turning something into another form ("turn those points into a diagram") is convert, with the new content written in LMD. Do not add facts, numbers, components or relationships the user did not say.
9. If the instruction is really note content to be written down, not an instruction, answer kind "none" with reason "content". Use "none" for nothing else except when there is truly nothing to do.
10. If you cannot tell what the user means, if the thing they name is not in the document, or two parts of what they said conflict, answer kind "clarify" with 2 to 4 options that would resolve it. Never answer "none" to ask a question.
11. summary: past tense, at most 120 characters, saying what changed. If nothing can be done, kind "none" with a short reason.

${OPS_REFERENCE}

${LMD_REFERENCE}

What each kind of block is for:
${(
  [
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
  ] as const
)
  .map((type) => `- ${registry.get(type).describe.replace(/\n/g, "\n  ")}`)
  .join("\n")}`;
}

export interface CommandContext {
  doc: LucidDoc;
  title?: string | undefined;
  format?: string | undefined;
  cursorBlockId?: string | undefined;
  /** What the model changed most recently, newest first (block id and a short note). */
  touched?: readonly { blockId: string; note: string }[] | undefined;
  recent?: readonly { mode: "input" | "command"; text: string }[] | undefined;
  utterance: string;
  /** Say which names are both a list option and a part of a diagram. A real request does; the examples do not (they are the cached part of the prompt). */
  collisions?: boolean | undefined;
  /** Extra lines for the model after the hints (the guided builder tells it how the person numbers things). */
  extra?: string | undefined;
}

/**
 * The app adds the person's answer to a question the model asked to the end of what they said: `... (I mean: Add a new
 * row for consistency guarantees)`. Said once, plainly, in the request (the static prompt stays as it is, so the server's
 * cache of it is not disturbed), the model acts on the answer instead of asking the same thing again.
 */
export const ANSWERED_NOTE =
  'The UTTERANCE ends with the person\'s answer to your question, in brackets after "I mean:". The answer settles only what you asked; everything else they said still applies (for example the cells to fill in). Answer kind "edit". Do not ask again.';
export const endsWithAnswer = (utterance: string): boolean => /\(I mean: .+\)\s*$/s.test(utterance);

export function commandUserMessage(ctx: CommandContext): {
  text: string;
  refMap: ReturnType<typeof buildOutline>["refMap"];
} {
  // The outline must depend on the DOCUMENT only, never on the cursor or the words just said: then consecutive requests
  // share everything up to the hints, and the model server can reuse its work on the long prefix (a request whose
  // outline differs from the last one's pays for the whole prompt again, ~12 s). So the blocks the model needs to
  // address precisely (diagrams, tables, charts) are always shown in full; only a very large page falls back to
  // summaries, and then the cursor and the last changes decide what stays in detail.
  const always = ctx.doc.blocks
    .filter((b) => b.type === "diagram" || b.type === "table" || b.type === "chart")
    .map((b) => b.id);
  const near = [
    ...(ctx.cursorBlockId ? [ctx.cursorBlockId] : []),
    ...(ctx.touched ?? []).slice(0, 3).map((t) => t.blockId),
  ];
  const small = buildOutline(ctx.doc, {
    title: ctx.title,
    format: ctx.format,
    full: always,
    maxChars: 24_000,
  });
  const outline = small.text.includes("(collapsed)")
    ? buildOutline(ctx.doc, { title: ctx.title, format: ctx.format, full: [...always, ...near] })
    : small;
  const hints = buildHints({
    doc: ctx.doc,
    refMap: outline.refMap,
    cursorBlockId: ctx.cursorBlockId,
    touched: ctx.touched,
    nameCollisions: ctx.collisions ?? true,
  });
  // "In block 3, ...": which reference each number the person said is. Only in a request that names a block, so the examples
  // (the cached part of the prompt) and every other request are unchanged.
  const mentions = blockMentionNotes(ctx.doc, ctx.utterance).join("\n");
  const notes = [
    ctx.extra,
    mentions || undefined,
    endsWithAnswer(ctx.utterance) ? ANSWERED_NOTE : undefined,
  ].filter((n): n is string => Boolean(n));
  const lines = ["OUTLINE", outline.text, "", hints, ...notes.flatMap((n) => ["", n])];
  if (ctx.recent && ctx.recent.length > 0)
    lines.push("", "RECENT:", ...ctx.recent.slice(-3).map((r) => `- (${r.mode}) ${r.text}`));
  lines.push("", "UTTERANCE:", ctx.utterance.trim());
  return { text: lines.join("\n"), refMap: outline.refMap };
}

// ----------------------------------------------------------------------------- few-shot examples

/** The page the examples are about (refs: b1 title, b2 paragraph, b3 diagram, b4 table, b5 heading, b6 list). */
export const COMMAND_DOC: LucidDoc = SAMPLE_DOC;

export interface CommandExample {
  utterance: string;
  /** Block the cursor is in. */
  cursor?: string;
  touched?: { blockId: string; note: string }[];
  answer: unknown;
}

const answer = (over: Record<string, unknown>) => ({
  kind: "edit",
  summary: null,
  ops: null,
  question: null,
  options: null,
  reason: null,
  ...over,
});

/** The refs of COMMAND_DOC: b1 title, b2 paragraph, b3 diagram, b4 table, b5 heading, b6 list (b6.1 PostgreSQL, b6.2 MongoDB, b6.3 DynamoDB). */
export const COMMAND_EXAMPLES: readonly CommandExample[] = [
  {
    utterance: "Add a CDN in front of the web server.",
    cursor: "d1",
    answer: answer({
      summary: "Added a CDN in front of the web server",
      ops: [
        {
          op: "graph.insert_between",
          target: "b3",
          from: "client",
          to: "web",
          node: "cdn [cdn]: CDN",
          labels: null,
        },
      ],
    }),
  },
  {
    utterance: "Add another row for consistency to this table.",
    cursor: "t1",
    answer: answer({
      summary: "Added a Consistency row",
      ops: [
        {
          op: "table.add_row",
          target: "b4",
          after: "end",
          cells: [
            "Consistency",
            "Strong (ACID transactions)",
            "Often eventual; tunable per database",
          ],
        },
      ],
    }),
  },
  {
    // One cell, addressed by its row and column ids: nothing else in the table is touched.
    utterance: "Under scaling, say that NoSQL scales horizontally by sharding.",
    cursor: "t1",
    answer: answer({
      summary: "Changed the NoSQL scaling cell to horizontal sharding",
      ops: [
        {
          op: "table.set_cells",
          target: "b4",
          row: "r3",
          cells: [{ col: "c3", text: "Horizontal, by sharding" }],
        },
      ],
    }),
  },
  {
    utterance:
      "Cross out PostgreSQL and MongoDB. We're choosing DynamoDB, but I want to remember the alternatives.",
    answer: answer({
      summary: "Crossed out PostgreSQL and MongoDB; marked DynamoDB as chosen",
      ops: [
        { op: "set_status", target: "b6.1", in: null, status: "struck" },
        { op: "set_status", target: "b6.2", in: null, status: "struck" },
        { op: "set_status", target: "b6.3", in: null, status: "chosen" },
      ],
    }),
  },
  {
    utterance: "Make the first sentence a heading.",
    cursor: "p1",
    answer: answer({
      summary: "Turned the first sentence into a heading",
      ops: [
        {
          op: "replace",
          target: "b2",
          lmd: "## Caching reduces database load\nRedis stores hot keys so most reads never reach PostgreSQL.",
        },
      ],
    }),
  },
  {
    utterance: "Remove the connection between Redis and the client.",
    cursor: "d1",
    answer: answer({
      kind: "clarify",
      question: "There is no direct Redis to Client connection. Did you mean one of these?",
      options: [
        { label: "Web Server to Redis (check cache)", ref: "e2" },
        { label: "Web Server to Client (JSON response)", ref: "e5" },
      ],
    }),
  },
  {
    // Words that are a note, not an instruction: a command is never invented out of content.
    utterance: "Then we expire entries after thirty days.",
    answer: answer({ kind: "none", reason: "content" }),
  },
];

export function buildCommandMessages(ctx: CommandContext): {
  messages: ChatMessage[];
  refMap: ReturnType<typeof buildOutline>["refMap"];
} {
  const messages: ChatMessage[] = [{ role: "system", content: commandSystemPrompt() }];
  // The examples are real (outline, hints, utterance) to answer turns: the model follows them more reliably than a list in
  // the system prompt, and they stay identical from request to request so the server can reuse its cache of them.
  for (const ex of COMMAND_EXAMPLES) {
    const user = commandUserMessage({
      doc: COMMAND_DOC,
      utterance: ex.utterance,
      cursorBlockId: ex.cursor,
      touched: ex.touched,
      title: "Example",
      // The examples stay as they were measured: the server reuses its work on them (see prefix.ts).
      collisions: false,
    });
    messages.push(
      { role: "user", content: user.text },
      { role: "assistant", content: JSON.stringify(ex.answer) },
    );
  }
  const { text, refMap } = commandUserMessage(ctx);
  messages.push({ role: "user", content: text });
  return { messages, refMap };
}
