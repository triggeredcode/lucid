import { FORMATS, pickFormat } from "@lucid/kit";
import type { ChatResult, LmStudioClient } from "./client";
import { DEFAULT_LANES, type Lane } from "./lanes";
import { advisorJsonSchema, buildAdvisorMessages } from "./prompts/advisor";

export interface AdvisorDeps {
  client: LmStudioClient;
  lane?: Lane | undefined;
  signal?: AbortSignal | undefined;
  /** Development/eval telemetry hook. It receives counts and timings, never credentials. */
  onResult?: ((result: ChatResult) => void) | undefined;
}

export interface Advice {
  formatId: string;
  /** A short page title in the person's words. */
  title: string;
  reason: string;
  /** Who chose: the model, or the keyword fallback when it could not. */
  source: "model" | "keywords";
  /** Why the model's answer was not used, in plain words. */
  fallbackBecause?: string;
}

interface Answer {
  formatId: string;
  title: string;
  reason: string;
}

function readAnswer(text: string): Answer | undefined {
  try {
    const v = JSON.parse(text) as Record<string, unknown>;
    return typeof v["formatId"] === "string" &&
      typeof v["title"] === "string" &&
      typeof v["reason"] === "string"
      ? { formatId: v["formatId"], title: v["title"], reason: v["reason"] }
      : undefined;
  } catch {
    return undefined;
  }
}

/** The first words of what was said, as a title, when the model gave none. */
export function titleFrom(description: string): string {
  const words = description
    .trim()
    .replace(/[.!?]+$/, "")
    .split(/\s+/)
    .slice(0, 8)
    .join(" ");
  return words.length > 0 ? words.charAt(0).toUpperCase() + words.slice(1) : "Untitled";
}

/**
 * Which note format suits this description. Never throws: when the model cannot be reached or does not give a usable
 * answer, the keyword picker chooses, and `fallbackBecause` says why (starting a page must not wait on the model).
 */
export async function runAdvisor(description: string, deps: AdvisorDeps): Promise<Advice> {
  const fallback = (because: string): Advice => {
    const pick = pickFormat(description);
    return {
      formatId: pick.format.id,
      title: titleFrom(description),
      reason:
        pick.score > 0
          ? `Matches words like “${pick.format.keywords[0] ?? ""}”.`
          : "No clear match; this is the general one.",
      source: "keywords",
      fallbackBecause: because,
    };
  };
  if (description.trim().length === 0) return fallback("nothing was said");
  try {
    const result = await deps.client.chat({
      lane: deps.lane ?? DEFAULT_LANES.advisor,
      messages: buildAdvisorMessages(description),
      jsonSchema: { name: "lucid_format", schema: advisorJsonSchema() },
      signal: deps.signal,
    });
    deps.onResult?.(result);
    const answer = readAnswer(result.content);
    if (!answer) return fallback("the answer was not in the expected shape");
    if (!FORMATS.some((f) => f.id === answer.formatId))
      return fallback(`the model named a format that does not exist (${answer.formatId})`);
    return {
      formatId: answer.formatId,
      title: answer.title.trim() || titleFrom(description),
      reason: answer.reason.trim(),
      source: "model",
    };
  } catch (error) {
    if (deps.signal?.aborted) throw error;
    return fallback(error instanceof Error ? error.message : "the model could not be asked");
  }
}
