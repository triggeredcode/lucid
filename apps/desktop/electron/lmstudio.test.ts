import { describe, expect, it } from "vitest";
import { lmLoad, lmStatus, type LmDeps, type Run } from "./lmstudio";

const LS = JSON.stringify([
  {
    type: "llm",
    modelKey: "qwen/qwen3.8-27b",
    displayName: "Qwen3.8 27B",
    sizeBytes: 16_000_000_000,
  },
  { type: "embedding", modelKey: "text-embed", displayName: "Embed", sizeBytes: 1 },
]);

function setup(opts: {
  loaded: string[] | "down";
  ls?: string;
  failLoad?: boolean;
  lmsMissing?: boolean;
}) {
  const calls: string[][] = [];
  let loaded = opts.loaded;
  const run: Run = (_bin, args) => {
    calls.push(args);
    if (opts.lmsMissing) return Promise.resolve({ code: 127, stdout: "", stderr: "ENOENT" });
    if (args[0] === "ls") return Promise.resolve({ code: 0, stdout: opts.ls ?? LS, stderr: "" });
    if (args[0] === "unload") {
      loaded = Array.isArray(loaded) ? loaded.filter((m) => m !== args[1]) : loaded;
      return Promise.resolve({ code: 0, stdout: "", stderr: "" });
    }
    if (opts.failLoad) return Promise.resolve({ code: 1, stdout: "", stderr: "out of memory" });
    loaded = ["qwen/qwen3.8-27b"];
    return Promise.resolve({ code: 0, stdout: "", stderr: "" });
  };
  const fakeFetch = (() =>
    loaded === "down"
      ? Promise.reject(new Error("connect ECONNREFUSED"))
      : Promise.resolve(
          new Response(JSON.stringify({ data: loaded.map((id) => ({ id })) }), { status: 200 }),
        )) as unknown as typeof fetch;
  const deps: LmDeps = {
    baseUrl: "http://127.0.0.1:1234",
    model: "qwen/qwen3.8-27b",
    contextLength: 32768,
    lms: "lms",
    fetch: fakeFetch,
    run,
    cache: new Map(),
  };
  return { deps, calls };
}

describe("lmStatus", () => {
  it("is ready when the configured model is loaded, without asking `lms`", async () => {
    const { deps, calls } = setup({ loaded: ["qwen/qwen3.8-27b"] });
    expect(await lmStatus(deps)).toMatchObject({ state: "ready", canLoad: false });
    expect(calls).toEqual([]);
  });

  it("says LM Studio is down when it cannot be reached", async () => {
    const { deps } = setup({ loaded: "down" });
    const s = await lmStatus(deps);
    expect(s.state).toBe("down");
    expect(s.problem).toContain("not running");
    // Whether LM Studio is installed here is told only when it is not running, so the window can offer the right thing.
    expect(s.studioInstalled).toBe(false);
    expect((await lmStatus({ ...deps, studioInstalled: () => true })).studioInstalled).toBe(true);
    expect((await lmStatus({ ...deps, studioInstalled: () => false })).studioInstalled).toBe(false);
  });

  it("does not look for LM Studio when it is running", async () => {
    const { deps } = setup({ loaded: ["qwen/qwen3.8-27b"] });
    let asked = false;
    const s = await lmStatus({
      ...deps,
      studioInstalled: () => {
        asked = true;
        return true;
      },
    });
    expect(s.state).toBe("ready");
    expect(asked).toBe(false);
  });

  it("offers to load when nothing is loaded and the model is downloaded", async () => {
    const { deps } = setup({ loaded: [] });
    expect(await lmStatus(deps)).toMatchObject({
      state: "no-model",
      canLoad: true,
      name: "Qwen3.8 27B",
      sizeBytes: 16_000_000_000,
    });
  });

  it("notices another model is loaded", async () => {
    const { deps } = setup({ loaded: ["gemma-4"] });
    expect(await lmStatus(deps)).toMatchObject({
      state: "wrong-model",
      loaded: ["gemma-4"],
      canLoad: true,
    });
  });

  it("explains why it cannot load: no lms, or not downloaded", async () => {
    expect((await lmStatus(setup({ loaded: [], lmsMissing: true }).deps)).problem).toContain(
      "`lms`",
    );
    const none = await lmStatus(setup({ loaded: [], ls: "[]" }).deps);
    expect(none).toMatchObject({ canLoad: false });
    expect(none.problem).toContain("is not downloaded");
  });

  it("asks `lms` only once in a while, however often the status is read", async () => {
    const { deps, calls } = setup({ loaded: [] });
    await lmStatus(deps);
    await lmStatus(deps);
    await lmStatus(deps);
    expect(calls.filter((c) => c[0] === "ls")).toHaveLength(1);
  });

  it("never passes an odd model name to the command line", async () => {
    const { deps, calls } = setup({ loaded: [] });
    const s = await lmStatus({ ...deps, model: "x; rm -rf /" });
    expect(s.canLoad).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe("lmLoad", () => {
  it("unloads what is loaded, then loads the model with one slot", async () => {
    const { deps, calls } = setup({ loaded: ["gemma-4", "other"] });
    expect(await lmLoad(deps)).toEqual({ ok: true });
    expect(calls).toEqual([
      ["ls", "--json"],
      ["unload", "gemma-4"],
      ["unload", "other"],
      ["load", "qwen/qwen3.8-27b", "--context-length", "32768", "--parallel", "1", "-y"],
    ]);
  });

  it("does nothing when it is already ready", async () => {
    const { deps, calls } = setup({ loaded: ["qwen/qwen3.8-27b"] });
    expect(await lmLoad(deps)).toEqual({ ok: true });
    expect(calls).toEqual([]);
  });

  it("reports a failed load in plain words", async () => {
    const { deps } = setup({ loaded: [], failLoad: true });
    const r = await lmLoad(deps);
    expect(r).toMatchObject({ ok: false });
    expect(r.ok ? "" : r.message).toContain("out of memory");
  });

  it("refuses when LM Studio is down or the model is not downloaded", async () => {
    expect(await lmLoad(setup({ loaded: "down" }).deps)).toMatchObject({ ok: false });
    const { deps, calls } = setup({ loaded: [], ls: "[]" });
    expect(await lmLoad(deps)).toMatchObject({ ok: false });
    expect(calls.some((c) => c[0] === "load")).toBe(false);
  });

  it("runs one load at a time", async () => {
    const { deps, calls } = setup({ loaded: [] });
    const [a, b] = await Promise.all([lmLoad(deps), lmLoad(deps)]);
    expect(a).toEqual({ ok: true });
    expect(b).toEqual({ ok: true });
    expect(calls.filter((c) => c[0] === "load")).toHaveLength(1);
  });
});
