import { describe, expect, it } from "vitest";
import { EngineStatus } from "./engineStatus";

const running = { phase: "warmup", files: 12 } as const;
const ready = { phase: "warmup", files: 0, done: true } as const;
const failed = { phase: "warmup", files: 0, done: true, message: "needs the internet" } as const;

describe("EngineStatus", () => {
  it("is empty until the preparation starts", () => {
    expect(new EngineStatus().read()).toBeNull();
  });

  it("tells a window that opens late that it is running, as often as it asks", () => {
    const s = new EngineStatus();
    s.report(running);
    expect(s.read()).toEqual(running);
    expect(s.read()).toEqual(running);
  });

  it("keeps a failure for a window that opens after it, and hands it over once", () => {
    const s = new EngineStatus();
    s.report(running);
    s.report(failed);
    expect(s.read()).toEqual(failed);
    expect(s.read()).toBeNull();
  });

  it("has nothing to say when the preparation worked", () => {
    const s = new EngineStatus();
    s.report(running);
    s.report(ready);
    expect(s.read()).toBeNull();
  });

  it("forgets an old failure when the preparation starts again, and ignores the progress of a page being made", () => {
    const s = new EngineStatus();
    s.report(failed);
    s.report({ phase: "pdf", files: 3 });
    s.report(running);
    expect(s.read()).toEqual(running);
    s.report(ready);
    expect(s.read()).toBeNull();
  });
});
