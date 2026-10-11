/**
 * LM Studio keeps its work on a prompt only at checkpoints about every 2048 tokens: when a request differs from the
 * last one, everything after the last checkpoint before the first difference is computed again (prefill is about 120
 * tokens per second here). A Command request differs from the previous one where the page starts, so the static part
 * (system prompt and examples) should end just AFTER a multiple of 2048 tokens: then little of it is computed again.
 *
 * Measured with the real model by `prefix.live.test.ts`; `prefix.test.ts` fails when the prompt text no longer matches,
 * which is the moment to measure again (`LUCID_LIVE=1 pnpm exec vitest run --project @lucid/llm prefix.live`).
 */
export const CHECKPOINT = 2048;

export const STATIC_PREFIX = {
  command: { chars: 20609, tokens: 6338 },
} as const;
