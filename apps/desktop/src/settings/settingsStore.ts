import { useEffect, useState } from "react";
import type {
  AutoSendMs,
  PublicSettings,
  SettingsInput,
  SettingsSaveResult,
} from "../../electron/ipc/types";
import { resetModel } from "../llm/model";

let current: PublicSettings | undefined;
let loading: Promise<PublicSettings> | undefined;

/** The settings, read once and kept; saving updates them. */
export function loadSettings(): Promise<PublicSettings> {
  loading ??= window.lucid.settings.get().then((s) => {
    current = s;
    return s;
  });
  return loading;
}

/** What is known right now (undefined until the first load finishes). */
export const peekSettings = (): PublicSettings | undefined => current;

/** Saves; on success the new values apply at once: the model is looked up again and the model pill checks. */
export async function saveSettings(input: SettingsInput): Promise<SettingsSaveResult> {
  const result = await window.lucid.settings.save(input);
  if (result.ok) {
    current = result.settings;
    loading = Promise.resolve(result.settings);
    resetModel();
    window.dispatchEvent(new Event("lucid:settings-saved"));
  }
  return result;
}

/** How long a paste waits for more before it is sent by itself (0: never); follows the Settings window. */
export function useAutoSendMs(): AutoSendMs {
  const [ms, setMs] = useState<AutoSendMs>(peekSettings()?.dictation.autoSendMs ?? 450);
  useEffect(() => {
    const read = () => {
      void loadSettings().then((s) => {
        setMs(s.dictation.autoSendMs);
      });
    };
    read();
    window.addEventListener("lucid:settings-saved", read);
    return () => {
      window.removeEventListener("lucid:settings-saved", read);
    };
  }, []);
  return ms;
}
