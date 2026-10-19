import {
  AnthropicClient,
  LmStudioClient,
  OllamaClient,
  OpenAiClient,
  OpenAiCompatibleClient,
} from "@lucid/llm";
import { loadSettings } from "../settings";
import { providerCredentialId } from "../ipc/types";
import type { AiRuntimeResolver } from "./service";
import { secureProviderFetch } from "./security";

/** Resolve a persisted profile into a main-process adapter. Other providers are added incrementally. */
export const createRuntimeResolver = (
  libraryDir: string,
  doFetch: typeof fetch = fetch,
  environmentUrl: string | undefined = process.env["LUCID_LLM_URL"],
  readCredential: (id: string) => Promise<string | undefined> = () => Promise.resolve(undefined),
): AiRuntimeResolver => {
  return async (profileId) => {
    const settings = await loadSettings(libraryDir);
    const profile = settings.ai.profiles.find((candidate) => candidate.id === profileId);
    if (!profile) return undefined;
    const endpoint = (
      profile.kind === "lmstudio" ? (environmentUrl ?? profile.baseUrl) : profile.baseUrl
    ).replace(/\/+$/, "");
    const providerFetch: typeof fetch = (input, init) => secureProviderFetch(input, init, doFetch);
    const secret =
      profile.kind !== "lmstudio" && profile.kind !== "ollama"
        ? await readCredential(providerCredentialId(profile.id))
        : undefined;
    if (
      profile.kind !== "lmstudio" &&
      profile.kind !== "ollama" &&
      profile.kind !== "custom" &&
      !secret
    )
      return undefined;
    return {
      endpoint,
      ...(secret ? { secrets: [secret] } : {}),
      client:
        profile.kind === "lmstudio"
          ? new LmStudioClient({ baseUrl: endpoint, fetch: providerFetch })
          : profile.kind === "ollama"
            ? new OllamaClient({ baseUrl: endpoint, fetch: providerFetch })
            : profile.kind === "openai"
              ? new OpenAiClient({ apiKey: secret ?? "", baseUrl: endpoint, fetch: providerFetch })
              : profile.kind === "anthropic"
                ? new AnthropicClient({
                    apiKey: secret ?? "",
                    baseUrl: endpoint,
                    fetch: providerFetch,
                  })
                : new OpenAiCompatibleClient({
                    kind: profile.kind,
                    ...(secret ? { apiKey: secret } : {}),
                    baseUrl: endpoint,
                    fetch: providerFetch,
                  }),
    };
  };
};
