import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DEFAULT_LANES, LmStudioClient } from "@lucid/llm";
import { ALL_CASES, validateCases } from "./cases";
import { comparisonToMarkdown, summarise, toMarkdown, type Results } from "./report";
import { runTrial, trialsOf, type Trial } from "./run";
import type { Case } from "./types";

/**
 * `pnpm eval`: runs the cases against the model in LM Studio, one request at a time, and writes a report.
 *   pnpm eval [--category a,b] [--id x,y] [--mode input|command] [--no-variants] [--label name]
 *             [--model key] [--url http://127.0.0.1:1234] [--out dir] [--strict]
 *   pnpm eval --compare <reportDirA> <reportDirB>
 */
function arg(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}
const flag = (args: string[], name: string): boolean => args.includes(`--${name}`);
const list = (v: string | undefined): string[] | undefined =>
  v === undefined
    ? undefined
    : v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

export function select(cases: readonly Case[], args: string[]): Case[] {
  const categories = list(arg(args, "category"));
  const ids = list(arg(args, "id"));
  const mode = arg(args, "mode");
  return cases.filter(
    (c) =>
      (!categories || categories.includes(c.category)) &&
      (!ids || ids.includes(c.id)) &&
      (!mode || c.mode === mode),
  );
}

const readResults = (dir: string): Results =>
  JSON.parse(readFileSync(join(dir, "results.json"), "utf8")) as Results;

export interface MainOptions {
  cwd?: string;
  /** The cases to choose from (default: all of them). */
  cases?: readonly Case[];
}

export async function main(args: string[], options: MainOptions = {}): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const all = options.cases ?? ALL_CASES;
  const compareAt = args.indexOf("--compare");
  if (compareAt >= 0) {
    const [a, b] = [args[compareAt + 1], args[compareAt + 2]];
    if (!a || !b) {
      console.error("Usage: pnpm eval --compare <reportDirA> <reportDirB>");
      return 2;
    }
    console.log(comparisonToMarkdown(readResults(resolve(cwd, a)), readResults(resolve(cwd, b))));
    return 0;
  }

  const problems = validateCases(all);
  if (problems.length > 0) {
    console.error(`The case list has problems:\n${problems.map((p) => `- ${p}`).join("\n")}`);
    return 2;
  }
  const cases = select(all, args);
  if (cases.length === 0) {
    console.error("No case matches those options.");
    return 2;
  }
  const baseUrl = arg(args, "url") ?? process.env["LMSTUDIO_URL"] ?? "http://127.0.0.1:1234";
  const model = arg(args, "model") ?? DEFAULT_LANES.input.model;
  const client = new LmStudioClient({ baseUrl });
  const health = await client.health();
  if (!health.reachable || !health.models.includes(model)) {
    console.error(
      !health.reachable
        ? `LM Studio is not reachable at ${baseUrl}.`
        : `${model} is not loaded in LM Studio (loaded: ${health.models.join(", ") || "nothing"}). Load it with: lms load ${model} --context-length 32768 --parallel 1 -y`,
    );
    return 2;
  }
  const lanes = {
    input: { ...DEFAULT_LANES.input, model },
    command: { ...DEFAULT_LANES.command, model },
    advisor: { ...DEFAULT_LANES.advisor, model },
  };

  const withVariants = !flag(args, "no-variants");
  const plan = cases.flatMap((c) => trialsOf(c, withVariants).map((t) => ({ c, ...t })));
  const trials: Trial[] = [];
  for (const [i, { c, variant, utterance }] of plan.entries()) {
    const t = await runTrial(c, utterance, variant, { client, lanes });
    trials.push(t);
    console.log(
      `[${String(i + 1)}/${String(plan.length)}] ${t.pass ? "PASS" : "FAIL"} ${c.category}/${c.id}${variant > 0 ? `#${String(variant)}` : ""} ${(t.ms / 1000).toFixed(1)}s · ${String(t.promptTokens)}→${String(t.outputTokens)} tok${t.tokenSource === "estimated" ? " est." : ""} · ${String(t.repairCalls)} repair${t.repairCalls === 1 ? "" : "s"}${t.pass ? "" : `  ${t.failures[0] ?? ""}`}`,
    );
  }

  const date = new Date().toISOString();
  const label = arg(args, "label") ?? "run";
  const results: Results = { meta: { model, date, label, baseUrl }, trials };
  // The folder is named by the local day, which is the day the person ran it.
  const day = new Date().toLocaleDateString("en-CA");
  const out = arg(args, "out") ?? join(cwd, "packages/evals/reports", `${day}-${label}`);
  mkdirSync(dirname(join(out, "x")), { recursive: true });
  writeFileSync(join(out, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
  writeFileSync(join(out, "report.md"), toMarkdown(results));
  const s = summarise(results);
  console.log(
    `\nOverall ${(s.overall.rate * 100).toFixed(0)}% (${String(s.overall.pass)}/${String(s.overall.total)}), ${s.overall.ok ? "meets" : "BELOW"} the 90% bar. Report: ${out}`,
  );
  return flag(args, "strict") && (!s.overall.ok || s.categories.some((c) => !c.ok)) ? 1 : 0;
}
