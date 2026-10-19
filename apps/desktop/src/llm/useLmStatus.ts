import { useCallback, useEffect, useRef, useState } from "react";
import type { LmStatus } from "../../electron/ipc/types";

const POLL_MS = 8000;
const POLL_WHILE_LOADING_MS = 2000;

/** How LM Studio is doing, checked now and then, and a way to load the model (after the person agreed). */
export function useLmStatus() {
  const [status, setStatus] = useState<LmStatus | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const refreshId = useRef(0);

  const refresh = useCallback(async () => {
    const id = ++refreshId.current;
    try {
      const settings = await window.lucid.settings.get();
      if (id !== refreshId.current) return;
      const selected = settings.ai.profiles.find(
        (profile) => profile.id === settings.ai.defaultProfileId,
      );
      if (selected?.kind !== "lmstudio") {
        setStatus(undefined);
        return;
      }
      const next = await window.lucid.lm.status();
      if (id === refreshId.current) setStatus(next);
    } catch {
      // The status is a convenience; a failed check shows nothing new.
    }
  }, []);

  useEffect(() => {
    // Another model or address was saved in Settings: look again at once.
    const again = () => {
      void refresh();
    };
    window.addEventListener("lucid:settings-saved", again);
    return () => {
      window.removeEventListener("lucid:settings-saved", again);
    };
  }, [refresh]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(
      () => {
        void refresh();
      },
      loading ? POLL_WHILE_LOADING_MS : POLL_MS,
    );
    return () => {
      clearInterval(timer);
    };
  }, [refresh, loading]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const result = await window.lucid.lm.load();
      if (!result.ok) setError(result.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the model.");
    } finally {
      setLoading(false);
      await refresh();
    }
  }, [refresh]);

  const clearError = useCallback(() => {
    setError(undefined);
  }, []);

  return { status, loading, error, refresh, load, clearError };
}
