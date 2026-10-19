import { DEFAULT_LANES, type AiClient, type Lane } from "@lucid/llm";
import { MainProcessAiClient } from "./mainProcessClient";

export interface Model {
  client: AiClient;
  lanes: { input: Lane; command: Lane; advisor: Lane };
  /** The model's short name, for messages. */
  name: string;
}

let cached: Promise<Model> | undefined;

/** Forget the client: the settings changed (another model or address), the next request builds a new one. */
export function resetModel(): void {
  cached = undefined;
}

/** The selected provider and lanes for this window, built from public settings without secrets. */
export function getModel(): Promise<Model> {
  cached ??= window.lucid.settings.get().then((settings) => {
    const profile =
      settings.ai.profiles.find((candidate) => candidate.id === settings.ai.defaultProfileId) ??
      settings.ai.profiles[0];
    if (!profile) throw new Error("Choose an AI provider in Settings.");
    return {
      client: new MainProcessAiClient(profile),
      lanes: {
        input: { ...DEFAULT_LANES.input, model: profile.model },
        command: { ...DEFAULT_LANES.command, model: profile.model },
        advisor: { ...DEFAULT_LANES.advisor, model: profile.model },
      },
      name: profile.model.split("/").pop() ?? profile.model,
    };
  });
  return cached;
}
