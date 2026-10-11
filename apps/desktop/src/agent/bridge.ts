import { collectFigures } from "@lucid/kit";
import type { AgentRequest } from "../../electron/ipc/types";
import { pdfBox } from "../preview/fit";
import { renderFitted } from "../preview/mermaid";

/** What the open page answers itself; drawing figures needs only the window, so the bridge answers it. */
type PageRequest = Exclude<AgentRequest, { method: "figures" }>;
type Handler = (request: PageRequest) => unknown;

let handler: Handler | undefined;
let started = false;

/** The open page says how to answer an agent's questions about it; undefined when no page is open. */
export function setAgentHandler(next: Handler | undefined): void {
  handler = next;
}

/** Answers the main process while an AI agent works through MCP. Started once; the open page supplies the answers. */
export function startAgentBridge(): void {
  if (started) return;
  started = true;
  window.lucid.agent.onRequest((request) => {
    void (async () => {
      try {
        let result: unknown;
        if (request.method === "figures") {
          // Drawing a diagram needs the window but no particular page.
          const figures: Record<string, string> = {};
          for (const f of collectFigures(request.params.doc.blocks))
            figures[f.blockId] = (await renderFitted(f.mermaid, "pdf", pdfBox())).svg;
          result = figures;
        } else if (handler) result = await handler(request);
        else if (request.method === "openPage") result = null;
        else throw new Error("No page is open in Lucid.");
        await window.lucid.agent.reply({ id: request.id, ok: true, result });
      } catch (error) {
        await window.lucid.agent.reply({
          id: request.id,
          ok: false,
          error: error instanceof Error ? error.message : "Something went wrong in Lucid.",
        });
      }
    })();
  });
}

/** `agent:claude-code` as a name to show: "Claude Code". */
export function agentName(source: string): string {
  const raw = source
    .replace(/^agent:/, "")
    .replace(/[-_]+/g, " ")
    .trim();
  return raw.length === 0 ? "An agent" : raw.replace(/\b\w/g, (c) => c.toUpperCase());
}
