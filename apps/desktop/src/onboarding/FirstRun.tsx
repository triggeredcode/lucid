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

const STEP_NAMES = ["Welcome", "Connect AI", "Your workspace"] as const;

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

export function FirstRun({ settings, onSettingsChange, onFinish }: Props) {
  const [step, setStep] = useState<0 | 1 | 2>(() => loadActivationProgress().setupStep);
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

  const next = async () => {
    if (step === 1 && !(await persistAi())) return;
    const nextStep = Math.min(step + 1, STEP_NAMES.length - 1) as 0 | 1 | 2;
    setStep(nextStep);
    setActivation((current) => rememberSetupStep(current, nextStep));
  };

  const continueWithoutAi = async () => {
    if (!(await persistAi())) return;
    setActivation((current) => rememberSetupStep(decideProvider(current, "skipped"), 2));
    setStep(2);
  };

  const providerState =
    activation.provider === "ready"
      ? "ready"
      : providerConnection
        ? "attention"
        : activation.provider === "skipped"
          ? "skipped"
          : "unchecked";

  return (
    <div className="modal-backdrop onboarding-backdrop">
      <section
        className="modal settings onboarding"
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
      >
        <aside className="onboarding-rail" aria-label="Setup progress">
          <div className="onboarding-brand">
            <BrandMark />
            <span>Lucid</span>
          </div>
          <ol>
            {STEP_NAMES.map((name, index) => (
              <li key={name} data-current={step === index} data-done={step > index}>
                <span>{step > index ? "✓" : index + 1}</span>
                {name}
              </li>
            ))}
          </ol>
          <button
            type="button"
            className="link onboarding-skip"
            onClick={() => {
              onFinish(false);
            }}
          >
            Skip setup
          </button>
        </aside>

        <div className="onboarding-content">
          {step === 0 && (
            <div className="onboarding-welcome">
              <div className="thoughts-to-page" aria-hidden="true">
                <span className="thought thought-one">rough idea</span>
                <span className="thought thought-two">and then…</span>
                <span className="thought thought-three">connect these</span>
                <div className="thought-line" />
                <div className="ordered-page">
                  <i />
                  <i />
                  <i />
                  <b />
                </div>
              </div>
              <p className="onboarding-kicker">A quieter way to think</p>
              <h1 id="onboarding-title" ref={heading} tabIndex={-1}>
                Speak or type the messy version.
              </h1>
              <p>
                Lucid turns it into a clear page, then helps you revise it, build diagrams and
                tables, and export the result.
              </p>
              <div className="onboarding-promise">
                <span>Your pages stay on this computer.</span>
                <span>AI is optional and always chosen by you.</span>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="onboarding-provider">
              <p className="onboarding-kicker">Choose where Lucid thinks</p>
              <h1 id="onboarding-title" ref={heading} tabIndex={-1}>
                Connect an AI provider
              </h1>
              <p className="onboarding-lead">
                For LM Studio or Ollama, keep the local server running while you use Lucid. For a
                cloud provider, add its API key below; keys use the system’s secure credential
                store.
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
                      ? "AI ready"
                      : providerState === "skipped"
                        ? "Continuing without AI"
                        : providerState === "attention"
                          ? "Connection needs attention"
                          : "Check your provider before continuing"}
                  </strong>
                  {providerState === "ready"
                    ? " The selected model was found."
                    : providerState === "skipped"
                      ? " You can connect one later in Settings."
                      : providerState === "attention"
                        ? " Follow the message above, then test it again."
                        : " Use Test connection after choosing a model."}
                </span>
              </div>
              <p className="onboarding-note">
                AI is optional. Notes, manual editing, import and export still work without it.
              </p>
            </div>
          )}

          {step === 2 && (
            <div className="onboarding-workspace">
              <p className="onboarding-kicker">Three places to remember</p>
              <h1 id="onboarding-title" ref={heading} tabIndex={-1}>
                Everything happens around one page
              </h1>
              <div className="workspace-map" aria-hidden="true">
                <div className="map-sidebar">
                  <i />
                  <i />
                  <i />
                </div>
                <div className="map-page">
                  <b />
                  <i />
                  <i />
                  <i />
                </div>
                <div className="map-modes">
                  <span>Input</span>
                  <span>Command</span>
                  <span>Diagram</span>
                </div>
                <div className="map-export">PDF</div>
              </div>
              <dl className="onboarding-ways">
                <div>
                  <dt>Input</dt>
                  <dd>Capture rough thoughts as structured notes.</dd>
                </div>
                <div>
                  <dt>Command</dt>
                  <dd>Ask for a precise change to the page.</dd>
                </div>
                <div>
                  <dt>Diagram and table</dt>
                  <dd>Build visual structure step by step.</dd>
                </div>
              </dl>
              <p className="onboarding-note">
                Next, Lucid will point out pages, modes and export in the real workspace.
              </p>
            </div>
          )}

          {problem && (
            <p className="onboarding-problem" role="alert">
              {problem}
            </p>
          )}
          <footer className="onboarding-actions">
            {step > 0 && (
              <button
                type="button"
                className="ghost"
                disabled={working}
                onClick={() => {
                  const previous = (step - 1) as 0 | 1;
                  setStep(previous);
                  setActivation((current) => rememberSetupStep(current, previous));
                }}
              >
                Back
              </button>
            )}
            <span />
            {step < STEP_NAMES.length - 1 ? (
              <>
                {step === 1 && activation.provider !== "ready" && (
                  <button
                    type="button"
                    className="ghost"
                    disabled={working}
                    onClick={() => void continueWithoutAi()}
                  >
                    Continue without AI
                  </button>
                )}
                <button
                  type="button"
                  className="primary"
                  disabled={
                    working ||
                    (step === 1 &&
                      activation.provider !== "ready" &&
                      activation.provider !== "skipped")
                  }
                  onClick={() => void next()}
                >
                  {working ? "Saving…" : step === 0 ? "Set up Lucid" : "Continue"}
                </button>
              </>
            ) : (
              <button
                type="button"
                className="primary"
                onClick={() => {
                  setActivation((current) => rememberSetupStep(current, 0));
                  onFinish(true);
                }}
              >
                Open my workspace
              </button>
            )}
          </footer>
        </div>
      </section>
    </div>
  );
}
