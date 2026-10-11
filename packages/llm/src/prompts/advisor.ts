import { FORMATS, META_LABEL } from "@lucid/kit";
import type { ChatMessage } from "../client";

/**
 * The advisor lane: which of the note formats suits what the person wants to write about. One choice from a short list,
 * answered as strict JSON, which a small model does reliably.
 */
export function advisorSystemPrompt(): string {
  const formats = FORMATS.map((f) => `- ${f.id}: ${f.name}. ${f.description}`).join("\n");
  return `You choose the best note format for what the user wants to write about. Answer with ONE JSON object: {"formatId", "title", "reason"}.

Formats:
${formats}

Rules:
1. formatId is exactly one of the ids above. If nothing fits well, choose concept-note.
2. title is a short title for the page (at most 8 words), in the user's own words, without quotes or a trailing full stop.
3. reason is one short sentence on why this format fits.`;
}

export interface AdvisorExample {
  description: string;
  answer: { formatId: string; title: string; reason: string };
}

export const ADVISOR_EXAMPLES: readonly AdvisorExample[] = [
  {
    description: "notes on how paged attention saves KV cache memory",
    answer: {
      formatId: "inference-math",
      title: "Paged attention and KV cache memory",
      reason: "It is about memory sizing in LLM inference.",
    },
  },
  {
    description: "benchmarking qwen versus gemma tokens per second on my mac",
    answer: {
      formatId: "benchmark",
      title: "Qwen vs Gemma tokens per second on my Mac",
      reason: "It records a measured experiment.",
    },
  },
  {
    description: "how should I design a chat system for a million users",
    answer: {
      formatId: "system-design",
      title: "Designing a chat system",
      reason: "It designs a whole system from requirements to trade-offs.",
    },
  },
];

export function advisorJsonSchema(): object {
  return {
    type: "object",
    additionalProperties: false,
    required: ["formatId", "title", "reason"],
    properties: {
      formatId: { type: "string", enum: FORMATS.map((f) => f.id) },
      title: { type: "string", maxLength: 80 },
      reason: { type: "string", maxLength: 160 },
    },
  };
}

export function buildAdvisorMessages(description: string): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: "system", content: advisorSystemPrompt() }];
  for (const ex of ADVISOR_EXAMPLES) {
    messages.push(
      { role: "user", content: `DESCRIPTION:\n${ex.description}` },
      { role: "assistant", content: JSON.stringify(ex.answer) },
    );
  }
  messages.push({ role: "user", content: `DESCRIPTION:\n${description.trim()}` });
  return messages;
}

/** The fields a format shows under the title, as words ("Source, Hardware"), for the picker in the app. */
export const metaLabels = (fields: readonly (keyof typeof META_LABEL)[]): string =>
  fields.map((f) => META_LABEL[f]).join(", ");
