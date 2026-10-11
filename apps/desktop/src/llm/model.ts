import { DEFAULT_LANES, LmStudioClient, type Lane } from "@lucid/llm";
import { bridgeFetch } from "./bridgeFetch";

export interface Model {
  client: LmStudioClient;
  lanes: { input: Lane; command: Lane; advisor: Lane };
  /** The model's short name, for messages. */
  name: string;
}

let cached: Promise<Model> | undefined;

/** Forget the client: the settings changed (another model or address), the next request builds a new one. */
export function resetModel(): void {
  cached = undefined;
}

/** The LM Studio client and lanes for this window, built from the settings. */
export function getModel(): Promise<Model> {
  cached ??= window.lucid.settings.get().then((settings) => ({
    client: new LmStudioClient({ baseUrl: settings.llm.baseUrl, fetch: bridgeFetch }),
    lanes: {
      input: { ...DEFAULT_LANES.input, model: settings.llm.model },
      command: { ...DEFAULT_LANES.command, model: settings.llm.model },
      advisor: { ...DEFAULT_LANES.advisor, model: settings.llm.model },
    },
    name: settings.llm.model.split("/").pop() ?? settings.llm.model,
  }));
  return cached;
}
