import { contentWords } from "../grounding/words";
import type { Op } from "./schema";

/** Words that mean "really remove it". "Cross out", "strike" and "discard" are not here: they only mark. */
const REMOVAL_VERBS = /\b(delete|remove|get rid of|drop|erase|take out|wipe|clear out)\b/i;

export const hasRemovalVerb = (utterance: string): boolean => REMOVAL_VERBS.test(utterance);

export interface Destructive {
  index: number;
  op: Op;
  reason: string;
}

export interface ClassifyContext {
  /** Plain text of the block (or list) a reference points at, so a rewrite can be compared with what it replaces. */
  textOf(ref: string): string | undefined;
}

/** Share of the old words that the new text still has. */
function kept(oldText: string, newText: string): number {
  const old = contentWords(oldText);
  if (old.length === 0) return 1;
  const now = new Set(contentWords(newText));
  return old.filter((w) => now.has(w)).length / old.length;
}

const KEEP_AT_LEAST = 0.6;

/** The ops that throw something away: removals, and rewrites that keep under 60% of what they replace. */
export function destructiveOps(ops: readonly Op[], ctx: ClassifyContext): Destructive[] {
  const out: Destructive[] = [];
  ops.forEach((op, index) => {
    switch (op.op) {
      case "delete":
        out.push({ index, op, reason: `delete ${op.target}` });
        break;
      case "graph.remove":
        out.push({
          index,
          op,
          reason: `remove ${[...op.nodes, ...op.edges].join(", ") || "parts"} from the diagram`,
        });
        break;
      case "table.remove_row":
        out.push({ index, op, reason: `remove row ${op.row}` });
        break;
      case "table.remove_column":
        out.push({ index, op, reason: `remove column ${op.col}` });
        break;
      case "replace": {
        const old = ctx.textOf(op.target);
        if (old !== undefined && kept(old, op.lmd) < KEEP_AT_LEAST)
          out.push({ index, op, reason: `rewrite ${op.target}, losing most of its words` });
        break;
      }
      case "convert": {
        const old = op.targets.map((t) => ctx.textOf(t) ?? "").join("\n");
        if (old.length > 0 && kept(old, op.lmd) < KEEP_AT_LEAST)
          out.push({
            index,
            op,
            reason: `convert ${op.targets.join(", ")}, losing most of its words`,
          });
        break;
      }
      default:
        break;
    }
  });
  return out;
}

/**
 * Whether the user must confirm before the change is applied: something is destructive and they did not
 * explicitly ask for a removal ("delete", "remove", ...).
 */
export function needsConfirmation(utterance: string, destructive: readonly Destructive[]): boolean {
  return destructive.length > 0 && !hasRemovalVerb(utterance);
}
