/** @vitest-environment jsdom */

import { DEFAULT_PDF_STYLE } from "@lucid/kit";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublicSettings } from "../../electron/ipc/types";
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
    expect(container.querySelector("h1")?.textContent).toBe("Speak or type the messy version.");

    const next = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Set up Lucid",
    );
    await act(async () => {
      next?.click();
      await Promise.resolve();
    });
    expect(container.querySelector("h1")?.textContent).toBe("Connect an AI provider");
    expect(
      [...container.querySelectorAll("legend")].some((item) => item.textContent === "AI providers"),
    ).toBe(true);

    const skip = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Skip setup",
    );
    act(() => {
      skip?.click();
    });
    expect(finish).toHaveBeenCalledWith(false);
  });
});
