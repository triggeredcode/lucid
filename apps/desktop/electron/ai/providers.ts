import {
  AI_PROVIDER_CATALOG,
  type ProviderConnectionResult,
  type ProviderProfile,
} from "../ipc/types";
import { redactSensitive, secureProviderFetch } from "./security";

const providerFor = (profile: ProviderProfile) =>
  AI_PROVIDER_CATALOG.find((provider) => provider.kind === profile.kind);

const modelsUrl = (profile: ProviderProfile): string => {
  const base = profile.baseUrl.replace(/\/+$/, "");
  if (profile.kind === "lmstudio") return `${base}/v1/models`;
  if (profile.kind === "ollama") return `${base}/api/tags`;
  return `${base}/models`;
};

const headersFor = (profile: ProviderProfile, secret?: string): Record<string, string> => {
  if (!secret) return { Accept: "application/json" };
  if (profile.kind === "anthropic")
    return {
      Accept: "application/json",
      "x-api-key": secret,
      "anthropic-version": "2023-06-01",
    };
  return { Accept: "application/json", Authorization: `Bearer ${secret}` };
};

const modelIds = (value: unknown, localModelsOnly = false): string[] => {
  if (!value || typeof value !== "object") return [];
  const body = value as { data?: unknown; models?: unknown };
  const entries = Array.isArray(body.data)
    ? body.data
    : Array.isArray(body.models)
      ? body.models
      : [];
  return [
    ...new Set(
      entries
        .map((entry) => {
          if (!entry || typeof entry !== "object") return undefined;
          const item = entry as { id?: unknown; name?: unknown; model?: unknown };
          const id = item.id ?? item.name ?? item.model;
          return typeof id === "string" && id.length <= 240 ? id : undefined;
        })
        .filter(
          (id): id is string => id !== undefined && (!localModelsOnly || !/:cloud$/i.test(id)),
        ),
    ),
  ]
    .sort((a, b) => a.localeCompare(b))
    .slice(0, 1000);
};

/** Check one persisted profile without ever returning its credential or request headers. */
export async function inspectProvider(
  profile: ProviderProfile,
  secret?: string,
  doFetch: typeof fetch = fetch,
): Promise<ProviderConnectionResult> {
  const provider = providerFor(profile);
  if (!provider) return { ok: false, message: "That provider type is not supported." };
  if (provider.credential === "required" && !secret)
    return { ok: false, message: `Add an API key for ${provider.label}, then try again.` };
  try {
    const response = await secureProviderFetch(
      modelsUrl(profile),
      { headers: headersFor(profile, secret) },
      doFetch,
    );
    if (!response.ok)
      return {
        ok: false,
        message: `${provider.label} returned HTTP ${String(response.status)}. Check the address, API key, and account access.`,
      };
    const models = modelIds(await response.json(), profile.kind === "ollama");
    return {
      ok: true,
      message:
        models.length > 0
          ? `Connected to ${provider.label}. ${String(models.length)} model${models.length === 1 ? "" : "s"} available.`
          : profile.kind === "ollama"
            ? "Connected to Ollama, but no local models are installed. Run “ollama pull <model>”, then fetch models again."
            : `Connected to ${provider.label}, but it reported no models.`,
      models,
    };
  } catch (error) {
    return {
      ok: false,
      message:
        profile.kind === "ollama"
          ? `Could not connect to Ollama. Start it with “ollama serve”, then try again. ${redactSensitive(error)}`
          : `Could not connect to ${provider.label}: ${redactSensitive(error, secret ? [secret] : [])}`,
    };
  }
}
