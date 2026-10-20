import { currentBaseline } from "./baseline";
import type { DecisionScope, RoutingCandidate } from "./types";

export type Embed = (input: string[]) => Promise<number[][]>;

const SCOPE_PROTOTYPES: Record<DecisionScope, string[]> = {
  document: [
    "edit every part of the writing",
    "make a global change across all content",
    "work on the complete file rather than one area",
  ],
  section: [
    "edit one topic-specific portion of the writing",
    "change the region devoted to one subject",
    "work within one chapter or grouped area",
  ],
  component: [
    "modify one structured visual object",
    "change a data grid or visual figure",
    "edit an embedded structured element",
  ],
  block: [
    "change one individual content unit",
    "edit a numbered paragraph or item",
    "work on a single piece of content",
  ],
  selection: [
    "edit only the highlighted range",
    "change the active text selection",
    "rewrite only the marked passage",
  ],
  unknown: [
    "the request has no identifiable target",
    "the user asks for a vague improvement",
    "no particular area or object is named",
    "an open-ended request without a clear scope",
  ],
};

const SCOPES = Object.keys(SCOPE_PROTOTYPES) as DecisionScope[];

function cosine(left: number[], right: number[]): number {
  if (left.length === 0 || left.length !== right.length) return -1;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (leftNorm === 0 || rightNorm === 0) return -1;
  return dot / Math.sqrt(leftNorm * rightNorm);
}

function centroid(vectors: number[][]): number[] {
  const width = vectors[0]?.length ?? 0;
  return Array.from({ length: width }, (_, index) => {
    const total = vectors.reduce((sum, vector) => sum + (vector[index] ?? 0), 0);
    return total / vectors.length;
  });
}

export function classifyScope(
  query: number[],
  prototypes: Map<DecisionScope, number[]>,
  minSimilarity = 0.35,
  minMargin = 0.04,
): { scope: DecisionScope; similarity: number; margin: number } {
  const ranked = SCOPES.map((scope) => ({
    scope,
    similarity: cosine(query, prototypes.get(scope) ?? []),
  })).sort((left, right) => right.similarity - left.similarity);
  const best = ranked[0] ?? { scope: "unknown" as const, similarity: -1 };
  const margin = best.similarity - (ranked[1]?.similarity ?? -1);
  if (best.similarity < minSimilarity || margin < minMargin) {
    return { scope: "unknown", similarity: best.similarity, margin };
  }
  return { scope: best.scope, similarity: best.similarity, margin };
}

export function createOllamaEmbedder(model: string, baseUrl = "http://127.0.0.1:11434"): Embed {
  return async (input) => {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/embed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, input }),
    });
    if (!response.ok) {
      throw new Error(`Ollama embedding request failed (${String(response.status)}).`);
    }
    const body = (await response.json()) as { embeddings?: number[][] };
    if (!body.embeddings || body.embeddings.length !== input.length) {
      throw new Error("Ollama returned an invalid embedding batch.");
    }
    return body.embeddings;
  };
}

export function createEmbeddingRoutingCandidate(options: {
  model: string;
  embed?: Embed;
  baseUrl?: string;
  minSimilarity?: number;
  minMargin?: number;
}): RoutingCandidate {
  const embed = options.embed ?? createOllamaEmbedder(options.model, options.baseUrl);
  let prototypePromise: Promise<Map<DecisionScope, number[]>> | undefined;

  const prototypes = async (): Promise<Map<DecisionScope, number[]>> => {
    prototypePromise ??= (async () => {
      const phrases = SCOPES.flatMap((scope) => SCOPE_PROTOTYPES[scope]);
      const vectors = await embed(phrases);
      const result = new Map<DecisionScope, number[]>();
      let offset = 0;
      for (const scope of SCOPES) {
        const count = SCOPE_PROTOTYPES[scope].length;
        result.set(scope, centroid(vectors.slice(offset, offset + count)));
        offset += count;
      }
      return result;
    })();
    return prototypePromise;
  };

  return {
    id: `ollama-embedding:${options.model}`,
    async decide(testCase) {
      const started = performance.now();
      const baseline = await currentBaseline.decide(testCase);
      if (baseline.action !== "main-model" || baseline.scope !== "unknown") {
        return { ...baseline, latencyMs: performance.now() - started };
      }
      const [query] = await embed([testCase.utterance]);
      if (!query) throw new Error("Ollama did not return an utterance embedding.");
      const result = classifyScope(
        query,
        await prototypes(),
        options.minSimilarity,
        options.minMargin,
      );
      return {
        ...baseline,
        scope: result.scope,
        confidence: Math.max(0, Math.min(1, (result.similarity + 1) / 2)),
        abstained: result.scope === "unknown",
        latencyMs: performance.now() - started,
        embedding: { similarity: result.similarity, margin: result.margin },
      };
    },
  };
}
