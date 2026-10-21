import { describe, expect, it, vi } from "vitest";
import {
  ACTIVATION_STORAGE_KEY,
  ACTIVATION_VERSION,
  decideProvider,
  finishActivation,
  loadActivationProgress,
  recordMilestone,
  rememberActivationPage,
  rememberSetupStep,
} from "./activation";

const memory = (initial?: string) => {
  const values = new Map<string, string>();
  if (initial) values.set(ACTIVATION_STORAGE_KEY, initial);
  return {
    values,
    storage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  };
};

describe("first-success activation progress", () => {
  it("starts safely when no progress has been stored", () => {
    expect(loadActivationProgress(memory().storage)).toEqual({
      version: ACTIVATION_VERSION,
      provider: "unknown",
      setupStep: 0,
      milestones: [],
      finished: false,
    });
  });

  it("ignores corrupt, stale and unsupported stored values", () => {
    expect(loadActivationProgress(memory("not json").storage).provider).toBe("unknown");
    expect(
      loadActivationProgress(memory(JSON.stringify({ version: "0", provider: "ready" })).storage)
        .provider,
    ).toBe("unknown");
    expect(
      loadActivationProgress(
        memory(
          JSON.stringify({
            version: ACTIVATION_VERSION,
            provider: "maybe",
            milestones: ["page-created", "invented", "page-created"],
            pageId: 42,
            finished: "yes",
          }),
        ).storage,
      ),
    ).toEqual({
      version: ACTIVATION_VERSION,
      provider: "unknown",
      setupStep: 0,
      milestones: ["page-created"],
      finished: false,
    });
  });

  it("persists decisions, a page and idempotent milestones", () => {
    const { storage } = memory();
    let progress = decideProvider(loadActivationProgress(storage), "ready", storage);
    progress = rememberSetupStep(progress, 2, storage);
    progress = rememberActivationPage(progress, "page-1", storage);
    progress = recordMilestone(progress, "page-created", storage);
    progress = recordMilestone(progress, "page-created", storage);
    finishActivation(progress, storage);

    expect(loadActivationProgress(storage)).toEqual({
      version: ACTIVATION_VERSION,
      provider: "ready",
      setupStep: 2,
      milestones: ["page-created"],
      pageId: "page-1",
      finished: true,
    });
  });

  it("never blocks the app when storage throws", () => {
    const storage = {
      getItem: vi.fn(() => {
        throw new Error("blocked");
      }),
      setItem: vi.fn(() => {
        throw new Error("blocked");
      }),
    };
    const progress = loadActivationProgress(storage);
    expect(() => decideProvider(progress, "skipped", storage)).not.toThrow();
    expect(progress.provider).toBe("unknown");
  });
});
