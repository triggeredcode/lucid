import {
  commandJsonSchema,
  destructiveOps,
  diagramLabels,
  inventedNumbers,
  needsConfirmation,
  parseCommandResponse,
  plainTextOfBlocks,
  ungroundedTerms,
  type BlockPatch,
  type Destructive,
  type IdGenerator,
  type LucidDoc,
  type Op,
} from "@lucid/core";
import { compileOps, OpError } from "@lucid/kit";
import type { AiClient, ChatMessage, ChatResult } from "./provider";
import { DEFAULT_LANES, type Lane } from "./lanes";
import { buildCommandMessages, endsWithAnswer, type CommandContext } from "./prompts/command";

export interface CommandDeps {
  client: AiClient;
  lane?: Lane | undefined;
  signal?: AbortSignal | undefined;
  onDelta?: ((text: string) => void) | undefined;
  ids?: IdGenerator | undefined;
}

export type CommandJob = CommandContext & { vocabulary?: readonly string[] | undefined };

interface Common {
  calls: ChatResult[];
  raw: string;
}

interface Change {
  summary: string;
  ops: Op[];
  patch: BlockPatch;
  next: LucidDoc;
  affected: string[];
  warnings: string[];
  repaired: boolean;
}

export type CommandOutcome =
  /** The selected provider cannot safely produce checked Command operations. No request was sent. */
  | { kind: "unavailable"; message: string; calls: []; raw: "" }
  /** A change, ready to apply. */
  | (Common & Change & { kind: "edit" })
  /** A change that throws something away without the user having said so: show it and wait for a yes. */
  | (Common & Change & { kind: "proposal"; destructive: Destructive[] })
  /** The model needs to know which one. */
  | (Common & {
      kind: "clarify";
      question: string;
      options: { label: string; ref: string | null }[];
    })
  /** Nothing to do. `content` means the words were notes, not an instruction. */
  | (Common & { kind: "none"; reason: string; content: boolean })
  /** The model could not produce a usable change, even after one repair. */
  | (Common & { kind: "failed"; message: string });

const repairMessage = (problems: string[]): ChatMessage => ({
  role: "user",
  content: `Your answer had these problems:\n${problems.map((p) => `- ${p}`).join("\n")}\nReturn the corrected, complete JSON object and nothing else.`,
});

const promptedSchemaMessage = (schema: { name: string; schema: object }): ChatMessage => ({
  role: "user",
  content: [
    "STRUCTURED OUTPUT CONTRACT:",
    "Return exactly one JSON object and no prose or markdown.",
    "It must satisfy this JSON Schema. Lucid will reject the response before making any change if it does not.",
    JSON.stringify(schema.schema),
  ].join("\n"),
});

/**
 * Command Mode for one utterance: ask the model for ops, compile them on a copy of the document, and
 * report an edit, a proposal (destructive without a removal word), a question, or "nothing to do". At most one
 * repair round. LM Studio errors are thrown for the caller.
 */
export async function runCommand(job: CommandJob, deps: CommandDeps): Promise<CommandOutcome> {
  const lane = deps.lane ?? DEFAULT_LANES.command;
  const { messages, refMap } = buildCommandMessages(job);
  const calls: ChatResult[] = [];
  // Once the person has answered a question, the model must act: "clarify" is not an answer it can give.
  const schema = {
    name: "lucid_command",
    schema: commandJsonSchema({ allowClarify: !endsWithAnswer(job.utterance) }),
  };
  const structuredOutput = deps.client.capabilities.structuredOutput;
  if (structuredOutput === "unavailable") {
    return {
      kind: "unavailable",
      message: `${deps.client.provider} cannot safely produce structured Command operations. Choose a provider with structured output support. No edit was applied.`,
      calls: [],
      raw: "",
    };
  }
  if (structuredOutput === "prompted") messages.push(promptedSchemaMessage(schema));
  const ask = async (): Promise<string> => {
    const result = await deps.client.chat({
      lane,
      messages,
      jsonSchema: structuredOutput === "native" ? schema : undefined,
      signal: deps.signal,
      onDelta: deps.onDelta,
    });
    calls.push(result);
    return result.content;
  };

  const sources = [
    job.utterance,
    ...(job.recent ?? []).map((r) => r.text),
    plainTextOfBlocks(job.doc.blocks),
    ...(job.vocabulary ?? []),
  ];
  const textOf = (ref: string): string | undefined => {
    const r = refMap.resolve(ref);
    if (!r) return undefined;
    const ids = r.kind === "list" ? r.ids : [r.id];
    const found = job.doc.blocks.filter((b) => ids.includes(b.id));
    return found.length > 0 ? plainTextOfBlocks(found) : undefined;
  };

  let raw = await ask();
  for (let attempt = 0; ; attempt++) {
    const common = { calls, raw };
    const problems: string[] = [];
    const parsed = parseCommandResponse(raw);
    if (!parsed.ok) problems.push(...parsed.errors);
    else if (parsed.value.kind === "none") {
      return {
        kind: "none",
        reason: parsed.value.reason,
        content: /content|note/i.test(parsed.value.reason),
        ...common,
      };
    } else if (parsed.value.kind === "clarify") {
      return {
        kind: "clarify",
        question: parsed.value.question,
        options: parsed.value.options,
        ...common,
      };
    } else {
      const { ops, summary } = parsed.value;
      try {
        const compiled = compileOps(job.doc, ops, { ids: deps.ids });
        if (compiled.patch.steps.length === 0) {
          return {
            kind: "none",
            reason: "That would not change anything.",
            content: false,
            ...common,
          };
        }
        const warnings: string[] = [];
        const soft: string[] = [];
        const before = new Set(diagramLabels(job.doc.blocks).map((l) => l.label));
        const added = [...new Set(diagramLabels(compiled.next.blocks).map((l) => l.label))].filter(
          (l) => !before.has(l),
        );
        const ungrounded = ungroundedTerms(added, sources);
        if (ungrounded.length > 0)
          soft.push(
            `These diagram components were not mentioned by the user: ${ungrounded.join(", ")}. Leave them out.`,
          );
        const touched = compiled.patch.steps.flatMap((s) =>
          s.kind === "insert" ? s.blocks : s.kind === "update" ? [s.block] : [],
        );
        const invented = inventedNumbers(plainTextOfBlocks(touched), sources);
        if (invented.length > 0)
          warnings.push(`Numbers the user did not say: ${invented.join(", ")}.`);
        if (soft.length > 0 && attempt === 0) problems.push(...soft);
        else {
          warnings.push(...soft);
          const change: Change = {
            summary,
            ops,
            patch: compiled.patch,
            next: compiled.next,
            affected: compiled.affected,
            warnings: [...compiled.warnings, ...warnings],
            repaired: attempt > 0,
          };
          const destructive = destructiveOps(ops, { textOf });
          if (needsConfirmation(job.utterance, destructive))
            return { kind: "proposal", destructive, ...change, ...common };
          return { kind: "edit", ...change, ...common };
        }
      } catch (error) {
        if (error instanceof OpError) problems.push(error.message);
        else throw error;
      }
    }
    if (attempt > 0) return { kind: "failed", message: problems.join(" "), ...common };
    messages.push({ role: "assistant", content: raw }, repairMessage(problems));
    raw = await ask();
  }
}
