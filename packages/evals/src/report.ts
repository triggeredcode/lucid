import {
  CATEGORIES,
  CATEGORY_THRESHOLD,
  DEFAULT_CATEGORY_THRESHOLD,
  OVERALL_THRESHOLD,
  type Category,
} from "./types";
import type { Trial } from "./run";

export interface RunMeta {
  model: string;
  date: string;
  /** Names the prompt version or experiment, for comparing runs. */
  label: string;
  baseUrl: string;
}

export interface Results {
  meta: RunMeta;
  trials: Trial[];
}

export interface Rate {
  pass: number;
  total: number;
  rate: number;
}

const rate = (pass: number, total: number): Rate => ({
  pass,
  total,
  rate: total === 0 ? 0 : pass / total,
});

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)] ?? 0;
};

export interface Summary {
  overall: Rate & { ok: boolean };
  categories: (Rate & { category: Category; threshold: number; ok: boolean; p50Ms: number })[];
  /** Trials where the pipeline itself failed (the model could not be reached, bad JSON after repair...). */
  errors: number;
  cancellations: number;
  p50Ms: number;
  p50FirstTokenMs: number;
  promptTokens: number;
  outputTokens: number;
  estimatedTokenTrials: number;
  modelCalls: number;
  repairCalls: number;
  affectedBlocks: number;
  unrelatedBlocksModified: number;
}

export function summarise(results: Results): Summary {
  const trials = results.trials;
  const overall = rate(trials.filter((t) => t.pass).length, trials.length);
  const categories = CATEGORIES.flatMap((category) => {
    const ts = trials.filter((t) => t.category === category);
    if (ts.length === 0) return [];
    const r = rate(ts.filter((t) => t.pass).length, ts.length);
    const threshold = CATEGORY_THRESHOLD[category] ?? DEFAULT_CATEGORY_THRESHOLD;
    return [
      { category, ...r, threshold, ok: r.rate >= threshold, p50Ms: median(ts.map((t) => t.ms)) },
    ];
  });
  return {
    overall: { ...overall, ok: overall.rate >= OVERALL_THRESHOLD },
    categories,
    errors: trials.filter((t) => t.outcome === "error").length,
    cancellations: trials.filter((t) => t.cancelled).length,
    p50Ms: median(trials.map((t) => t.ms)),
    p50FirstTokenMs: median(
      trials.flatMap((t) => (t.firstTokenMs === null ? [] : [t.firstTokenMs])),
    ),
    promptTokens: trials.reduce((n, t) => n + t.promptTokens, 0),
    outputTokens: trials.reduce((n, t) => n + t.outputTokens, 0),
    estimatedTokenTrials: trials.filter((t) => t.tokenSource === "estimated").length,
    modelCalls: trials.reduce((n, t) => n + t.modelCalls, 0),
    repairCalls: trials.reduce((n, t) => n + t.repairCalls, 0),
    affectedBlocks: trials.reduce((n, t) => n + t.affectedBlocks, 0),
    unrelatedBlocksModified: trials.reduce((n, t) => n + (t.unrelatedBlocksModified ?? 0), 0),
  };
}

const pct = (r: number): string => `${(r * 100).toFixed(0)}%`;
const secs = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;

/** A report a person can read: the table first, then every failure with what was expected and what the model wrote. */
export function toMarkdown(results: Results): string {
  const s = summarise(results);
  const lines: string[] = [
    `# Eval report: ${results.meta.label}`,
    "",
    `Model \`${results.meta.model}\`, ${results.meta.date}, ${String(results.trials.length)} trials.`,
    "",
    `**Overall ${pct(s.overall.rate)}** (${String(s.overall.pass)} of ${String(s.overall.total)}), needs ${pct(OVERALL_THRESHOLD)}: ${s.overall.ok ? "met" : "NOT met"}. Median ${secs(s.p50Ms)} per trial. Pipeline errors: ${String(s.errors)}; cancellations: ${String(s.cancellations)}.`,
    "",
    `Model work: ${String(s.modelCalls)} calls (${String(s.repairCalls)} repairs), ${String(s.promptTokens)} input tokens and ${String(s.outputTokens)} output tokens${s.estimatedTokenTrials > 0 ? `; ${String(s.estimatedTokenTrials)} trial(s) used clearly marked estimates` : ""}. Median first token ${secs(s.p50FirstTokenMs)}.`,
    "",
    `Edit isolation: ${String(s.affectedBlocks)} affected blocks; ${String(s.unrelatedBlocksModified)} unrelated blocks modified in cases that define an allowed change set.`,
    "",
    "| Category | Pass | Rate | Needs | | Median |",
    "|---|---|---|---|---|---|",
    ...s.categories.map(
      (c) =>
        `| ${c.category} | ${String(c.pass)}/${String(c.total)} | ${pct(c.rate)} | ${pct(c.threshold)} | ${c.ok ? "ok" : "**below**"} | ${secs(c.p50Ms)} |`,
    ),
  ];
  const failed = results.trials.filter((t) => !t.pass);
  if (failed.length > 0) {
    lines.push("", `## Failures (${String(failed.length)})`);
    for (const t of failed) {
      lines.push(
        "",
        `### ${t.caseId}${t.variant > 0 ? ` (variant ${String(t.variant)})` : ""} · ${t.category}`,
        "",
        `Said: “${t.utterance}”`,
        "",
        `Came to: \`${t.outcome}\`${t.summary ? ` — ${t.summary}` : ""}`,
        "",
        ...t.failures.map((f) => `- ${f}`),
      );
      if (t.raw)
        lines.push(
          "",
          "<details><summary>Model answer</summary>",
          "",
          "```",
          t.raw.slice(0, 2500),
          "```",
          "",
          "</details>",
        );
    }
  }
  return `${lines.join("\n")}\n`;
}

export interface Comparison {
  /** Category pass-rate change in points (b minus a). */
  deltas: { category: Category; a: number; b: number; points: number }[];
  /** Trials that passed in a and fail in b, and the other way round. */
  regressions: string[];
  fixes: string[];
  /** Categories that lost more than 5 points: a prompt change needs a written reason for each. */
  needsJustification: Category[];
}

const key = (t: Trial): string => `${t.caseId}#${String(t.variant)}`;

export function compare(a: Results, b: Results): Comparison {
  const sa = summarise(a);
  const sb = summarise(b);
  const deltas = CATEGORIES.flatMap((category) => {
    const x = sa.categories.find((c) => c.category === category);
    const y = sb.categories.find((c) => c.category === category);
    if (!x || !y) return [];
    return [{ category, a: x.rate, b: y.rate, points: Math.round((y.rate - x.rate) * 100) }];
  });
  const was = new Map(a.trials.map((t) => [key(t), t.pass]));
  const regressions: string[] = [];
  const fixes: string[] = [];
  for (const t of b.trials) {
    const before = was.get(key(t));
    if (before === undefined) continue;
    if (before && !t.pass) regressions.push(key(t));
    if (!before && t.pass) fixes.push(key(t));
  }
  return {
    deltas,
    regressions,
    fixes,
    needsJustification: deltas.filter((d) => d.points < -5).map((d) => d.category),
  };
}

export function comparisonToMarkdown(a: Results, b: Results): string {
  const c = compare(a, b);
  return [
    `# ${a.meta.label} → ${b.meta.label}`,
    "",
    "| Category | Before | After | Change |",
    "|---|---|---|---|",
    ...c.deltas.map(
      (d) =>
        `| ${d.category} | ${pct(d.a)} | ${pct(d.b)} | ${d.points > 0 ? "+" : ""}${String(d.points)} |`,
    ),
    "",
    `Regressions (${String(c.regressions.length)}): ${c.regressions.join(", ") || "none"}`,
    "",
    `Fixed (${String(c.fixes.length)}): ${c.fixes.join(", ") || "none"}`,
    "",
    c.needsJustification.length > 0
      ? `**Lost more than 5 points: ${c.needsJustification.join(", ")}. Write the reason in the pull request.**`
      : "No category lost more than 5 points.",
    "",
  ].join("\n");
}
