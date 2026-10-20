import type { LucidDoc, MetaState } from "@lucid/core";

export const EXPERIMENT_DATASET_VERSION = 2;

export type ExperimentSplit = "development" | "calibration" | "holdout";
export type DecisionLane = "meta" | "guided" | "input" | "command" | "agent-read" | "clarify";
export type DecisionScope =
  "selection" | "block" | "section" | "component" | "document" | "unknown";
export type DecisionAction = "deterministic" | "main-model" | "clarify" | "read-more";

export interface Decision {
  lane: DecisionLane;
  scope: DecisionScope;
  targetHints: string[];
  action: DecisionAction;
  confidence: number;
  abstained: boolean;
  latencyMs: number;
  embedding?: { similarity: number; margin: number };
}

export interface RoutingState extends MetaState {
  mode: "input" | "command" | "guided" | "agent-read";
  cursorBlockId?: string;
}

export interface RoutingCase {
  id: string;
  family: string;
  split: ExperimentSplit;
  utterance: string;
  doc: LucidDoc;
  state: RoutingState;
  expected: {
    lane: DecisionLane;
    action: DecisionAction;
    scope?: DecisionScope;
    abstained?: boolean;
  };
  challenge?: "semantic" | "near-miss";
}

export interface RoutingCandidate {
  id: string;
  decide(testCase: RoutingCase): Promise<Decision> | Decision;
}

export type ContextFixtureName = "sample" | "two-tables" | "large-sections";

export interface ContextCase {
  id: string;
  family: string;
  split: ExperimentSplit;
  fixture: ContextFixtureName;
  utterance: string;
  cursorBlockId?: string;
  recentTouched?: string[];
  requiredIds: string[];
  forbiddenIds: string[];
  expectedScope: "targeted" | "document";
  expectedMissingRefs?: string[];
  expectedAmbiguityKinds?: Array<"table" | "chart" | "diagram">;
}

export interface ContextStrategyResult {
  text: string;
  selectedIds: string[];
  scope: "targeted" | "document";
  missingRefs: string[];
  ambiguityKinds: Array<"table" | "chart" | "diagram">;
}

export interface ContextStrategy {
  id: string;
  select(testCase: ContextCase, doc: LucidDoc): ContextStrategyResult;
}

export interface RoutingTrial {
  caseId: string;
  family: string;
  split: ExperimentSplit;
  utterance: string;
  challenge?: "semantic" | "near-miss";
  expected: RoutingCase["expected"];
  decision: Decision;
  pass: boolean;
  failures: string[];
  highConfidenceWrongDirectAction: boolean;
}

export interface ContextTrial {
  strategy: string;
  caseId: string;
  family: string;
  split: ExperimentSplit;
  utterance: string;
  baselineChars: number;
  targetedChars: number;
  reductionRate: number;
  selectedIds: string[];
  requiredIds: string[];
  forbiddenIds: string[];
  targetRecall: number;
  targetPrecision: number;
  forbiddenSelected: string[];
  scope: "targeted" | "document";
  missingRefs: string[];
  ambiguityKinds: Array<"table" | "chart" | "diagram">;
  pass: boolean;
  failures: string[];
}

export interface ExperimentMeta {
  datasetVersion: number;
  candidate: string;
  contextStrategy: string;
  createdAt: string;
  sourceRevision: string;
  productVersion: string;
  split: ExperimentSplit | "all";
  hardware: {
    platform: string;
    release: string;
    arch: string;
    cpu: string;
    logicalCpus: number;
    totalMemoryBytes: number;
    node: string;
  };
}

export interface ExperimentResults {
  meta: ExperimentMeta;
  routing: RoutingTrial[];
  context: ContextTrial[];
}
