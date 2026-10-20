import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { arch, cpus, platform, release, totalmem } from "node:os";
import { dirname, join, resolve } from "node:path";
import { currentBaseline } from "./baseline";
import { CONTEXT_CASES, ROUTING_CASES, validateExperimentCases } from "./cases";
import { experimentToMarkdown, passesExperimentGates } from "./report";
import { runContextCase, runRoutingCase } from "./run";
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
  if (candidateArg !== "current") {
    console.error("Only --candidate current exists in the baseline slice.");
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
  const routing =
    suite === "context"
      ? []
      : await Promise.all(
          ROUTING_CASES.filter(inSplit).map((testCase) =>
            runRoutingCase(testCase, currentBaseline),
          ),
        );
  const context = suite === "routing" ? [] : CONTEXT_CASES.filter(inSplit).map(runContextCase);
  const rootPackage = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")) as {
    version: string;
  };
  const cpuList = cpus();
  const results: ExperimentResults = {
    meta: {
      datasetVersion: EXPERIMENT_DATASET_VERSION,
      candidate: currentBaseline.id,
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
  const output = resolve(
    cwd,
    arg(args, "out") ?? join(".docdex", "evals", `${day}-decision-context-current`),
  );
  mkdirSync(dirname(join(output, "x")), { recursive: true });
  writeFileSync(join(output, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
  const markdown = experimentToMarkdown(results);
  writeFileSync(join(output, "report.md"), markdown);
  console.log(markdown);
  console.log(`Report: ${output}`);
  return flag(args, "strict") && !passesExperimentGates(results) ? 1 : 0;
}
