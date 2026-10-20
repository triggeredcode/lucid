import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { arch, cpus, platform, release, totalmem } from "node:os";
import { dirname, join, resolve } from "node:path";
import { currentBaseline } from "./baseline";
import { CONTEXT_CASES, ROUTING_CASES, validateExperimentCases } from "./cases";
import { currentContextStrategy, focusedContextStrategy } from "./contextStrategies";
import { createDecisionModelRoutingCandidate } from "./decisionModelRouter";
import { createEmbeddingRoutingCandidate } from "./embeddingRouter";
import { experimentToMarkdown, passesExperimentGates } from "./report";
import { runContextCase, runRoutingCases } from "./run";
import { EXPERIMENT_DATASET_VERSION, type ExperimentResults, type ExperimentSplit } from "./types";

const arg = (args: string[], name: string): string | undefined => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const flag = (args: string[], name: string): boolean => args.includes(`--${name}`);

const revision = (cwd: string): string => {
  try {
    return execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
      cwd,
      encoding: "utf8",
    }).trim();
  } catch {
    return "unknown";
  }
};

export async function experimentMain(args: string[], cwd = process.cwd()): Promise<number> {
  const candidateArg = arg(args, "candidate") ?? "current";
  const suite = arg(args, "suite") ?? "all";
  const splitArg = arg(args, "split") ?? "all";
  const contextArg = arg(args, "context") ?? "current";
  const minSimilarityArg = arg(args, "embedding-min-similarity");
  const minMarginArg = arg(args, "embedding-min-margin");
  const decisionConfidenceArg = arg(args, "decision-min-confidence");
  const minSimilarity = minSimilarityArg === undefined ? undefined : Number(minSimilarityArg);
  const minMargin = minMarginArg === undefined ? undefined : Number(minMarginArg);
  const decisionConfidence =
    decisionConfidenceArg === undefined ? undefined : Number(decisionConfidenceArg);
  if (
    candidateArg !== "current" &&
    candidateArg !== "ollama-embedding" &&
    candidateArg !== "ollama-decision"
  ) {
    console.error("--candidate must be current, ollama-embedding, or ollama-decision.");
    return 2;
  }
  if (!["routing", "context", "all"].includes(suite)) {
    console.error("--suite must be routing, context, or all.");
    return 2;
  }
  if (!["development", "calibration", "holdout", "all"].includes(splitArg)) {
    console.error("--split must be development, calibration, holdout, or all.");
    return 2;
  }
  if (contextArg !== "current" && contextArg !== "focused") {
    console.error("--context must be current or focused.");
    return 2;
  }
  if (minSimilarity !== undefined && (!Number.isFinite(minSimilarity) || minSimilarity < 0)) {
    console.error("--embedding-min-similarity must be a non-negative number.");
    return 2;
  }
  if (minMargin !== undefined && (!Number.isFinite(minMargin) || minMargin < 0)) {
    console.error("--embedding-min-margin must be a non-negative number.");
    return 2;
  }
  if (
    decisionConfidence !== undefined &&
    (!Number.isFinite(decisionConfidence) || decisionConfidence < 0 || decisionConfidence > 1)
  ) {
    console.error("--decision-min-confidence must be between 0 and 1.");
    return 2;
  }
  const problems = validateExperimentCases();
  if (problems.length > 0) {
    console.error(
      `The experiment cases have problems:\n${problems.map((p) => `- ${p}`).join("\n")}`,
    );
    return 2;
  }

  const split = splitArg as ExperimentSplit | "all";
  const inSplit = (testCase: { split: ExperimentSplit }): boolean =>
    split === "all" || testCase.split === split;
  const ollamaUrl = arg(args, "ollama-url");
  const routingCandidate =
    candidateArg === "ollama-embedding"
      ? createEmbeddingRoutingCandidate({
          model: arg(args, "embedding-model") ?? "nomic-embed-text:latest",
          ...(ollamaUrl ? { baseUrl: ollamaUrl } : {}),
          ...(minSimilarity === undefined ? {} : { minSimilarity }),
          ...(minMargin === undefined ? {} : { minMargin }),
        })
      : candidateArg === "ollama-decision"
        ? createDecisionModelRoutingCandidate({
            model: arg(args, "decision-model") ?? "gemma3:1b",
            ...(ollamaUrl ? { baseUrl: ollamaUrl } : {}),
            ...(decisionConfidence === undefined ? {} : { minConfidence: decisionConfidence }),
          })
        : currentBaseline;
  const routing =
    suite === "context"
      ? []
      : await runRoutingCases(ROUTING_CASES.filter(inSplit), routingCandidate);
  const contextStrategy =
    contextArg === "focused" ? focusedContextStrategy : currentContextStrategy;
  const context =
    suite === "routing"
      ? []
      : CONTEXT_CASES.filter(inSplit).map((testCase) => runContextCase(testCase, contextStrategy));
  const rootPackage = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")) as {
    version: string;
  };
  const cpuList = cpus();
  const results: ExperimentResults = {
    meta: {
      datasetVersion: EXPERIMENT_DATASET_VERSION,
      candidate: routingCandidate.id,
      contextStrategy: contextStrategy.id,
      createdAt: new Date().toISOString(),
      sourceRevision: revision(cwd),
      productVersion: rootPackage.version,
      split,
      hardware: {
        platform: platform(),
        release: release(),
        arch: arch(),
        cpu: cpuList[0]?.model ?? "unknown",
        logicalCpus: cpuList.length,
        totalMemoryBytes: totalmem(),
        node: process.version,
      },
    },
    routing,
    context,
  };
  const day = new Date().toLocaleDateString("en-CA");
  const candidateSlug = routingCandidate.id.replace(/[^a-z0-9.-]+/gi, "-");
  const output = resolve(
    cwd,
    arg(args, "out") ??
      join(".docdex", "evals", `${day}-decision-${candidateSlug}-context-${contextStrategy.id}`),
  );
  mkdirSync(dirname(join(output, "x")), { recursive: true });
  writeFileSync(join(output, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
  const markdown = experimentToMarkdown(results);
  writeFileSync(join(output, "report.md"), markdown);
  console.log(markdown);
  console.log(`Report: ${output}`);
  return flag(args, "strict") && !passesExperimentGates(results) ? 1 : 0;
}
