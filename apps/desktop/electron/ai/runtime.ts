import { LmStudioClient, OllamaClient } from "@lucid/llm";
import { loadSettings } from "../settings";
import type { AiRuntimeResolver } from "./service";
import { secureProviderFetch } from "./security";

/** Resolve a persisted profile into a main-process adapter. Other providers are added incrementally. */
export const createRuntimeResolver = (
  libraryDir: string,
  doFetch: typeof fetch = fetch,
  environmentUrl: string | undefined = process.env["LUCID_LLM_URL"],
): AiRuntimeResolver => {
  return async (profileId) => {
    const settings = await loadSettings(libraryDir);
    const profile = settings.ai.profiles.find((candidate) => candidate.id === profileId);
    if (!profile || (profile.kind !== "lmstudio" && profile.kind !== "ollama")) return undefined;
    const endpoint = (
      profile.kind === "lmstudio" ? (environmentUrl ?? profile.baseUrl) : profile.baseUrl
    ).replace(/\/+$/, "");
    const providerFetch: typeof fetch = (input, init) => secureProviderFetch(input, init, doFetch);
    return {
      endpoint,
      client:
        profile.kind === "lmstudio"
          ? new LmStudioClient({ baseUrl: endpoint, fetch: providerFetch })
          : new OllamaClient({ baseUrl: endpoint, fetch: providerFetch }),
    };
  };
};
