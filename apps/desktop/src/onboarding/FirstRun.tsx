import { useEffect, useRef, useState } from "react";
import type {
  AiSettings,
  ProviderConnectionResult,
  ProviderProfile,
  PublicSettings,
  SettingsInput,
} from "../../electron/ipc/types";
import { ProviderSettings } from "../settings/ProviderSettings";
import { saveSettings } from "../settings/settingsStore";
import { BrandMark } from "../ui/BrandMark";
import { decideProvider, loadActivationProgress, rememberSetupStep } from "./activation";

interface Props {
  settings: PublicSettings;
  onSettingsChange: (settings: PublicSettings) => void;
  onFinish: (startTour: boolean) => void;
}

const providerIsReady = (
  result: ProviderConnectionResult | undefined,
  profile: ProviderProfile,
): boolean =>
  result?.ok === true &&
  profile.model.trim().length > 0 &&
  Array.isArray(result.models) &&
  result.models.includes(profile.model);

const settingsWithAi = (settings: PublicSettings, ai: AiSettings): SettingsInput => {
  const selected = ai.profiles.find((profile) => profile.id === ai.defaultProfileId);
  return {
    author: settings.author,
    footerRight: settings.footerRight,
    pdf: settings.pdf,
    dictation: settings.dictation,
    vocabulary: settings.vocabulary,
    llm: {
      baseUrl: selected?.kind === "lmstudio" ? selected.baseUrl : settings.llm.baseUrl,
      model: selected?.kind === "lmstudio" ? selected.model : settings.llm.model,
      contextLength: settings.llm.contextLength,
    },
    ai,
  };
};

/**
 * First run only asks for the one decision that can block the experience: whether to connect AI now.
 * Product learning happens afterwards, on the real workspace, beside the control being introduced.
 */
export function FirstRun({ settings, onSettingsChange, onFinish }: Props) {
  const [step, setStep] = useState<"welcome" | "provider">(() =>
    loadActivationProgress().setupStep === 1 ? "provider" : "welcome",
  );
  const [ai, setAi] = useState(settings.ai);
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState<string>();
  const [providerConnection, setProviderConnection] = useState<ProviderConnectionResult>();
  const [activation, setActivation] = useState(loadActivationProgress);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus();
  }, [step]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onFinish(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [onFinish]);

  const persistAi = async (): Promise<boolean> => {
    setWorking(true);
    setProblem(undefined);
    try {
      const result = await saveSettings(settingsWithAi(settings, ai));
      if (!result.ok) {
        setProblem(result.problems.join(" "));
        return false;
      }
      onSettingsChange(result.settings);
      return true;
    } catch (error) {
      setProblem(
        error instanceof Error ? error.message : "The provider settings could not be saved.",
      );
      return false;
    } finally {
      setWorking(false);
    }
  };

  const openProvider = () => {
    setStep("provider");
    setActivation((current) => rememberSetupStep(current, 1));
  };

  const startWithoutAi = async () => {
    if (step === "provider" && !(await persistAi())) return;
    const next = rememberSetupStep(decideProvider(loadActivationProgress(), "skipped"), 0);
    setActivation(next);
    onFinish(true);
  };

  const startWithProvider = async () => {
    if (!(await persistAi())) return;
    const next = rememberSetupStep(decideProvider(loadActivationProgress(), "ready"), 0);
    setActivation(next);
    onFinish(true);
  };

  const providerState =
    activation.provider === "ready" ? "ready" : providerConnection ? "attention" : "unchecked";

  return (
    <div className="modal-backdrop onboarding-backdrop">
      <section
        className="modal onboarding onboarding-minimal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
      >
        <header className="onboarding-header">
          <div className="onboarding-brand">
            <BrandMark />
            <span>Lucid</span>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Skip setup"
            title="Skip setup"
            onClick={() => {
              onFinish(false);
            }}
          >
            ×
          </button>
        </header>

        <div className="onboarding-content">
          {step === "welcome" ? (
            <div className="onboarding-intro">
              <h1 id="onboarding-title" ref={heading} tabIndex={-1}>
                Start with the thought, not the setup.
              </h1>
              <p className="onboarding-lead">
                Write directly, or connect an AI provider to turn rough input into structured pages.
              </p>
              <ul className="onboarding-facts">
                <li>Your pages stay on this computer.</li>
                <li>You can connect or change AI later in Settings.</li>
              </ul>
              <div className="onboarding-choice">
                <button type="button" className="primary" onClick={() => void startWithoutAi()}>
                  Start writing
                </button>
                <button type="button" className="ghost" onClick={openProvider}>
                  Connect AI
                </button>
              </div>
            </div>
          ) : (
            <div className="onboarding-provider">
              <button
                type="button"
                className="link onboarding-back"
                onClick={() => {
                  setStep("welcome");
                  setActivation((current) => rememberSetupStep(current, 0));
                }}
              >
                ← Back
              </button>
              <h1 id="onboarding-title" ref={heading} tabIndex={-1}>
                Connect AI
              </h1>
              <p className="onboarding-lead">
                Use a local model with LM Studio or Ollama, or add an OpenAI-compatible cloud
                provider.
              </p>
              <ProviderSettings
                value={ai}
                lmStudioUrlLocked={settings.llmUrlLocked}
                onChange={setAi}
                onPersist={persistAi}
                onConnectionChange={(result, profile) => {
                  setProviderConnection(result);
                  setActivation((current) => {
                    if (providerIsReady(result, profile)) return decideProvider(current, "ready");
                    if (current.provider === "ready") return decideProvider(current, "unknown");
                    return current;
                  });
                }}
              />
              <div
                className="onboarding-readiness"
                data-state={providerState}
                role="status"
                aria-live="polite"
              >
                <i aria-hidden="true" />
                <span>
                  <strong>
                    {providerState === "ready"
                      ? "Ready"
                      : providerState === "attention"
                        ? "Connection needs attention"
                        : "Test the connection when your model is running"}
                  </strong>
                </span>
              </div>
              {problem && (
                <p className="onboarding-problem" role="alert">
                  {problem}
                </p>
              )}
              <div className="onboarding-choice provider-choice">
                <button
                  type="button"
                  className="ghost"
                  disabled={working}
                  onClick={() => void startWithoutAi()}
                >
                  Continue without AI
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={working || providerState !== "ready"}
                  onClick={() => void startWithProvider()}
                >
                  {working ? "Saving…" : "Use this provider"}
                </button>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
