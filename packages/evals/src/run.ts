import { applyPatch, patchedIds, type LucidDoc } from "@lucid/core";
import {
  DEFAULT_LANES,
  runAdvisor,
  runCommand,
  runInput,
  type ChatResult,
  type Lane,
  type AiClient,
} from "@lucid/llm";
import { fixture } from "./fixtures";
import { evaluate, findBlock, unrelatedChangedCount, type Observed } from "./matchers";
import type { Case } from "./types";

export interface Trial {
  caseId: string;
  category: Case["category"];
  /** 0 is the case's own utterance, 1.. its variants. */
  variant: number;
  utterance: string;
  pass: boolean;
  failures: string[];
  /** What the pipeline came to (applied, command, unprocessed, edit, proposal, clarify, none, failed, error). */
  outcome: string;
  lane: Case["mode"];
  cancelled: boolean;
  ms: number;
  firstTokenMs: number | null;
  promptTokens: number;
  outputTokens: number;
  tokenSource: "provider" | "estimated" | "none";
  requestChars: number;
  responseChars: number;
  modelCalls: number;
  repairCalls: number;
  affectedBlocks: number;
  unrelatedBlocksModified: number | null;
  provider: string;
  model: string;
  /** The model's last answer, as it wrote it. */
  raw: string;
  /** What Lucid said it did, for a change. */
  summary?: string | undefined;
  error?: string | undefined;
}

export interface RunDeps {
  client: AiClient;
  lanes?: { input: Lane; command: Lane; advisor?: Lane } | undefined;
}

const sum = (calls: readonly ChatResult[], pick: (c: ChatResult) => number): number =>
  calls.reduce((n, c) => n + pick(c), 0);

/** One utterance of one case against the model: the pipeline runs as in the app, the page is changed, the matchers judge. */
export async function runTrial(
  c: Case,
  utterance: string,
  variant: number,
  deps: RunDeps,
): Promise<Trial> {
  const before: LucidDoc = fixture(c.doc);
  const cursorBlockId = c.focus ? findBlock(before, c.focus)?.id : undefined;
  const touched = (c.touched ?? []).flatMap((sel) => {
    const found = findBlock(before, sel);
    return found ? [{ blockId: found.id, note: "added a note" }] : [];
  });
  const base = { caseId: c.id, category: c.category, variant, utterance, lane: c.mode };
  const started = Date.now();
  try {
    let observed: Observed;
    let calls: ChatResult[] = [];
    let raw = "";
    let summary: string | undefined;
    let affectedBlocks = 0;
    if (c.mode === "advisor") {
      const advice = await runAdvisor(utterance, {
        client: deps.client,
        lane: deps.lanes?.advisor ?? DEFAULT_LANES.advisor,
        onResult: (result) => calls.push(result),
      });
      raw = JSON.stringify(advice);
      observed = { before, after: before, outcome: "advice", utterance, formatId: advice.formatId };
    } else if (c.mode === "input") {
      const out = await runInput(
        {
          doc: before,
          utterance,
          cursorBlockId,
          title: "Notes",
          recent: c.recent,
          format: c.format,
        },
        { client: deps.client, lane: deps.lanes?.input ?? DEFAULT_LANES.input },
      );
      calls = out.calls;
      raw = out.raw;
      const after = out.kind === "applied" ? applyPatch(before, out.patch) : before;
      if (out.kind === "applied") affectedBlocks = patchedIds(out.patch).length;
      observed = { before, after, outcome: out.kind, utterance };
    } else {
      const out = await runCommand(
        {
          doc: before,
          utterance,
          cursorBlockId,
          title: "Notes",
          recent: c.recent,
          touched,
          format: c.format,
        },
        { client: deps.client, lane: deps.lanes?.command ?? DEFAULT_LANES.command },
      );
      calls = out.calls;
      raw = out.raw;
      const after = out.kind === "edit" || out.kind === "proposal" ? out.next : before;
      if (out.kind === "edit" || out.kind === "proposal") summary = out.summary;
      if (out.kind === "edit" || out.kind === "proposal") affectedBlocks = out.affected.length;
      observed = {
        before,
        after,
        outcome: out.kind,
        utterance,
        ...(out.kind === "clarify" ? { clarifyOptions: out.options.length } : {}),
        ...(out.kind === "none" ? { noneIsContent: out.content } : {}),
      };
    }
    const outputTokens = sum(calls, (x) => x.usage.completion);
    const failures = evaluate(c.mode, c.expect, { ...observed, outputTokens });
    const firstCall = calls[0];
    const firstTokenMs = firstCall?.timings.firstTokenAt;
    return {
      ...base,
      pass: failures.length === 0,
      failures,
      outcome: observed.outcome,
      cancelled: false,
      ms: Date.now() - started,
      firstTokenMs:
        firstCall && firstTokenMs !== null && firstTokenMs !== undefined
          ? firstTokenMs - firstCall.timings.sentAt
          : null,
      promptTokens: sum(calls, (x) => x.usage.prompt),
      outputTokens,
      tokenSource:
        calls.length === 0
          ? "none"
          : calls.every((call) => call.usage.source === "provider")
            ? "provider"
            : "estimated",
      requestChars: sum(calls, (x) => x.characters.request),
      responseChars: sum(calls, (x) => x.characters.response),
      modelCalls: calls.length,
      repairCalls: Math.max(0, calls.length - 1) + sum(calls, (call) => call.repairAttempts),
      affectedBlocks,
      unrelatedBlocksModified: c.expect.touchedOnly
        ? unrelatedChangedCount(observed, c.expect.touchedOnly)
        : null,
      provider: calls.at(-1)?.provider ?? "none",
      model: calls.at(-1)?.model ?? "none",
      raw,
      summary,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ...base,
      pass: false,
      failures: [`the pipeline failed: ${message}`],
      outcome: "error",
      cancelled:
        error instanceof Error &&
        "code" in error &&
        (error as { code?: unknown }).code === "Aborted",
      ms: Date.now() - started,
      firstTokenMs: null,
      promptTokens: 0,
      outputTokens: 0,
      tokenSource: "none",
      requestChars: 0,
      responseChars: 0,
      modelCalls: 0,
      repairCalls: 0,
      affectedBlocks: 0,
      unrelatedBlocksModified: null,
      provider: "none",
      model: "none",
      raw: "",
      error: message,
    };
  }
}

/** Every trial of a case: its utterance, then each variant. */
export function trialsOf(c: Case, withVariants = true): { variant: number; utterance: string }[] {
  const all = [c.utterance, ...(withVariants ? (c.variants ?? []) : [])];
  return all.map((utterance, variant) => ({ variant, utterance }));
}
