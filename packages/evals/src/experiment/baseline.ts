import { parseMeta } from "@lucid/core";
import { deterministicCommand } from "@lucid/llm";
import type { Decision, DecisionScope, RoutingCandidate, RoutingCase } from "./types";

const WHOLE_DOCUMENT =
  /\b(?:whole|entire)\s+(?:document|page|note)|\b(?:summari[sz]e|rewrite|review)\s+(?:the\s+)?(?:document|page)\b/i;

function scopeOf(testCase: RoutingCase): DecisionScope {
  const text = testCase.utterance;
  if (WHOLE_DOCUMENT.test(text)) return "document";
  if (/create an empty section/i.test(text)) return "document";
  if (/\b(?:this|selected)\s+(?:block|paragraph|heading|item)\b/i.test(text)) return "selection";
  if (/\b(?:b\d+|blocks?\s+\d+)\b/i.test(text)) return "block";
  if (/\bsection\b/i.test(text)) return "section";
  if (/\b(?:table|diagram|chart)s?\b/i.test(text)) return "component";
  if (testCase.state.cursorBlockId) return "selection";
  return "unknown";
}

const hintsOf = (utterance: string): string[] => [
  ...new Set([
    ...(utterance.toLowerCase().match(/\bb\d+(?:\.\d+)*\b/g) ?? []),
    ...(utterance
      .toLowerCase()
      .match(/\b(?:first|second|third|fourth|last)\s+(?:table|diagram|chart)\b/g) ?? []),
  ]),
];

/** A0: exactly the routing Lucid 0.4.0 already performs from explicit UI state. */
export const currentBaseline: RoutingCandidate = {
  id: "current",
  decide(testCase): Decision {
    const started = performance.now();
    const meta = parseMeta(testCase.utterance, testCase.state);
    if (meta) {
      return {
        lane: "meta",
        scope: "unknown",
        targetHints: hintsOf(testCase.utterance),
        action: "deterministic",
        confidence: 1,
        abstained: false,
        latencyMs: performance.now() - started,
      };
    }

    const scope = scopeOf(testCase);
    if (testCase.state.mode === "guided") {
      return {
        lane: "guided",
        scope: "component",
        targetHints: hintsOf(testCase.utterance),
        action: "deterministic",
        confidence: 1,
        abstained: false,
        latencyMs: performance.now() - started,
      };
    }
    if (testCase.state.mode === "agent-read") {
      return {
        lane: "agent-read",
        scope,
        targetHints: hintsOf(testCase.utterance),
        action: "read-more",
        confidence: 1,
        abstained: false,
        latencyMs: performance.now() - started,
      };
    }

    const direct =
      testCase.state.mode === "command"
        ? deterministicCommand(testCase.doc, testCase.utterance, testCase.state.cursorBlockId)
        : undefined;
    return {
      lane: testCase.state.mode,
      scope,
      targetHints: hintsOf(testCase.utterance),
      action: direct ? "deterministic" : "main-model",
      confidence: 1,
      abstained: false,
      latencyMs: performance.now() - started,
    };
  },
};
