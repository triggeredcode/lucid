import {
  coverage,
  diagramLabels,
  inventedNumbers,
  newId,
  plainTextOfBlocks,
  ungroundedTerms,
  type Block,
  type BlockPatch,
  type IdGenerator,
  type LucidDoc,
} from "@lucid/core";
import {
  completeAppendedRows,
  parseLmd,
  placeBlocks,
  PlacementError,
  type Placement,
} from "@lucid/kit";
import type { AiClient, ChatMessage, ChatResult } from "./provider";
import { DEFAULT_LANES, type Lane } from "./lanes";
import { buildInputMessages, type InputContext } from "./prompts/input";

export interface InputDeps {
  client: AiClient;
  lane?: Lane | undefined;
  signal?: AbortSignal | undefined;
  /** Streamed text, for the ghost preview. */
  onDelta?: ((text: string) => void) | undefined;
  ids?: IdGenerator | undefined;
}

export type InputJob = InputContext & {
  /** Terms the user told Lucid to expect (their vocabulary list); counted as spoken. */
  vocabulary?: readonly string[] | undefined;
};

interface Common {
  calls: ChatResult[];
  /** Raw text of the last model answer. */
  raw: string;
}

export type InputOutcome =
  /** The notes, as a patch to apply in one step. `warnings` are things the user may want to know (kept, but doubtful). */
  | (Common & {
      kind: "applied";
      patch: BlockPatch;
      blocks: Block[];
      repaired: boolean;
      warnings: string[];
    })
  /** The model thinks this was an instruction, not content. The caller asks the user. */
  | (Common & { kind: "command" })
  /** The model could not produce usable notes: the user's words go in unchanged, marked unprocessed. */
  | (Common & { kind: "unprocessed"; patch: BlockPatch; reason: string });

/** A paragraph holding the user's own words, so nothing they said is ever lost. */
export function unprocessedPatch(
  doc: LucidDoc,
  utterance: string,
  cursorBlockId?: string,
  ids: IdGenerator = newId,
): BlockPatch {
  const block: Block = {
    id: ids(),
    type: "paragraph",
    props: { unprocessed: true },
    content: [{ type: "text", text: utterance.trim(), styles: {} }],
  };
  const top = doc.blocks;
  const at = cursorBlockId
    ? top.findIndex(
        (b) => b.id === cursorBlockId || b.children?.some((c) => c.id === cursorBlockId),
      )
    : -1;
  const after = at >= 0 ? (top[at]?.id ?? null) : (top.at(-1)?.id ?? null);
  return { steps: [{ kind: "insert", parentId: null, afterId: after, blocks: [block] }] };
}

/** Models sometimes wrap the whole answer in a ```markdown fence. Only that wrapper is removed. */
export function cleanAnswer(raw: string): string {
  const text = raw.trim();
  const match = /^```(?:lmd|markdown|md|text|plain)\s*\n([\s\S]*?)\n```$/.exec(text);
  return (match?.[1] ?? text).trim();
}

interface Check {
  parsed?: { blocks: Block[]; placement: Placement } | undefined;
  command?: boolean;
  patch?: BlockPatch | undefined;
  /** Must be fixed: the answer cannot be used as it is. */
  hard: string[];
  /** Worth one repair round, but the answer is usable if it does not get better. */
  soft: string[];
}

const COVERAGE_MIN = 0.8;

function check(raw: string, job: InputJob, ids: IdGenerator | undefined): Check {
  const parsed = parseLmd(completeAppendedRows(cleanAnswer(raw), job.doc), ids ? { ids } : {});
  if (!parsed.ok) {
    return { hard: parsed.errors.map((e) => `line ${String(e.line)}: ${e.message}`), soft: [] };
  }
  if (parsed.command) return { command: true, hard: [], soft: [] };
  const hard: string[] = [];
  const soft: string[] = [];
  let patch: BlockPatch | undefined;
  try {
    patch = placeBlocks(job.doc, parsed.blocks, parsed.placement, {
      cursorBlockId: job.cursorBlockId,
      ids,
    });
  } catch (error) {
    if (error instanceof PlacementError) hard.push(error.message);
    else throw error;
  }
  const out = plainTextOfBlocks(parsed.blocks);
  const sources = [
    job.utterance,
    ...(job.recent ?? []).map((r) => r.text),
    plainTextOfBlocks(job.doc.blocks),
    ...(job.vocabulary ?? []),
  ];
  const invented = inventedNumbers(out, sources);
  if (invented.length > 0)
    hard.push(
      `These numbers are not in what the user said: ${invented.join(", ")}. Use only the user's numbers.`,
    );
  const labels = [...new Set(diagramLabels(parsed.blocks).map((l) => l.label))];
  const ungrounded = ungroundedTerms(labels, sources);
  if (ungrounded.length > 0)
    soft.push(
      `These diagram components were not mentioned by the user: ${ungrounded.join(", ")}. Remove them.`,
    );
  // A spoken formula ("two times layers times heads") becomes LaTeX, so its words cannot be found in the notes.
  const hasMath = parsed.blocks.some(
    (b) => b.type === "math" || b.content?.some((i) => i.type === "mathInline"),
  );
  const cov = hasMath ? { ratio: 1, missing: [] as string[] } : coverage(job.utterance, out);
  if (cov.ratio < COVERAGE_MIN && cov.missing.length > 0) {
    soft.push(
      `You dropped these words the user said: ${cov.missing.join(", ")}. Keep their meaning (stay terse).`,
    );
  }
  return { parsed, patch, hard, soft };
}

const repairMessage = (problems: string[]): ChatMessage => ({
  role: "user",
  content: `Your output had these problems:\n${problems.map((p) => `- ${p}`).join("\n")}\nReturn the corrected, complete notes and nothing else.`,
});

/**
 * Input Mode for one utterance: structure it as notes, check them against what was said, and either
 * give back a patch to apply or the user's own words as an unprocessed paragraph. At most one repair round.
 * LLM errors (LM Studio down, timeout, cancelled) are thrown for the caller to handle.
 */
export async function runInput(job: InputJob, deps: InputDeps): Promise<InputOutcome> {
  const lane = deps.lane ?? DEFAULT_LANES.input;
  const { messages } = buildInputMessages(job);
  const calls: ChatResult[] = [];
  const ask = async (): Promise<string> => {
    const result = await deps.client.chat({
      lane,
      messages,
      signal: deps.signal,
      onDelta: deps.onDelta,
    });
    calls.push(result);
    return result.content;
  };

  let raw = await ask();
  const first = check(raw, job, deps.ids);
  if (first.command) return { kind: "command", raw, calls };

  let repaired = false;
  let result = first;
  const problems = [...first.hard, ...first.soft];
  if (problems.length > 0) {
    repaired = true;
    messages.push({ role: "assistant", content: raw }, repairMessage(problems));
    raw = await ask();
    result = check(raw, job, deps.ids);
    if (result.command) return { kind: "command", raw, calls };
  }

  if (result.hard.length > 0 || !result.parsed || !result.patch) {
    return {
      kind: "unprocessed",
      patch: unprocessedPatch(job.doc, job.utterance, job.cursorBlockId, deps.ids),
      reason: result.hard.join(" ") || "The notes could not be read.",
      raw,
      calls,
    };
  }
  return {
    kind: "applied",
    patch: result.patch,
    blocks: result.parsed.blocks,
    repaired,
    warnings: result.soft,
    raw,
    calls,
  };
}
