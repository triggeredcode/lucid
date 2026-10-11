import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SAMPLE_DOC as COMMAND_DOC } from "@lucid/kit";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryBackend } from "./backend";
import { createLucidMcpServer } from "./server";
import { SocketBackend, isPipe, serveBackend, socketPathFor } from "./socket";

const stops: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
});

async function serve() {
  const dir = await mkdtemp(join(tmpdir(), "lucid-sock-"));
  const path = socketPathFor(dir);
  const memory = new MemoryBackend().add("p1", "Request flow and databases", COMMAND_DOC, true);
  stops.push(await serveBackend(path, memory));
  return { path, memory };
}

describe("the local socket", () => {
  // A socket file is a Unix thing: on Windows the connection is a named pipe, with no file to look at.
  it.skipIf(process.platform === "win32")(
    "lives in the library folder and only its owner can use it",
    async () => {
      const { path } = await serve();
      expect(path.endsWith("/.lucid/lucid.sock")).toBe(true);
      expect((await stat(path)).mode & 0o077).toBe(0);
    },
  );

  it("is a socket file in the library folder on a Mac or Linux, and a named pipe of its own on Windows", () => {
    expect(socketPathFor("/home/a/Lucid", "linux")).toBe("/home/a/Lucid/.lucid/lucid.sock");
    expect(socketPathFor("/Users/a/Lucid", "darwin")).toBe("/Users/a/Lucid/.lucid/lucid.sock");
    const a = socketPathFor("C:\\Users\\a\\Lucid", "win32");
    const b = socketPathFor("C:\\Users\\b\\Lucid", "win32");
    expect(a).toMatch(/^\\\\\.\\pipe\\lucid-[0-9a-f]{16}$/);
    expect(isPipe(a)).toBe(true);
    expect(a).not.toBe(b); // two libraries never share a pipe
    expect(a).toBe(socketPathFor("c:\\users\\a\\lucid", "win32")); // Windows paths ignore case
    expect(isPipe("/home/a/Lucid/.lucid/lucid.sock")).toBe(false);
  });

  it("carries pages and changes between a client and the backend", async () => {
    const { path, memory } = await serve();
    const backend = new SocketBackend(path);
    expect((await backend.listPages()).map((p) => p.id)).toEqual(["p1"]);
    const page = await backend.getPage();
    expect(page).toMatchObject({ id: "p1", open: true });
    expect(page.doc.blocks).toHaveLength(COMMAND_DOC.blocks.length);
    const next = await backend.applyPatch(
      "p1",
      { steps: [{ kind: "remove", id: "t1" }] },
      { summary: "Removed the table", source: "agent:test", affected: [] },
    );
    expect(next.doc.blocks.some((b) => b.id === "t1")).toBe(false);
    expect(memory.changes[0]).toMatchObject({ source: "agent:test" });
  });

  it("creates pages through the socket", async () => {
    const { path, memory } = await serve();
    const backend = new SocketBackend(path);
    const made = await backend.createPage("Kafka vs SQS", "comparison");
    expect(made.title).toBe("Kafka vs SQS");
    expect((await memory.getPage(made.id)).format).toBe("comparison");
    await expect(backend.createPage("X", "essay")).rejects.toThrow('There is no format "essay"');
  });

  it("asks for a PDF through the socket", async () => {
    const { path, memory } = await serve();
    const backend = new SocketBackend(path);
    const made = await backend.exportPdf();
    expect(made.path).toBe("/library/exports/Request flow and databases.pdf");
    expect(made.warnings).toEqual([]);
    expect(memory.exports).toEqual(["p1"]);
    await expect(backend.exportPdf("nope")).rejects.toThrow('There is no page "nope"');
  });

  it("passes the backend's complaints on in plain words", async () => {
    const { path } = await serve();
    await expect(new SocketBackend(path).getPage("nope")).rejects.toThrow(
      'There is no page "nope"',
    );
  });

  it("says Lucid is not running when nobody listens", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lucid-sock-"));
    await expect(new SocketBackend(socketPathFor(dir)).listPages()).rejects.toThrow(
      "Lucid is not running",
    );
  });

  it("ignores garbage and malformed requests without stopping", async () => {
    const { path } = await serve();
    const { connect } = await import("node:net");
    const reply = await new Promise<string>((resolve) => {
      const s = connect(path);
      let data = "";
      s.setEncoding("utf8");
      s.on("data", (c: string) => (data += c));
      s.on("end", () => {
        resolve(data);
      });
      s.on("connect", () => s.write('{"method":"pages.delete"}\n'));
    });
    expect(JSON.parse(reply)).toMatchObject({ ok: false });
    expect((await new SocketBackend(path).listPages()).length).toBe(1);
  });

  it("serves a whole MCP session: an agent reads and edits through the socket", async () => {
    const { path, memory } = await serve();
    const server = createLucidMcpServer(new SocketBackend(path));
    const client = new Client({ name: "claude-code", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    const outline = await client.callTool({ name: "get_outline", arguments: {} });
    expect(JSON.stringify(outline.content)).toContain("open in Lucid");
    const r = await client.callTool({
      name: "insert_notes",
      arguments: { lmd: "## Sharding\nSplit keys across nodes." },
    });
    expect(r.isError).toBe(false);
    expect(memory.changes[0]).toMatchObject({ source: "agent:claude-code" });
  });
});
