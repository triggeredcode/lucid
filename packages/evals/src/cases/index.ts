import { getFormat } from "@lucid/kit";
import { CATEGORIES, FIXTURES, type Case } from "../types";
import { COMMAND_CASES } from "./command";
import { FORMAT_CASES } from "./formats";
import { INPUT_CASES } from "./input";

/** All cases. Add them to input.ts or command.ts (new categories get their own file listed here). */
export const ALL_CASES: Case[] = [...INPUT_CASES, ...COMMAND_CASES, ...FORMAT_CASES];

/** Problems with the case list itself (so a typo is found before a 20-minute run): empty means fine. */
export function validateCases(cases: readonly Case[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const c of cases) {
    if (seen.has(c.id)) problems.push(`duplicate case id ${c.id}`);
    seen.add(c.id);
    if (!CATEGORIES.includes(c.category)) problems.push(`${c.id}: unknown category ${c.category}`);
    if (!FIXTURES.includes(c.doc)) problems.push(`${c.id}: unknown fixture ${c.doc}`);
    if (c.utterance.trim().length === 0) problems.push(`${c.id}: empty utterance`);
    if (
      c.mode === "input" &&
      c.expect.outcome &&
      !["applied", "command"].includes(c.expect.outcome)
    )
      problems.push(`${c.id}: an input case cannot expect ${c.expect.outcome}`);
    if (
      c.mode === "command" &&
      c.expect.outcome &&
      ["applied", "command"].includes(c.expect.outcome)
    )
      problems.push(`${c.id}: a command case cannot expect ${c.expect.outcome}`);
    if (c.mode === "advisor" && (c.expect.outcome ?? "advice") !== "advice")
      problems.push(`${c.id}: an advisor case can only expect advice`);
    if (c.mode === "advisor" && !c.expect.formatId)
      problems.push(`${c.id}: an advisor case names the format it expects`);
    if (c.format && !getFormat(c.format)) problems.push(`${c.id}: unknown format ${c.format}`);
    if ((c.variants ?? []).some((v) => v.trim() === c.utterance.trim()))
      problems.push(`${c.id}: a variant repeats the utterance`);
  }
  return problems;
}
