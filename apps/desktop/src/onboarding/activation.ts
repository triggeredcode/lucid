export const ACTIVATION_VERSION = "1" as const;
export const ACTIVATION_STORAGE_KEY = "lucid.firstSuccess";

export type ProviderDecision = "unknown" | "ready" | "skipped";
export type ActivationMilestone =
  "page-created" | "content-added" | "command-applied" | "visual-created" | "export-saved";

export interface ActivationProgress {
  version: typeof ACTIVATION_VERSION;
  provider: ProviderDecision;
  setupStep: 0 | 1 | 2;
  milestones: ActivationMilestone[];
  pageId?: string | undefined;
  finished: boolean;
  paused: boolean;
}

type ActivationStorage = Pick<Storage, "getItem" | "setItem">;

const PROVIDER_DECISIONS = new Set<ProviderDecision>(["unknown", "ready", "skipped"]);
const MILESTONES = new Set<ActivationMilestone>([
  "page-created",
  "content-added",
  "command-applied",
  "visual-created",
  "export-saved",
]);

const emptyProgress = (): ActivationProgress => ({
  version: ACTIVATION_VERSION,
  provider: "unknown",
  setupStep: 0,
  milestones: [],
  finished: false,
  paused: false,
});

const browserStorage = (): ActivationStorage | undefined => {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
};

const parseProgress = (value: string | null): ActivationProgress => {
  if (!value) return emptyProgress();
  try {
    const decoded: unknown = JSON.parse(value);
    if (typeof decoded !== "object" || decoded === null) return emptyProgress();
    const parsed = decoded as Record<string, unknown>;
    if (parsed["version"] !== ACTIVATION_VERSION) return emptyProgress();
    const provider = PROVIDER_DECISIONS.has(parsed["provider"] as ProviderDecision)
      ? (parsed["provider"] as ProviderDecision)
      : "unknown";
    const setupStep =
      parsed["setupStep"] === 1 || parsed["setupStep"] === 2 ? parsed["setupStep"] : 0;
    const milestones = Array.isArray(parsed["milestones"])
      ? [
          ...new Set(
            parsed["milestones"].filter((item): item is ActivationMilestone =>
              MILESTONES.has(item as ActivationMilestone),
            ),
          ),
        ]
      : [];
    const pageId =
      typeof parsed["pageId"] === "string" && parsed["pageId"].length > 0
        ? parsed["pageId"]
        : undefined;
    return {
      version: ACTIVATION_VERSION,
      provider,
      setupStep,
      milestones,
      ...(pageId ? { pageId } : {}),
      finished: parsed["finished"] === true,
      paused: parsed["paused"] === true,
    };
  } catch {
    return emptyProgress();
  }
};

export function loadActivationProgress(storage = browserStorage()): ActivationProgress {
  try {
    return parseProgress(storage?.getItem(ACTIVATION_STORAGE_KEY) ?? null);
  } catch {
    return emptyProgress();
  }
}

export function saveActivationProgress(
  progress: ActivationProgress,
  storage = browserStorage(),
): ActivationProgress {
  try {
    storage?.setItem(ACTIVATION_STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // Progress is a convenience. A blocked store must never block Lucid.
  }
  return progress;
}

export function decideProvider(
  progress: ActivationProgress,
  provider: ProviderDecision,
  storage = browserStorage(),
): ActivationProgress {
  return saveActivationProgress({ ...progress, provider }, storage);
}

export function rememberSetupStep(
  progress: ActivationProgress,
  setupStep: 0 | 1 | 2,
  storage = browserStorage(),
): ActivationProgress {
  return saveActivationProgress({ ...progress, setupStep }, storage);
}

export function recordMilestone(
  progress: ActivationProgress,
  milestone: ActivationMilestone,
  storage = browserStorage(),
): ActivationProgress {
  if (progress.milestones.includes(milestone)) return progress;
  return saveActivationProgress(
    { ...progress, milestones: [...progress.milestones, milestone] },
    storage,
  );
}

export function rememberActivationPage(
  progress: ActivationProgress,
  pageId: string,
  storage = browserStorage(),
): ActivationProgress {
  return saveActivationProgress({ ...progress, pageId }, storage);
}

export function finishActivation(
  progress: ActivationProgress,
  storage = browserStorage(),
): ActivationProgress {
  return saveActivationProgress({ ...progress, finished: true, paused: false }, storage);
}

export function pauseActivation(
  progress: ActivationProgress,
  storage = browserStorage(),
): ActivationProgress {
  return saveActivationProgress({ ...progress, paused: true }, storage);
}

export function resumeActivation(
  progress: ActivationProgress,
  storage = browserStorage(),
): ActivationProgress {
  return saveActivationProgress({ ...progress, paused: false }, storage);
}

export function hasBasicFirstSuccess(progress: ActivationProgress): boolean {
  return ["page-created", "content-added", "export-saved"].every((milestone) =>
    progress.milestones.includes(milestone as ActivationMilestone),
  );
}

export function hasAiFirstSuccess(progress: ActivationProgress): boolean {
  return (
    hasBasicFirstSuccess(progress) &&
    progress.milestones.includes("command-applied") &&
    progress.milestones.includes("visual-created")
  );
}
