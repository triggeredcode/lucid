/** @vitest-environment jsdom */

import { DEFAULT_PDF_STYLE } from "@lucid/kit";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublicSettings } from "../../electron/ipc/types";
import { decideProvider, loadActivationProgress, rememberSetupStep } from "./activation";
import { FirstRun } from "./FirstRun";

const settings: PublicSettings = {
  author: "",
  footerRight: "",
  pdf: DEFAULT_PDF_STYLE,
  dictation: { autoSendMs: 450 },
  vocabulary: [],
  llm: {
    baseUrl: "http://127.0.0.1:1234",
    model: "qwen/qwen3.8-27b",
    contextLength: 32768,
  },
  ai: {
    defaultProfileId: "lmstudio",
    profiles: [
      {
        id: "lmstudio",
        name: "LM Studio",
        kind: "lmstudio",
        baseUrl: "http://127.0.0.1:1234",
        model: "qwen/qwen3.8-27b",
      },
    ],
  },
  llmUrlLocked: false,
  onboardingDisabled: false,
};

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  if (root)
    act(() => {
      root?.unmount();
    });
  container?.remove();
  root = undefined;
  container = undefined;
  localStorage.clear();
});

describe("FirstRun", () => {
  it("starts with a welcome, reaches provider setup, and can be skipped", async () => {
    Object.defineProperty(window, "lucid", {
      configurable: true,
      value: {
        credentials: {
          status: vi.fn().mockResolvedValue({
            present: false,
            storage: "none",
            securePersistenceAvailable: true,
          }),
        },
      },
    });
    const finish = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<FirstRun settings={settings} onSettingsChange={vi.fn()} onFinish={finish} />);
      await Promise.resolve();
    });
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(container.querySelector("h1")?.textContent).toBe(
      "Start with the thought, not the setup.",
    );

    const next = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Connect AI",
    );
    await act(async () => {
      next?.click();
      await Promise.resolve();
    });
    expect(container.querySelector("h1")?.textContent).toBe("Connect AI");
    expect(
      [...container.querySelectorAll("legend")].some((item) => item.textContent === "AI providers"),
    ).toBe(true);

    const skip = container.querySelector<HTMLButtonElement>('[aria-label="Skip setup"]');
    act(() => {
      skip?.click();
    });
    expect(finish).toHaveBeenCalledWith(false);
  });

  it("makes continuing without AI explicit and remembers that choice", async () => {
    Object.defineProperty(window, "lucid", {
      configurable: true,
      value: {
        credentials: {
          status: vi.fn().mockResolvedValue({
            present: false,
            storage: "none",
            securePersistenceAvailable: true,
          }),
        },
        settings: {
          save: vi.fn().mockResolvedValue({ ok: true, settings }),
        },
      },
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const view = container;
    const finish = vi.fn();

    await act(async () => {
      root?.render(<FirstRun settings={settings} onSettingsChange={vi.fn()} onFinish={finish} />);
      await Promise.resolve();
    });
    await act(async () => {
      [...view.querySelectorAll("button")]
        .find((button) => button.textContent === "Connect AI")
        ?.click();
      await Promise.resolve();
    });

    const normalContinue = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Use this provider",
    );
    expect(normalContinue?.disabled).toBe(true);
    await act(async () => {
      [...view.querySelectorAll("button")]
        .find((button) => button.textContent === "Continue without AI")
        ?.click();
      await Promise.resolve();
    });

    expect(finish).toHaveBeenCalledWith(true);
    expect(loadActivationProgress().provider).toBe("skipped");
  });

  it("continues after the selected provider and model are verified", async () => {
    Object.defineProperty(window, "lucid", {
      configurable: true,
      value: {
        credentials: {
          status: vi.fn().mockResolvedValue({
            present: false,
            storage: "none",
            securePersistenceAvailable: true,
          }),
        },
        settings: {
          save: vi.fn().mockResolvedValue({ ok: true, settings }),
        },
        providers: {
          test: vi.fn().mockResolvedValue({
            ok: true,
            message: "Connected to LM Studio. 1 model available.",
            models: ["qwen/qwen3.8-27b"],
          }),
          models: vi.fn(),
        },
      },
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const view = container;

    await act(async () => {
      root?.render(<FirstRun settings={settings} onSettingsChange={vi.fn()} onFinish={vi.fn()} />);
      await Promise.resolve();
    });
    await act(async () => {
      [...view.querySelectorAll("button")]
        .find((button) => button.textContent === "Connect AI")
        ?.click();
      await Promise.resolve();
    });
    await act(async () => {
      [...view.querySelectorAll("button")]
        .find((button) => button.textContent === "Test connection")
        ?.click();
      await Promise.resolve();
    });

    expect(
      container.querySelector('.onboarding-readiness[data-state="ready"]')?.textContent,
    ).toContain("Ready");
    const normalContinue = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Use this provider",
    );
    expect(normalContinue?.disabled).toBe(false);
    expect(loadActivationProgress().provider).toBe("ready");
  });

  it("resumes an unfinished verified setup after a restart", async () => {
    const ready = decideProvider(loadActivationProgress(), "ready");
    rememberSetupStep(ready, 1);
    Object.defineProperty(window, "lucid", {
      configurable: true,
      value: {
        credentials: {
          status: vi.fn().mockResolvedValue({
            present: false,
            storage: "none",
            securePersistenceAvailable: true,
          }),
        },
      },
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<FirstRun settings={settings} onSettingsChange={vi.fn()} onFinish={vi.fn()} />);
      await Promise.resolve();
    });

    expect(container.querySelector("h1")?.textContent).toBe("Connect AI");
    expect(container.querySelector('.onboarding-readiness[data-state="ready"]')).not.toBeNull();
    expect(
      [...container.querySelectorAll("button")].find(
        (button) => button.textContent === "Use this provider",
      )?.disabled,
    ).toBe(false);
  });
});
