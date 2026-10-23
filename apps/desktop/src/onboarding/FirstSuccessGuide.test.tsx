/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActivationProgress } from "./activation";
import { FirstSuccessGuide } from "./FirstSuccessGuide";

const progress = (overrides: Partial<ActivationProgress> = {}): ActivationProgress => ({
  version: "1",
  provider: "skipped",
  setupStep: 0,
  milestones: [],
  finished: false,
  paused: false,
  ...overrides,
});

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

function renderGuide(value: ActivationProgress, handlers = { create: vi.fn(), finish: vi.fn() }) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <FirstSuccessGuide
        progress={value}
        onCreatePage={handlers.create}
        onPause={vi.fn()}
        onFinish={handlers.finish}
      />,
    );
  });
  return handlers;
}

describe("FirstSuccessGuide", () => {
  it("starts with a real page action", () => {
    const handlers = renderGuide(progress());
    if (!container) throw new Error("Guide was not rendered");
    const button = [...container.querySelectorAll("button")].find(
      (item) => item.textContent === "New page",
    );
    act(() => button?.click());
    expect(handlers.create).toHaveBeenCalledOnce();
  });

  it("uses the offline route and finishes only after an export", () => {
    renderGuide(progress({ milestones: ["page-created"] }));
    expect(container?.querySelector("h2")?.textContent).toBe("Write on the page");
    expect(container?.textContent).toContain("Choose Edit");

    act(() => {
      root?.render(
        <FirstSuccessGuide
          progress={progress({
            milestones: ["page-created", "content-added", "export-saved"],
          })}
          onCreatePage={vi.fn()}
          onPause={vi.fn()}
          onFinish={vi.fn()}
        />,
      );
    });
    expect(container?.querySelector("h2")?.textContent).toBe("Your first page is ready");
    expect(container?.textContent).toContain("Finish");
  });

  it("guides a ready provider through command and visual milestones", () => {
    renderGuide(progress({ provider: "ready", milestones: ["page-created", "content-added"] }));
    expect(container?.querySelector("h2")?.textContent).toBe("Make one change");
    expect(container?.textContent).toContain("Choose Command");
  });
});
