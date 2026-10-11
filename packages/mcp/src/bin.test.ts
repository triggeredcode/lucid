import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SAMPLE_DOC as COMMAND_DOC } from "@lucid/kit";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bundle } from "../scripts/bundle.mjs";
import { MemoryBackend } from "./backend";
import { serveBackend, socketPathFor } from "./socket";

/** The shipped file, started the way Claude Code starts it (a child process speaking MCP on stdio). */
describe("lucid-mcp over stdio", () => {
  let dir: string;
  let file: string;
  let stop: () => Promise<void>;
  const memory = new MemoryBackend().add("p1", "Request flow and databases", COMMAND_DOC, true);

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "lucid-bin-"));
    file = await bundle(join(dir, "lucid-mcp.mjs"));
    stop = await serveBackend(socketPathFor(dir), memory);
  }, 60_000);
  afterAll(async () => {
    await stop();
  });

  const start = async (home: string) => {
    const client = new Client({ name: "claude-code", version: "1" });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [file],
        env: { ...process.env, LUCID_HOME: home },
      }),
    );
    return client;
  };

  it("lists its tools and edits the running app's page, as the agent that asked", async () => {
    const client = await start(dir);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toContain("apply_ops");
      const r = await client.callTool({
        name: "insert_notes",
        arguments: { lmd: "## Replication\nLeaders and followers." },
      });
      expect(r.isError).toBe(false);
      expect(memory.changes.at(-1)).toMatchObject({ source: "agent:claude-code" });
    } finally {
      await client.close();
    }
  }, 30_000);

  it("tells the agent when Lucid is not running", async () => {
    const empty = await mkdtemp(join(tmpdir(), "lucid-bin-"));
    const client = await start(empty);
    try {
      const r = await client.callTool({ name: "list_documents", arguments: {} });
      expect(r.isError).toBe(true);
      expect(JSON.stringify(r.content)).toContain("Lucid is not running");
    } finally {
      await client.close();
    }
  }, 30_000);
});
