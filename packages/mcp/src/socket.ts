import { createServer, connect, type Server } from "node:net";
import { createHash } from "node:crypto";
import { chmod, mkdir, rm } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import { homedir } from "node:os";
import { LucidDocSchema, type BlockPatch } from "@lucid/core";
import { z } from "zod";
import {
  BackendError,
  type Backend,
  type ChangeNote,
  type PageInfo,
  type PageState,
  type PdfExport,
} from "./backend";

/**
 * The local socket between the MCP server (a process Claude Code or LM Studio starts) and the running Lucid app.
 * One request per connection: a line of JSON in, a line of JSON out. On macOS and Linux it is a socket file in the library
 * folder that only its owner can use; on Windows it is a named pipe (there are no socket files), named after the library
 * folder so that two libraries do not share one.
 */
export const socketPathFor = (
  home = process.env["LUCID_HOME"] ?? join(homedir(), "Lucid"),
  platform: NodeJS.Platform = process.platform,
): string =>
  platform === "win32"
    ? `\\\\.\\pipe\\lucid-${createHash("sha256").update(home.toLowerCase()).digest("hex").slice(0, 16)}`
    : posix.join(home, ".lucid", "lucid.sock");

/** A Windows named pipe has no file to create, remove or protect. */
export const isPipe = (path: string): boolean => path.startsWith("\\\\.\\pipe\\");

const IdSchema = z.string().min(1).max(200);
const NoteSchema = z.object({
  summary: z.string().max(300),
  source: z.string().max(80),
  affected: z.array(z.string()).max(2000),
});

const RequestSchema = z.discriminatedUnion("method", [
  z.object({ method: z.literal("pages.list") }),
  z.object({ method: z.literal("pages.get"), params: z.object({ id: IdSchema.optional() }) }),
  z.object({
    method: z.literal("pages.create"),
    params: z.object({ title: z.string().min(1).max(200), format: z.string().max(60).optional() }),
  }),
  z.object({ method: z.literal("pages.exportPdf"), params: z.object({ id: IdSchema.optional() }) }),
  z.object({
    method: z.literal("pages.apply"),
    params: z.object({
      id: IdSchema,
      patch: z.object({ steps: z.array(z.unknown()) }),
      note: NoteSchema,
    }),
  }),
]);

type Reply = { ok: true; result: unknown } | { ok: false; error: string };

/** Serves a backend on a unix socket. Returns a function that stops it and removes the socket file. */
export async function serveBackend(path: string, backend: Backend): Promise<() => Promise<void>> {
  if (!isPipe(path)) {
    await mkdir(dirname(path), { recursive: true });
    await rm(path, { force: true });
  }
  const server: Server = createServer((socket) => {
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("error", () => undefined);
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      if (buffer.length > 40_000_000) socket.destroy();
      const end = buffer.indexOf("\n");
      if (end < 0) return;
      const line = buffer.slice(0, end);
      buffer = "";
      void handle(line, backend).then((reply) => {
        socket.end(`${JSON.stringify(reply)}\n`);
      });
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, resolve);
  });
  if (!isPipe(path)) await chmod(path, 0o600).catch(() => undefined);
  return async () => {
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
    if (!isPipe(path)) await rm(path, { force: true });
  };
}

async function handle(line: string, backend: Backend): Promise<Reply> {
  try {
    const request = RequestSchema.parse(JSON.parse(line));
    switch (request.method) {
      case "pages.list":
        return { ok: true, result: await backend.listPages() };
      case "pages.get":
        return { ok: true, result: await backend.getPage(request.params.id) };
      case "pages.create":
        return {
          ok: true,
          result: await backend.createPage(request.params.title, request.params.format),
        };
      case "pages.exportPdf":
        return { ok: true, result: await backend.exportPdf(request.params.id) };
      case "pages.apply": {
        const { id, patch, note } = request.params;
        return {
          ok: true,
          result: await backend.applyPatch(id, patch as unknown as BlockPatch, note),
        };
      }
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Something went wrong." };
  }
}

const NOT_RUNNING = "Lucid is not running. Open the Lucid app, then try again.";

/** A backend that talks to the running app over its socket. */
export class SocketBackend implements Backend {
  constructor(private readonly path: string = socketPathFor()) {}

  private call(request: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const socket = connect(this.path);
      let buffer = "";
      socket.setEncoding("utf8");
      socket.once("error", (error: NodeJS.ErrnoException) => {
        reject(
          new BackendError(
            error.code === "ENOENT" || error.code === "ECONNREFUSED" ? NOT_RUNNING : error.message,
          ),
        );
      });
      socket.once("connect", () => {
        socket.write(`${JSON.stringify(request)}\n`);
      });
      socket.on("data", (chunk: string) => {
        buffer += chunk;
      });
      socket.once("end", () => {
        try {
          const reply = JSON.parse(buffer) as Reply;
          if (reply.ok) resolve(reply.result);
          else reject(new BackendError(reply.error));
        } catch {
          reject(new BackendError("Lucid sent a reply that could not be read."));
        }
      });
    });
  }

  async listPages(): Promise<PageInfo[]> {
    return (await this.call({ method: "pages.list" })) as PageInfo[];
  }

  async getPage(id?: string): Promise<PageState> {
    const r = (await this.call({
      method: "pages.get",
      params: id === undefined ? {} : { id },
    })) as PageState;
    return { ...r, doc: LucidDocSchema.parse(r.doc) };
  }

  async createPage(title: string, format?: string): Promise<{ id: string; title: string }> {
    return (await this.call({
      method: "pages.create",
      params: format === undefined ? { title } : { title, format },
    })) as { id: string; title: string };
  }

  async exportPdf(id?: string): Promise<PdfExport> {
    return (await this.call({
      method: "pages.exportPdf",
      params: id === undefined ? {} : { id },
    })) as PdfExport;
  }

  async applyPatch(id: string, patch: BlockPatch, note: ChangeNote) {
    const r = (await this.call({ method: "pages.apply", params: { id, patch, note } })) as {
      doc: unknown;
    };
    return { doc: LucidDocSchema.parse(r.doc) };
  }
}
