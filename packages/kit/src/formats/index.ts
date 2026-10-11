import { newId, type Block } from "@lucid/core";
import { FormatSchema, type Format } from "./types";

export * from "./types";

/** The five note formats of version 1. More arrive the same way: one entry here, one test run. */
const RAW_FORMATS: Format[] = [
  {
    id: "concept-note",
    name: "Concept note",
    description:
      "One computer-science or system-design concept explained: definition, intuition, how it works, an example, pitfalls.",
    keywords: [
      "concept",
      "explain",
      "how does",
      "what is",
      "theory",
      "algorithm",
      "data structure",
      "definition",
      "intuition",
      "consistent hashing",
      "raft",
      "paxos",
      "b-tree",
      "cap theorem",
      "bloom filter",
    ],
    meta: ["source", "book", "chapter"],
    sections: [
      {
        key: "definition",
        heading: "Definition",
        hint: "What it is, in a sentence or two.",
        prefer: ["paragraph", "callout"],
      },
      {
        key: "intuition",
        heading: "Intuition",
        hint: "Why it works, in plain words.",
        prefer: ["paragraph", "bulletListItem"],
      },
      {
        key: "how-it-works",
        heading: "How it works",
        hint: "The mechanism, step by step.",
        prefer: ["diagram", "numberedListItem"],
      },
      {
        key: "example",
        heading: "Example",
        hint: "A small worked example.",
        prefer: ["paragraph", "table"],
      },
      {
        key: "pitfalls",
        heading: "Pitfalls and gotchas",
        hint: "What goes wrong in practice.",
        prefer: ["bulletListItem", "callout"],
      },
      {
        key: "related",
        heading: "Related concepts",
        hint: "Neighbouring ideas to read next.",
        prefer: ["bulletListItem"],
      },
    ],
    latex: { equationNumbers: false, diagramWidth: 0.85 },
  },
  {
    id: "system-design",
    name: "System design note",
    description:
      "Designing a system end to end (URL shortener, chat, feed): requirements, estimates, API, design, data model, trade-offs.",
    keywords: [
      "system design",
      "design a",
      "design of",
      "architecture",
      "requirements",
      "capacity",
      "qps",
      "url shortener",
      "high-level design",
      "api design",
      "scale to",
      "availability",
      "chat system",
      "news feed",
    ],
    meta: ["source", "date"],
    sections: [
      {
        key: "requirements",
        heading: "Requirements",
        hint: "Functional and non-functional requirements.",
        prefer: ["bulletListItem"],
      },
      {
        key: "capacity",
        heading: "Capacity estimates",
        hint: "Traffic, storage and bandwidth numbers.",
        prefer: ["table", "math"],
      },
      { key: "api", heading: "API", hint: "The calls clients make.", prefer: ["table", "code"] },
      {
        key: "high-level-design",
        heading: "High-level design",
        hint: "The main components and how they connect.",
        prefer: ["diagram"],
      },
      {
        key: "data-model",
        heading: "Data model",
        hint: "Tables, keys and relationships.",
        prefer: ["table", "diagram"],
      },
      {
        key: "deep-dives",
        heading: "Deep dives",
        hint: "The hard parts, one by one.",
        prefer: ["diagram", "paragraph"],
      },
      {
        key: "trade-offs",
        heading: "Trade-offs and decisions",
        hint: "What was chosen, what was given up.",
        prefer: ["callout", "bulletListItem"],
      },
      {
        key: "open-questions",
        heading: "Open questions",
        hint: "What is still unclear.",
        prefer: ["callout", "checkListItem"],
      },
    ],
    latex: { equationNumbers: false, diagramWidth: 1 },
  },
  {
    id: "comparison",
    name: "Comparison",
    description:
      "Choosing between technologies or approaches (SQL vs NoSQL, Kafka vs SQS): options, a comparison table, pros and cons, a decision.",
    keywords: [
      "vs",
      "versus",
      "compare",
      "comparison",
      "which one",
      "choose between",
      "trade-off",
      "tradeoff",
      "pros and cons",
      "difference between",
      "alternatives",
      "options",
    ],
    meta: ["source", "date"],
    sections: [
      {
        key: "context",
        heading: "Context",
        hint: "What is being decided and why.",
        prefer: ["paragraph"],
      },
      {
        key: "options",
        heading: "Options",
        hint: "The candidates; cross out what is dropped.",
        prefer: ["bulletListItem"],
      },
      {
        key: "comparison",
        heading: "Comparison",
        hint: "Properties down, options across.",
        prefer: ["table"],
      },
      {
        key: "pros-cons",
        heading: "Pros and cons",
        hint: "Strengths and weaknesses of each.",
        prefer: ["table", "bulletListItem"],
      },
      {
        key: "decision",
        heading: "Decision",
        hint: "What was chosen and why.",
        prefer: ["callout"],
      },
    ],
    latex: { equationNumbers: false, diagramWidth: 0.85 },
  },
  {
    id: "inference-math",
    name: "Inference engineering note",
    description:
      "Math-heavy inference topics: KV cache sizing, FLOPs, memory bandwidth, quantization, batching, speculative decoding.",
    keywords: [
      "kv cache",
      "kv",
      "flops",
      "memory bandwidth",
      "quantization",
      "quantisation",
      "batching",
      "speculative decoding",
      "paged attention",
      "attention",
      "roofline",
      "arithmetic intensity",
      "decode",
      "prefill",
    ],
    meta: ["source", "hardware"],
    sections: [
      {
        key: "intuition",
        heading: "Intuition",
        hint: "The idea before the math.",
        prefer: ["paragraph"],
      },
      {
        key: "the-math",
        heading: "The math",
        hint: "Formulas, each followed by what its symbols mean.",
        prefer: ["math", "bulletListItem"],
      },
      {
        key: "numbers",
        heading: "Numbers to remember",
        hint: "Typical values, with units.",
        prefer: ["table"],
      },
      {
        key: "hardware",
        heading: "Hardware implications",
        hint: "What the numbers mean for the machine.",
        prefer: ["bulletListItem", "diagram"],
      },
      { key: "pitfalls", heading: "Pitfalls", hint: "Easy mistakes.", prefer: ["callout"] },
    ],
    latex: { equationNumbers: true, diagramWidth: 0.85 },
  },
  {
    id: "benchmark",
    name: "Benchmark note",
    description:
      "Recording an experiment or benchmark (tokens per second across models, latency under load, write throughput): setup, method, results.",
    keywords: [
      "benchmark",
      "experiment",
      "measured",
      "tok/s",
      "tokens per second",
      "latency under load",
      "throughput test",
      "hypothesis",
      "p50",
      "p99",
      "results",
    ],
    meta: ["date", "hardware"],
    sections: [
      {
        key: "goal",
        heading: "Goal and hypothesis",
        hint: "What is being tested and what was expected.",
        prefer: ["paragraph"],
      },
      {
        key: "setup",
        heading: "Setup",
        hint: "Hardware, software, versions, parameters.",
        prefer: ["table"],
      },
      {
        key: "method",
        heading: "Method",
        hint: "What was done, in order.",
        prefer: ["numberedListItem"],
      },
      {
        key: "results",
        heading: "Results",
        hint: "The numbers as measured, nothing else.",
        prefer: ["table", "chart"],
      },
      {
        key: "observations",
        heading: "Observations",
        hint: "What the numbers show.",
        prefer: ["bulletListItem", "callout"],
      },
      {
        key: "next",
        heading: "Next experiments",
        hint: "What to try next.",
        prefer: ["checkListItem"],
      },
    ],
    latex: { equationNumbers: false, diagramWidth: 0.85 },
  },
];

/** Validated at load: a typo in a format is found the first time the package is used, and by its test. */
export const FORMATS: readonly Format[] = RAW_FORMATS.map((f) => FormatSchema.parse(f));

export const DEFAULT_FORMAT_ID = "concept-note";

export function getFormat(id: string | undefined): Format | undefined {
  return FORMATS.find((f) => f.id === id);
}

/** A new page of this format: one heading per section, ready to be filled (empty sections do not print). */
export function skeleton(format: Format, ids: () => string = newId): Block[] {
  return format.sections.map((s) => ({
    id: ids(),
    type: "heading",
    props: { level: 2 },
    content: [{ type: "text", text: s.heading, styles: {} }],
  }));
}

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export interface Pick {
  format: Format;
  /** 0 means nothing matched and the default was taken. */
  score: number;
}

/**
 * The deterministic way to choose a format from a description (the model's choice is tried first): keyword hits, where a
 * phrase counts double and a word of the format's own name triples. Ties and no match go to the default.
 */
export function pickFormat(description: string, formats: readonly Format[] = FORMATS): Pick {
  const text = description.toLowerCase();
  let best: Pick | undefined;
  for (const format of formats) {
    let score = 0;
    for (const keyword of format.keywords) {
      const k = escapeRegex(keyword.toLowerCase());
      // Short words ("vs", "kv", "qps") must stand alone; longer ones may be part of a longer word ("benchmarking").
      const pattern = keyword.length <= 3 ? `(^|[^a-z0-9])${k}($|[^a-z0-9])` : `(^|[^a-z0-9])${k}`;
      if (!new RegExp(pattern).test(text)) continue;
      const own = format.id
        .split("-")
        .some((w) => keyword.toLowerCase().startsWith(w) && w.length >= 5);
      score += own ? 3 : keyword.includes(" ") || keyword.includes("/") ? 2 : 1;
    }
    if (!best || score > best.score) best = { format, score };
  }
  const fallback = getFormat(DEFAULT_FORMAT_ID) ?? formats[0];
  if (!best || best.score === 0) return { format: fallback as Format, score: 0 };
  return best;
}
