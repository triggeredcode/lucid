import { describe, expect, it } from "vitest";
import { currentBaseline } from "./baseline";
import { CONTEXT_CASES, ROUTING_CASES, validateExperimentCases } from "./cases";
import { currentContextStrategy, focusedContextStrategy } from "./contextStrategies";
import {
  experimentToMarkdown,
  passesExperimentGates,
  summariseContext,
  summariseRouting,
} from "./report";
import { runContextCase, runRoutingCase } from "./run";
import type { ExperimentResults, RoutingCandidate } from "./types";

describe("the frozen experiment dataset", () => {
  it("keeps ids unique, references valid, and families in one split", () => {
    expect(validateExperimentCases()).toEqual([]);
  });

  it("has development, calibration, and holdout coverage", () => {
    const splits = new Set([...ROUTING_CASES, ...CONTEXT_CASES].map(({ split }) => split));
    expect(splits).toEqual(new Set(["development", "calibration", "holdout"]));
  });
});

describe("the current routing baseline", () => {
  it("matches the labelled routes without unsafe direct actions", async () => {
    const trials = await Promise.all(
      ROUTING_CASES.map((testCase) => runRoutingCase(testCase, currentBaseline)),
    );
    const summary = summariseRouting(trials);
    expect(summary.passRate).toBe(1);
    expect(summary.highConfidenceWrongDirectActions).toBe(0);
  });

  it("detects a confident wrong direct action", async () => {
    const unsafe: RoutingCandidate = {
      id: "unsafe-test",
      decide: () => ({
        lane: "command",
        scope: "unknown",
        targetHints: [],
        action: "deterministic",
        confidence: 0.99,
        abstained: false,
        latencyMs: 0,
      }),
    };
    const testCase = ROUTING_CASES.find(({ id }) => id === "near-delete");
    if (!testCase) throw new Error("near-delete fixture is missing");
    const trial = await runRoutingCase(testCase, unsafe);
    expect(trial.highConfidenceWrongDirectAction).toBe(true);
    expect(trial.pass).toBe(false);
  });
});

describe("targeted agent context", () => {
  it("freezes the current planner's strengths and known over-selection", () => {
    const trials = CONTEXT_CASES.map((testCase) =>
      runContextCase(testCase, currentContextStrategy),
    );
    const summary = summariseContext(trials);
    expect(summary.passRate).toBe(0.625);
    expect(summary.meanTargetRecall).toBe(1);
    expect(summary.forbiddenSelections).toBe(3);
    expect(summary.medianEligibleContextReduction).toBeGreaterThan(0.8);
  });

  it("focused reads remove the baseline over-selection without losing targets", () => {
    const trials = CONTEXT_CASES.map((testCase) =>
      runContextCase(testCase, focusedContextStrategy),
    );
    const summary = summariseContext(trials);
    expect(summary.passRate).toBe(1);
    expect(summary.meanTargetRecall).toBe(1);
    expect(summary.forbiddenSelections).toBe(0);
    expect(summary.medianContextReduction).toBeGreaterThan(0.2);
  });
});

describe("experiment reports", () => {
  it("renders deterministic metrics and applies the baseline gates", async () => {
    const results: ExperimentResults = {
      meta: {
        datasetVersion: 1,
        candidate: "current",
        contextStrategy: "current",
        createdAt: "2026-10-20T00:00:00.000Z",
        sourceRevision: "abc123",
        productVersion: "0.4.0",
        split: "all",
        hardware: {
          platform: "test",
          release: "test",
          arch: "test",
          cpu: "test",
          logicalCpus: 1,
          totalMemoryBytes: 1024 ** 3,
          node: "v22",
        },
      },
      routing: await Promise.all(
        ROUTING_CASES.map((testCase) => runRoutingCase(testCase, currentBaseline)),
      ),
      context: CONTEXT_CASES.map((testCase) => runContextCase(testCase, currentContextStrategy)),
    };
    const markdown = experimentToMarkdown(results);
    expect(markdown).toContain("High-confidence wrong direct actions: 0");
    expect(markdown).toContain("Median character reduction against full outline");
    expect(passesExperimentGates(results)).toBe(false);
  });
});
