import type { Case } from "../types";

/**
 * Note formats: picking the format that suits what the person wants to write about, and putting
 * dictation into the section of a format page where it belongs.
 */
export const FORMAT_CASES: Case[] = [
  // ------------------------------------------------------------------------------------ format_pick
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
    id: "pick-bloom-filter",
    category: "format_pick",
    mode: "advisor",
    doc: "empty",
    utterance: "notes on how a bloom filter avoids disk reads",
    variants: ["what is a bloom filter and when does it go wrong"],
    expect: { formatId: "concept-note" },
  },
  {
    id: "pick-mutex-semaphore",
    category: "format_pick",
    mode: "advisor",
    doc: "empty",
    utterance: "the difference between a mutex and a semaphore",
    expect: { formatId: "comparison" },
  },
  {
    id: "pick-news-feed",
    category: "format_pick",
    mode: "advisor",
    doc: "empty",
    utterance: "how to design the news feed of a social app",
    expect: { formatId: "system-design" },
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
    id: "section-requirements",
    category: "format_placement",
    mode: "input",
    doc: "format-system-design",
    format: "system-design",
    why: 'On a system design page, "it must ..." goes under Requirements.',
    utterance:
      "It must create a short link, redirect fast, and handle a hundred million new links a month.",
    expect: {
      doc: { underHeading: [{ heading: "Requirements", contains: ["short link", "redirect"] }] },
    },
  },
  {
    id: "section-trade-offs",
    category: "format_placement",
    mode: "input",
    doc: "format-system-design",
    format: "system-design",
    utterance: "We chose a counter for the ids and gave up unguessable codes to avoid collisions.",
    expect: {
      doc: { underHeading: [{ heading: "Trade-offs and decisions", contains: ["counter"] }] },
    },
  },
];
