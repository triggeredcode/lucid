import { currentBaseline } from "./baseline";
import type { DecisionScope, RoutingCandidate } from "./types";

const SCOPES: DecisionScope[] = [
  "document",
  "section",
  "component",
  "block",
  "selection",
  "unknown",
];

export interface ScopeDecision {
  scope: DecisionScope;
  confidence: number;
}

export type DecideScope = (utterance: string) => Promise<ScopeDecision>;

const SYSTEM_PROMPT = `Classify only the target scope of a note-editing request.
document = all content or the note as a whole
section = one topic group, chapter, or named portion
component = one table, diagram, chart, grid, or visual
block = one paragraph, heading, numbered item, or content unit
selection = explicitly highlighted or selected text
unknown = no clear target; vague pronouns without an actual UI selection are unknown
Prefer unknown whenever the target is unclear. Never infer document merely because no smaller target is named.
Examples:
"make this better" -> unknown
"continue writing" -> unknown
"what is noteworthy?" -> unknown
"shorten the portion about pricing" -> section
"update the comparison matrix" -> component
"rewrite paragraph twelve" -> block
Return only the requested JSON. Do not perform the edit.`;

export function createOllamaScopeDecider(
  model: string,
  baseUrl = "http://127.0.0.1:11434",
): DecideScope {
  return async (utterance) => {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: utterance },
        ],
        format: {
          type: "object",
          properties: {
            scope: { type: "string", enum: SCOPES },
            confidence: { type: "number", minimum: 0, maximum: 1 },
          },
          required: ["scope", "confidence"],
          additionalProperties: false,
        },
        options: { temperature: 0, num_predict: 32 },
      }),
    });
    if (!response.ok) {
      throw new Error(`Ollama decision request failed (${String(response.status)}).`);
    }
    const body = (await response.json()) as { message?: { content?: string } };
    const content = body.message?.content;
    if (!content) throw new Error("Ollama returned an empty decision response.");
    const parsed = JSON.parse(content) as { scope?: unknown; confidence?: unknown };
    if (typeof parsed.scope !== "string" || !SCOPES.includes(parsed.scope as DecisionScope)) {
      throw new Error("Ollama returned an invalid decision scope.");
    }
    if (
      typeof parsed.confidence !== "number" ||
      !Number.isFinite(parsed.confidence) ||
      parsed.confidence < 0 ||
      parsed.confidence > 1
    ) {
      throw new Error("Ollama returned an invalid decision confidence.");
    }
    return { scope: parsed.scope as DecisionScope, confidence: parsed.confidence };
  };
}

export function createDecisionModelRoutingCandidate(options: {
  model: string;
  decideScope?: DecideScope;
  baseUrl?: string;
  minConfidence?: number;
}): RoutingCandidate {
  const decideScope =
    options.decideScope ?? createOllamaScopeDecider(options.model, options.baseUrl);
  const minConfidence = options.minConfidence ?? 0.8;
  return {
    id: `ollama-decision:${options.model}`,
    async decide(testCase) {
      const started = performance.now();
      const baseline = await currentBaseline.decide(testCase);
      if (baseline.action !== "main-model" || baseline.scope !== "unknown") {
        return { ...baseline, latencyMs: performance.now() - started };
      }
      const raw = await decideScope(testCase.utterance);
      const scope =
        raw.scope === "unknown" || raw.confidence < minConfidence ? "unknown" : raw.scope;
      return {
        ...baseline,
        scope,
        confidence: raw.confidence,
        abstained: scope === "unknown",
        latencyMs: performance.now() - started,
        decisionModel: { rawScope: raw.scope, rawConfidence: raw.confidence },
      };
    },
  };
}
