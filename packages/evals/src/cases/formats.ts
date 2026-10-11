import type { Case } from "../types";

/**
 * Note formats: picking the format that suits what the person wants to write about, and putting
 * dictation into the section of a format page where it belongs.
 */
export const FORMAT_CASES: Case[] = [
  // ------------------------------------------------------------------------------------ format_pick
  {
    id: "pick-paged-attention",
    category: "format_pick",
    mode: "advisor",
    doc: "empty",
    utterance: "notes on how paged attention saves KV cache memory",
    expect: { formatId: "inference-math" },
  },
  {
    id: "pick-benchmark-qwen-gemma",
    category: "format_pick",
    mode: "advisor",
    doc: "empty",
    utterance: "benchmarking qwen versus gemma tokens per second on my mac",
    variants: ["I want to record a benchmark of qwen and gemma tok/s on my mac"],
    expect: { formatId: "benchmark" },
  },
  {
    id: "pick-url-shortener",
    category: "format_pick",
    mode: "advisor",
    doc: "empty",
    utterance: "design a URL shortener",
    variants: ["how would I design a url shortener that handles a billion links"],
    expect: { formatId: "system-design" },
  },
  {
    id: "pick-sql-nosql",
    category: "format_pick",
    mode: "advisor",
    doc: "empty",
    utterance: "SQL versus NoSQL for storing sessions",
    expect: { formatId: "comparison" },
  },
  {
    id: "pick-consistent-hashing",
    category: "format_pick",
    mode: "advisor",
    doc: "empty",
    utterance: "consistent hashing",
    variants: ["explain how consistent hashing works"],
    expect: { formatId: "concept-note" },
  },
  {
    id: "pick-raft",
    category: "format_pick",
    mode: "advisor",
    doc: "empty",
    utterance: "how does Raft elect a leader",
    expect: { formatId: "concept-note" },
  },
  {
    id: "pick-kafka-sqs",
    category: "format_pick",
    mode: "advisor",
    doc: "empty",
    utterance: "choosing between Kafka and SQS for our event pipeline",
    expect: { formatId: "comparison" },
  },
  {
    id: "pick-speculative-decoding",
    category: "format_pick",
    mode: "advisor",
    doc: "empty",
    utterance: "the math of speculative decoding speedups",
    expect: { formatId: "inference-math" },
  },
  {
    id: "pick-latency-under-load",
    category: "format_pick",
    mode: "advisor",
    doc: "empty",
    utterance: "measuring p99 latency of the write path under load with different batch sizes",
    expect: { formatId: "benchmark" },
  },
  {
    id: "pick-chat-system",
    category: "format_pick",
    mode: "advisor",
    doc: "empty",
    utterance: "designing a chat system with presence and read receipts",
    expect: { formatId: "system-design" },
  },
  {
    id: "pick-nothing-clear",
    category: "format_pick",
    mode: "advisor",
    doc: "empty",
    why: "No clear fit: the general concept note, never something invented.",
    utterance: "my thoughts on learning to learn",
    expect: { formatId: "concept-note" },
  },

  // ------------------------------------------------------------------------------------ format_placement
  {
    id: "section-options",
    category: "format_placement",
    mode: "input",
    doc: "format-comparison",
    format: "comparison",
    why: 'On a comparison page, "the options are ..." goes under Options, not at the end of the page.',
    utterance: "The options we are looking at are Kafka and SQS.",
    expect: {
      doc: { underHeading: [{ heading: "Options", contains: ["kafka", "sqs"] }] },
    },
  },
  {
    id: "section-decision",
    category: "format_placement",
    mode: "input",
    doc: "format-comparison",
    format: "comparison",
    utterance: "We decided to go with SQS because we do not want to run brokers.",
    expect: {
      doc: { underHeading: [{ heading: "Decision", contains: ["sqs"] }] },
    },
  },
  {
    id: "section-setup",
    category: "format_placement",
    mode: "input",
    doc: "format-benchmark",
    format: "benchmark",
    utterance: "The setup was an M4 Max with 48 gigabytes, LM Studio and the Qwen 27B model.",
    expect: {
      doc: { underHeading: [{ heading: "Setup", contains: ["m4 max", "qwen"] }] },
    },
  },
  {
    id: "section-observations",
    category: "format_placement",
    mode: "input",
    doc: "format-benchmark",
    format: "benchmark",
    utterance: "What I noticed is that prefill is much faster than decode.",
    expect: {
      doc: { underHeading: [{ heading: "Observations", contains: ["prefill", "decode"] }] },
    },
  },
];
