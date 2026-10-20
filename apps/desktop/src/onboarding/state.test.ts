import { describe, expect, it, vi } from "vitest";
import {
  completeOnboarding,
  onboardingComplete,
  ONBOARDING_STORAGE_KEY,
  ONBOARDING_VERSION,
} from "./state";

describe("onboarding state", () => {
  it("shows a new or changed guide until its current version is completed", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };

    expect(onboardingComplete(storage)).toBe(false);
    values.set(ONBOARDING_STORAGE_KEY, "older");
    expect(onboardingComplete(storage)).toBe(false);
    completeOnboarding(storage);
    expect(values.get(ONBOARDING_STORAGE_KEY)).toBe(ONBOARDING_VERSION);
    expect(onboardingComplete(storage)).toBe(true);
  });

  it("does not let unavailable browser storage break startup or dismissal", () => {
    const storage = {
      getItem: vi.fn(() => {
        throw new Error("blocked");
      }),
      setItem: vi.fn(() => {
        throw new Error("blocked");
      }),
    };

    expect(onboardingComplete(storage)).toBe(false);
    expect(() => {
      completeOnboarding(storage);
    }).not.toThrow();
  });
});
