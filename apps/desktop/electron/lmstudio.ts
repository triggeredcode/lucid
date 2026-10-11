import { execFile } from "node:child_process";
import type { LmLoadResult, LmStatus } from "./ipc/types";

export interface Run {
  (
    bin: string,
    args: string[],
    timeoutMs: number,
  ): Promise<{ code: number; stdout: string; stderr: string }>;
}

export interface LmDeps {
  baseUrl: string;
  /** The model Lucid is set to use (an LM Studio model key such as qwen/qwen3.8-27b). */
  model: string;
  contextLength: number;
  /** Path of the `lms` tool. */
  lms: string;
  fetch?: typeof fetch;
  run?: Run;
  /** Whether LM Studio is installed on this computer (asked only when it is not running). */
  studioInstalled?: () => boolean;
  /** What `lms ls` said, kept for a while so polling the status does not start a program every few seconds. */
  cache?: Map<string, { at: number; value: { found?: Downloaded; problem?: string } }>;
}

const sharedCache: NonNullable<LmDeps["cache"]> = new Map();
const CACHE_MS = 30_000;

/** Runs a program without a shell and never throws: a missing program is exit code 127. */
export const runProgram: Run = (bin, args, timeoutMs) =>
  new Promise((resolve) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 8_000_000 }, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === "number" ? error.code : 127) : 0;
      resolve({ code, stdout, stderr: stderr || (error?.message ?? "") });
    });
  });

/** Model keys and identifiers go to the command line, so only plain characters are allowed. */
const SAFE_ID = /^[\w][\w./@:+-]{0,200}$/;

interface Downloaded {
  modelKey?: unknown;
  displayName?: unknown;
  sizeBytes?: unknown;
  type?: unknown;
}

async function downloaded(deps: LmDeps): Promise<{ found?: Downloaded; problem?: string }> {
  const cache = deps.cache ?? sharedCache;
  const key = `${deps.lms}|${deps.model}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = await downloadedUncached(deps);
  cache.set(key, { at: Date.now(), value });
  return value;
}

async function downloadedUncached(deps: LmDeps): Promise<{ found?: Downloaded; problem?: string }> {
  const run = deps.run ?? runProgram;
  const r = await run(deps.lms, ["ls", "--json"], 15_000);
  if (r.code === 127)
    return {
      problem: "LM Studio's `lms` tool was not found, so Lucid cannot load the model for you.",
    };
  if (r.code !== 0) return { problem: "`lms ls` failed. Is LM Studio installed?" };
  try {
    const list = JSON.parse(r.stdout) as Downloaded[];
    const found = list.find((m) => m.modelKey === deps.model && m.type !== "embedding");
    return found ? { found } : { problem: `${deps.model} is not downloaded in LM Studio.` };
  } catch {
    return { problem: "Could not read the list of models from `lms`." };
  }
}

async function loadedModels(deps: LmDeps): Promise<string[] | undefined> {
  const doFetch = deps.fetch ?? fetch;
  try {
    const res = await doFetch(`${deps.baseUrl.replace(/\/+$/, "")}/v1/models`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: { id?: unknown }[] };
    return (json.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === "string");
  } catch {
    return undefined;
  }
}

const shortName = (key: string): string => key.split("/").pop() ?? key;

/** How LM Studio is doing for the configured model, and whether Lucid could load it. */
export async function lmStatus(deps: LmDeps): Promise<LmStatus> {
  const loaded = await loadedModels(deps);
  const base = { model: deps.model, name: shortName(deps.model), loaded: loaded ?? [] };
  if (loaded === undefined)
    return {
      ...base,
      state: "down",
      canLoad: false,
      studioInstalled: deps.studioInstalled?.() ?? false,
      problem: "LM Studio is not running. Open it and start its local server.",
    };
  if (loaded.includes(deps.model)) return { ...base, state: "ready", canLoad: false };
  const state = loaded.length === 0 ? "no-model" : "wrong-model";
  if (!SAFE_ID.test(deps.model))
    return {
      ...base,
      state,
      canLoad: false,
      problem: "The model name in the settings is not valid.",
    };
  const { found, problem } = await downloaded(deps);
  return {
    ...base,
    state,
    canLoad: found !== undefined,
    ...(typeof found?.displayName === "string" ? { name: found.displayName } : {}),
    ...(typeof found?.sizeBytes === "number" ? { sizeBytes: found.sizeBytes } : {}),
    ...(problem ? { problem } : {}),
  };
}

let loading: Promise<LmLoadResult> | undefined;

/**
 * Loads the configured model, one big model at a time: whatever else is loaded is unloaded first. Only the model in the
 * settings can be loaded, and only after the person agreed in the app (the caller's job). One load at a time.
 */
export function lmLoad(deps: LmDeps): Promise<LmLoadResult> {
  loading ??= doLoad(deps).finally(() => {
    loading = undefined;
  });
  return loading;
}

async function doLoad(deps: LmDeps): Promise<LmLoadResult> {
  const run = deps.run ?? runProgram;
  const status = await lmStatus(deps);
  if (status.state === "ready") return { ok: true };
  if (status.state === "down")
    return { ok: false, message: status.problem ?? "LM Studio is not running." };
  if (!status.canLoad)
    return { ok: false, message: status.problem ?? "The model cannot be loaded." };
  for (const id of status.loaded) {
    if (!SAFE_ID.test(id)) return { ok: false, message: `Not unloading "${id}": odd name.` };
    const u = await run(deps.lms, ["unload", id], 60_000);
    if (u.code !== 0)
      return { ok: false, message: `Could not unload ${id}. ${u.stderr.trim()}`.trim() };
  }
  const r = await run(
    deps.lms,
    ["load", deps.model, "--context-length", String(deps.contextLength), "--parallel", "1", "-y"],
    300_000,
  );
  if (r.code !== 0)
    return {
      ok: false,
      message: `LM Studio could not load ${status.name}. ${r.stderr.trim()}`.trim(),
    };
  const after = await lmStatus(deps);
  return after.state === "ready"
    ? { ok: true }
    : { ok: false, message: "The model was loaded but LM Studio does not list it yet." };
}
