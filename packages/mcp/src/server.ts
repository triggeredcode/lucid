import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Backend } from "./backend";
import { TOOLS } from "./tools";

export const SERVER_NAME = "lucid";
export const SERVER_VERSION = "0.3.0";

const INSTRUCTIONS = `Lucid is a local note editor for learning notes (system design, inference engineering, benchmarks). A page is a list of typed blocks: headings, paragraphs, bullets, callouts, tables, diagrams, math, charts, code.
Start with get_outline (and describe_kit once). Add notes with insert_notes (Lucid Markdown); change what is there with apply_ops, using the [bN] references from the outline. Never write LaTeX or Mermaid: Lucid draws diagrams and PDFs itself.
Every change is one undo step for the person and is listed in the page's history as made by you. Struck-through items are ideas the person kept on purpose: do not delete them.`;

/** The MCP server with Lucid's tools, bound to a backend (the running app, or memory in tests). */
export function createLucidMcpServer(
  backend: Backend,
  options: { agent?: string } = {},
): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: INSTRUCTIONS },
  );
  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.input,
        annotations: { readOnlyHint: tool.readOnly, destructiveHint: false, openWorldHint: false },
      },
      async (args: Record<string, unknown>) => {
        try {
          const agent =
            options.agent ??
            server.server.getClientVersion()?.name.replace(/[^\w.-]+/g, "-") ??
            "agent";
          const result = await tool.run({ backend, agent }, args);
          return {
            content: [{ type: "text" as const, text: result.text }],
            isError: result.isError === true,
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text" as const,
                text: error instanceof Error ? error.message : "Something went wrong.",
              },
            ],
            isError: true,
          };
        }
      },
    );
  }
  return server;
}
