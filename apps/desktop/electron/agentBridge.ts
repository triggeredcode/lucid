import { BrowserWindow, ipcMain } from "electron";
import type { BlockPatch, LucidDoc } from "@lucid/core";
import type { ChangeNote } from "@lucid/mcp";
import type { Bridge, OpenPage } from "./appBackend";
import { IPC, type AgentReply, type AgentRequest } from "./ipc/types";

const TIMEOUT_MS = 15_000;
/** Drawing the figures of a big page takes longer than reading it. */
const FIGURES_TIMEOUT_MS = 90_000;

/** Asks the window about the page that is open in it, and waits for its answer. */
export class RendererBridge implements Bridge {
  private seq = 0;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >();

  constructor() {
    ipcMain.handle(IPC.agentReply, (_event, reply: AgentReply) => {
      const wait = this.pending.get(reply.id);
      if (!wait) return;
      this.pending.delete(reply.id);
      clearTimeout(wait.timer);
      if (reply.ok) wait.resolve(reply.result);
      else wait.reject(new Error(reply.error));
    });
  }

  private window(): BrowserWindow | undefined {
    return BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
  }

  private ask(request: (id: number) => AgentRequest, timeoutMs = TIMEOUT_MS): Promise<unknown> {
    const win = this.window();
    if (!win) return Promise.reject(new Error("The Lucid window is not open."));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Lucid did not answer in time."));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      win.webContents.send(IPC.agentRequest, request(id));
    });
  }

  async openPage(): Promise<OpenPage | undefined> {
    if (!this.window()) return undefined;
    const r = (await this.ask((id) => ({ id, method: "openPage" }))) as OpenPage | null;
    return r ?? undefined;
  }

  async getDoc(): Promise<LucidDoc> {
    return (await this.ask((id) => ({ id, method: "getDoc" }))) as LucidDoc;
  }

  async figures(doc: LucidDoc): Promise<Record<string, string>> {
    const r = await this.ask(
      (id) => ({ id, method: "figures", params: { doc } }),
      FIGURES_TIMEOUT_MS,
    );
    const out: Record<string, string> = {};
    if (typeof r === "object" && r !== null) {
      for (const [blockId, svg] of Object.entries(r)) {
        if (typeof svg === "string") out[blockId] = svg;
      }
    }
    return out;
  }

  async apply(patch: BlockPatch, note: ChangeNote): Promise<LucidDoc> {
    return (await this.ask((id) => ({ id, method: "apply", params: { patch, note } }))) as LucidDoc;
  }
}
