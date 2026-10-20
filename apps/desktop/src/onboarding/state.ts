export const ONBOARDING_VERSION = "1";
export const ONBOARDING_STORAGE_KEY = "lucid.onboarding";

type OnboardingStorage = Pick<Storage, "getItem" | "setItem">;

const browserStorage = (): OnboardingStorage | undefined => {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
};

/** A new onboarding version may be shown once even if an older guide was completed. */
export function onboardingComplete(storage = browserStorage()): boolean {
  try {
    return storage?.getItem(ONBOARDING_STORAGE_KEY) === ONBOARDING_VERSION;
  } catch {
    return false;
  }
}

/** Completion is a convenience preference; an unavailable store must never block the app. */
export function completeOnboarding(storage = browserStorage()): void {
  try {
    storage?.setItem(ONBOARDING_STORAGE_KEY, ONBOARDING_VERSION);
  } catch {
    // This window still closes the guide; it may be offered again next launch.
  }
}
