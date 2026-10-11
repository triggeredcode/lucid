export type LaneName = "input" | "command" | "advisor";

/** Sampling settings and model for one kind of request. */
export interface Lane {
  model: string;
  temperature: number;
  topP: number;
  topK: number;
  presencePenalty: number;
  maxTokens: number;
}

export const DEFAULT_MODEL = "qwen/qwen3.8-27b";

export const DEFAULT_LANES: Record<LaneName, Lane> = {
  input: {
    model: DEFAULT_MODEL,
    temperature: 0.3,
    topP: 0.9,
    topK: 20,
    presencePenalty: 0,
    maxTokens: 1500,
  },
  command: {
    model: DEFAULT_MODEL,
    temperature: 0.2,
    topP: 0.9,
    topK: 20,
    presencePenalty: 0,
    maxTokens: 1200,
  },
  advisor: {
    model: DEFAULT_MODEL,
    temperature: 0.3,
    topP: 0.9,
    topK: 20,
    presencePenalty: 0,
    maxTokens: 800,
  },
};
