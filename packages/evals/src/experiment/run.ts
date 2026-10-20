import { buildOutline } from "@lucid/kit";
import { currentContextStrategy } from "./contextStrategies";
import { contextFixture } from "./fixtures";
import type {
  ContextCase,
  ContextTrial,
  ContextStrategy,
  RoutingCandidate,
  RoutingCase,
  RoutingTrial,
} from "./types";

const sameStrings = (a: readonly string[], b: readonly string[]): boolean => {
  const left = [...a].sort();
  const right = [...b].sort();
  return left.length === right.length && left.every((value, index) => value === right[index]);
};

export async function runRoutingCase(
  testCase: RoutingCase,
  candidate: RoutingCandidate,
): Promise<RoutingTrial> {
  const decision = await candidate.decide(testCase);
  const failures: string[] = [];
  if (decision.lane !== testCase.expected.lane)
    failures.push(`expected lane ${testCase.expected.lane}, got ${decision.lane}`);
  if (decision.action !== testCase.expected.action)
    failures.push(`expected action ${testCase.expected.action}, got ${decision.action}`);
  if (testCase.expected.scope && decision.scope !== testCase.expected.scope)
    failures.push(`expected scope ${testCase.expected.scope}, got ${decision.scope}`);
  if (
    testCase.expected.abstained !== undefined &&
    decision.abstained !== testCase.expected.abstained
  )
    failures.push(
      `expected abstained ${String(testCase.expected.abstained)}, got ${String(decision.abstained)}`,
    );
  if (decision.confidence < 0 || decision.confidence > 1)
    failures.push(`confidence ${String(decision.confidence)} is outside 0..1`);
  if (!Number.isFinite(decision.latencyMs) || decision.latencyMs < 0)
    failures.push(`latency ${String(decision.latencyMs)} is invalid`);
  const highConfidenceWrongDirectAction =
    decision.confidence >= 0.9 &&
    decision.action === "deterministic" &&
    testCase.expected.action !== "deterministic";
  return {
    caseId: testCase.id,
    family: testCase.family,
    split: testCase.split,
    utterance: testCase.utterance,
    expected: testCase.expected,
    decision,
    pass: failures.length === 0,
    failures,
    highConfidenceWrongDirectAction,
  };
}

export function runContextCase(
  testCase: ContextCase,
  strategy: ContextStrategy = currentContextStrategy,
): ContextTrial {
  const doc = contextFixture(testCase.fixture);
  const allIds = doc.blocks.map((block) => block.id);
  const baseline = buildOutline(doc, { full: allIds, maxChars: 80_000 });
  const targeted = strategy.select(testCase, doc);
  const selected = targeted.selectedIds;
  const requiredHits = testCase.requiredIds.filter((id) => selected.includes(id)).length;
  const targetRecall =
    testCase.requiredIds.length === 0 ? 1 : requiredHits / testCase.requiredIds.length;
  const targetPrecision = selected.length === 0 ? 1 : requiredHits / selected.length;
  const forbiddenSelected = testCase.forbiddenIds.filter((id) => selected.includes(id));
  const missingRefs = targeted.missingRefs;
  const ambiguityKinds = targeted.ambiguityKinds;
  const expectedMissing = testCase.expectedMissingRefs ?? [];
  const expectedAmbiguity = testCase.expectedAmbiguityKinds ?? [];
  const failures: string[] = [];
  if (targetRecall !== 1) failures.push(`target recall was ${targetRecall.toFixed(3)}`);
  if (forbiddenSelected.length > 0)
    failures.push(`selected forbidden blocks: ${forbiddenSelected.join(", ")}`);
  if (targeted.scope !== testCase.expectedScope)
    failures.push(`expected scope ${testCase.expectedScope}, got ${targeted.scope}`);
  if (!sameStrings(missingRefs, expectedMissing))
    failures.push(
      `expected missing refs ${expectedMissing.join(", ") || "none"}, got ${missingRefs.join(", ") || "none"}`,
    );
  if (!sameStrings(ambiguityKinds, expectedAmbiguity))
    failures.push(
      `expected ambiguities ${expectedAmbiguity.join(", ") || "none"}, got ${ambiguityKinds.join(", ") || "none"}`,
    );
  return {
    strategy: strategy.id,
    caseId: testCase.id,
    family: testCase.family,
    split: testCase.split,
    utterance: testCase.utterance,
    baselineChars: baseline.text.length,
    targetedChars: targeted.text.length,
    reductionRate: baseline.text.length === 0 ? 0 : 1 - targeted.text.length / baseline.text.length,
    selectedIds: selected,
    requiredIds: testCase.requiredIds,
    forbiddenIds: testCase.forbiddenIds,
    targetRecall,
    targetPrecision,
    forbiddenSelected,
    scope: targeted.scope,
    missingRefs,
    ambiguityKinds,
    pass: failures.length === 0,
    failures,
  };
}
