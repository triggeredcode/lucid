import { ipcMain } from "electron";
import { IPC, type LlmHead, type LlmRequest } from "./types";

/** Only these LM Studio endpoints, only on this machine. The renderer cannot use this to reach anything else. */
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const PATHS = new Set(["/v1/models", "/v1/chat/completions"]);

export function checkLlmUrl(url: string): URL {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" || !LOCAL_HOSTS.has(parsed.hostname)) {
    throw new Error("Lucid only talks to LM Studio on this computer.");
  }
  if (!PATHS.has(parsed.pathname))
    throw new Error(`Not an LM Studio endpoint Lucid uses: ${parsed.pathname}`);
  return parsed;
}

export function registerLlmIpc(): void {
  const running = new Map<number, AbortController>();

  ipcMain.handle(IPC.llmStart, async (event, raw: unknown): Promise<LlmHead> => {
    const req = raw as Partial<LlmRequest>;
    if (typeof req.id !== "number" || typeof req.url !== "string")
      return { ok: false, message: "invalid request" };
    try {
      const url = checkLlmUrl(req.url);
      const method = req.method === "POST" ? "POST" : "GET";
      const controller = new AbortController();
      running.set(req.id, controller);
      const id = req.id;
      const res = await fetch(url, {
        method,
        headers: typeof req.headers === "object" ? req.headers : {},
        ...(method === "POST" && typeof req.body === "string" ? { body: req.body } : {}),
        signal: controller.signal,
      });
      // Stream the body back as it arrives; the renderer is already listening for this id.
      void (async () => {
        try {
          if (res.body) {
            for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
              if (event.sender.isDestroyed()) return;
              event.sender.send(IPC.llmEvent, { id, type: "chunk", data: chunk });
            }
          }
          if (!event.sender.isDestroyed()) event.sender.send(IPC.llmEvent, { id, type: "end" });
        } catch (error) {
          if (!event.sender.isDestroyed()) {
            event.sender.send(IPC.llmEvent, {
              id,
              type: "error",
              message: error instanceof Error ? error.message : String(error),
            });
          }
        } finally {
          running.delete(id);
        }
      })();
      return { ok: true, status: res.status, headers: Object.fromEntries(res.headers) };
    } catch (error) {
      running.delete(req.id);
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC.llmAbort, (_e, id: unknown) => {
    if (typeof id === "number") running.get(id)?.abort();
  });
}
