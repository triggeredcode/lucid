import type { ContextTrial, ExperimentResults, RoutingTrial } from "./types";

const rate = (pass: number, total: number): number => (total === 0 ? 1 : pass / total);
const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
};
const percentile = (values: number[], p: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] ?? 0;
};

export interface RoutingSummary {
  total: number;
  passed: number;
  passRate: number;
  laneAccuracy: number;
  actionAccuracy: number;
  scopeAccuracy: number;
  semanticScopeAccuracy: number;
  nearMissScopeAccuracy: number;
  highConfidenceWrongDirectActions: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  maxLatencyMs: number;
  challengeP50LatencyMs: number;
  challengeP95LatencyMs: number;
}

export interface ContextSummary {
  total: number;
  passed: number;
  passRate: number;
  meanTargetRecall: number;
  medianContextReduction: number;
  medianEligibleContextReduction: number;
  forbiddenSelections: number;
}

export function summariseRouting(trials: readonly RoutingTrial[]): RoutingSummary {
  const passed = trials.filter(({ pass }) => pass).length;
  const scopeTrials = trials.filter(({ expected }) => expected.scope !== undefined);
  const semanticTrials = trials.filter(({ challenge }) => challenge === "semantic");
  const nearMissTrials = trials.filter(({ challenge }) => challenge === "near-miss");
  const challengeTrials = [...semanticTrials, ...nearMissTrials];
  return {
    total: trials.length,
    passed,
    passRate: rate(passed, trials.length),
    laneAccuracy: rate(
      trials.filter(({ decision, expected }) => decision.lane === expected.lane).length,
      trials.length,
    ),
    actionAccuracy: rate(
      trials.filter(({ decision, expected }) => decision.action === expected.action).length,
      trials.length,
    ),
    scopeAccuracy: rate(
      scopeTrials.filter(({ decision, expected }) => decision.scope === expected.scope).length,
      scopeTrials.length,
    ),
    semanticScopeAccuracy: rate(
      semanticTrials.filter(({ decision, expected }) => decision.scope === expected.scope).length,
      semanticTrials.length,
    ),
    nearMissScopeAccuracy: rate(
      nearMissTrials.filter(({ decision, expected }) => decision.scope === expected.scope).length,
      nearMissTrials.length,
    ),
    highConfidenceWrongDirectActions: trials.filter(
      ({ highConfidenceWrongDirectAction }) => highConfidenceWrongDirectAction,
    ).length,
    p50LatencyMs: median(trials.map(({ decision }) => decision.latencyMs)),
    p95LatencyMs: percentile(
      trials.map(({ decision }) => decision.latencyMs),
      0.95,
    ),
    maxLatencyMs: Math.max(0, ...trials.map(({ decision }) => decision.latencyMs)),
    challengeP50LatencyMs: median(challengeTrials.map(({ decision }) => decision.latencyMs)),
    challengeP95LatencyMs: percentile(
      challengeTrials.map(({ decision }) => decision.latencyMs),
      0.95,
    ),
  };
}

export function summariseContext(trials: readonly ContextTrial[]): ContextSummary {
  const passed = trials.filter(({ pass }) => pass).length;
  const eligible = trials.filter(({ baselineChars }) => baselineChars >= 2_000);
  return {
    total: trials.length,
    passed,
    passRate: rate(passed, trials.length),
    meanTargetRecall:
      trials.length === 0
        ? 1
        : trials.reduce((sum, trial) => sum + trial.targetRecall, 0) / trials.length,
    medianContextReduction: median(trials.map(({ reductionRate }) => reductionRate)),
    medianEligibleContextReduction: median(eligible.map(({ reductionRate }) => reductionRate)),
    forbiddenSelections: trials.reduce((sum, trial) => sum + trial.forbiddenSelected.length, 0),
  };
}

const percent = (value: number): string => `${(value * 100).toFixed(1)}%`;
const routingEvidence = (trial: RoutingTrial): string => {
  if (trial.decision.embedding) return `margin ${trial.decision.embedding.margin.toFixed(4)}`;
  if (trial.decision.decisionModel)
    return `${trial.decision.decisionModel.rawScope} @ ${percent(trial.decision.decisionModel.rawConfidence)}`;
  return "-";
};

export function experimentToMarkdown(results: ExperimentResults): string {
  const routing = summariseRouting(results.routing);
  const context = summariseContext(results.context);
  const lines = [
    `# Lucid decision/context experiment: ${results.meta.candidate}`,
    "",
    `- Dataset: v${String(results.meta.datasetVersion)} (${results.meta.split})`,
    `- Routing/context candidates: ${results.meta.candidate} / ${results.meta.contextStrategy}`,
    `- Source: ${results.meta.sourceRevision} · Lucid ${results.meta.productVersion}`,
    `- System: ${results.meta.hardware.platform} ${results.meta.hardware.release} ${results.meta.hardware.arch}; ${results.meta.hardware.cpu}; ${String(results.meta.hardware.logicalCpus)} logical CPUs; ${(results.meta.hardware.totalMemoryBytes / 1024 ** 3).toFixed(1)} GiB`,
    `- Created: ${results.meta.createdAt}`,
    "",
    "## Routing",
    "",
    `- Pass: ${String(routing.passed)}/${String(routing.total)} (${percent(routing.passRate)})`,
    `- Lane/action/scope accuracy: ${percent(routing.laneAccuracy)} / ${percent(routing.actionAccuracy)} / ${percent(routing.scopeAccuracy)}`,
    `- Semantic/near-miss scope accuracy: ${percent(routing.semanticScopeAccuracy)} / ${percent(routing.nearMissScopeAccuracy)}`,
    `- High-confidence wrong direct actions: ${String(routing.highConfidenceWrongDirectActions)}`,
    `- Decision latency p50/p95/max: ${routing.p50LatencyMs.toFixed(3)} / ${routing.p95LatencyMs.toFixed(3)} / ${routing.maxLatencyMs.toFixed(3)} ms`,
    `- Semantic challenge latency p50/p95: ${routing.challengeP50LatencyMs.toFixed(3)} / ${routing.challengeP95LatencyMs.toFixed(3)} ms`,
    "",
    "| Challenge | Expected | Predicted | Confidence | Evidence | Result |",
    "|---|---|---|---:|---:|---|",
    ...results.routing
      .filter(({ challenge }) => challenge !== undefined)
      .map(
        (trial) =>
          `| ${trial.caseId} | ${trial.expected.scope ?? "-"} | ${trial.decision.scope} | ${percent(trial.decision.confidence)} | ${routingEvidence(trial)} | ${trial.pass ? "pass" : "FAIL"} |`,
      ),
    "",
    "## Context selection",
    "",
    `- Pass: ${String(context.passed)}/${String(context.total)} (${percent(context.passRate)})`,
    `- Mean target recall: ${percent(context.meanTargetRecall)}`,
    `- Median character reduction against full outline: ${percent(context.medianContextReduction)}`,
    `- Median reduction on eligible large-context tasks: ${percent(context.medianEligibleContextReduction)}`,
    `- Forbidden block selections: ${String(context.forbiddenSelections)}`,
    "",
    "| Strategy | Case | Split | Recall | Reduction | Selected | Result |",
    "|---|---|---|---:|---:|---:|---|",
    ...results.context.map(
      (trial) =>
        `| ${trial.strategy} | ${trial.caseId} | ${trial.split} | ${percent(trial.targetRecall)} | ${percent(trial.reductionRate)} | ${String(trial.selectedIds.length)} | ${trial.pass ? "pass" : "FAIL"} |`,
    ),
  ];
  const failures = [
    ...results.routing
      .filter(({ pass }) => !pass)
      .map((trial) => `${trial.caseId}: ${trial.failures.join("; ")}`),
    ...results.context
      .filter(({ pass }) => !pass)
      .map((trial) => `${trial.caseId}: ${trial.failures.join("; ")}`),
  ];
  if (failures.length > 0) lines.push("", "## Failures", "", ...failures.map((f) => `- ${f}`));
  return `${lines.join("\n")}\n`;
}

export function passesExperimentGates(results: ExperimentResults): boolean {
  const routing = summariseRouting(results.routing);
  const context = summariseContext(results.context);
  return (
    routing.passRate === 1 &&
    routing.highConfidenceWrongDirectActions === 0 &&
    context.passRate === 1 &&
    context.medianContextReduction >= 0.2
  );
}
