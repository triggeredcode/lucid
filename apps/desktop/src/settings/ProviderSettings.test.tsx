/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiSettings } from "../../electron/ipc/types";
import { ProviderSettings } from "./ProviderSettings";

const settings: AiSettings = {
  defaultProfileId: "local",
  profiles: [
    {
      id: "local",
      name: "Local",
      kind: "lmstudio",
      baseUrl: "http://127.0.0.1:1234",
      model: "local/model",
    },
  ],
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

describe("ProviderSettings", () => {
  it("shows a recoverable error when the provider IPC call rejects", async () => {
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
        providers: {
          test: vi.fn().mockRejectedValue(new Error("IPC failed")),
          models: vi.fn(),
        },
      },
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const connectionChanged = vi.fn();

    await act(async () => {
      root?.render(
        <ProviderSettings
          value={settings}
          lmStudioUrlLocked={false}
          onChange={vi.fn()}
          onPersist={vi.fn().mockResolvedValue(true)}
          onConnectionChange={connectionChanged}
        />,
      );
      await Promise.resolve();
    });
    const button = [...container.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === "Test connection",
    );
    expect(button).toBeDefined();

    await act(async () => {
      button?.click();
      await Promise.resolve();
    });

    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "The connection check could not finish. Try again.",
    );
    expect(connectionChanged).toHaveBeenLastCalledWith(
      { ok: false, message: "The connection check could not finish. Try again." },
      settings.profiles[0],
    );
    expect(button?.disabled).toBe(false);
  });

  it("reports a successful model inspection to its parent", async () => {
    const result = {
      ok: true,
      message: "Connected to LM Studio. 1 model available.",
      models: ["local/model"],
    };
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
        providers: {
          test: vi.fn().mockResolvedValue(result),
          models: vi.fn(),
        },
      },
    });
    const connectionChanged = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <ProviderSettings
          value={settings}
          lmStudioUrlLocked={false}
          onChange={vi.fn()}
          onPersist={vi.fn().mockResolvedValue(true)}
          onConnectionChange={connectionChanged}
        />,
      );
      await Promise.resolve();
    });
    const test = [...container.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === "Test connection",
    );
    await act(async () => {
      test?.click();
      await Promise.resolve();
    });

    expect(connectionChanged).toHaveBeenLastCalledWith(result, settings.profiles[0]);
  });
});
