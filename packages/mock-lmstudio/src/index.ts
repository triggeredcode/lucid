import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A fake LM Studio for tests: /v1/models and a streaming /v1/chat/completions (OpenAI-compatible SSE).
 * What it answers is scripted; faults are scripted too, so every failure path of the client and the
 * pipeline runs without a real model.
 */

export type Behaviour =
  /** A normal streamed answer. */
  | { kind: "reply"; content: string; chunkChars?: number; delayMs?: number; promptTokens?: number }
  /** The reasoning leak: thinking tokens, no content. */
  | { kind: "empty-with-reasoning"; reasoningTokens?: number }
  /** HTTP error with LM Studio's error body. */
  | { kind: "http-error"; status: number; message: string }
  /** Streams part of the answer, then the connection dies. */
  | { kind: "drop"; content: string; afterChars: number }
  /** Waits before the first token (and then answers). */
  | { kind: "slow-first-token"; ms: number; content: string };

export interface RecordedRequest {
  path: string;
  body: Record<string, unknown>;
}

export interface MockOptions {
  /** Models reported as loaded. Empty means "No models loaded". */
  models?: string[];
  /** Answer per request: the next scripted behaviour, or a function of the request. */
  script?: Behaviour[] | ((req: RecordedRequest, index: number) => Behaviour);
}

export interface MockLmStudio {
  url: string;
  requests: RecordedRequest[];
  /** Replace the script and start counting again. */
  setScript(script: MockOptions["script"]): void;
  setModels(models: string[]): void;
  close(): Promise<void>;
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function sse(res: ServerResponse, data: unknown): void {
  res.write(`data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`);
}

function pieces(text: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

export async function startMockLmStudio(options: MockOptions = {}): Promise<MockLmStudio> {
  let models = options.models ?? ["qwen/qwen3.8-27b"];
  let script = options.script ?? [];
  let index = 0;
  const requests: RecordedRequest[] = [];
  const open = new Set<ServerResponse>();

  const server: Server = createServer((req, res) => {
    void (async () => {
      const path = req.url ?? "/";
      if (req.method === "GET" && path === "/v1/models") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ object: "list", data: models.map((id) => ({ id, object: "model" })) }),
        );
        return;
      }
      if (req.method !== "POST" || path !== "/v1/chat/completions") {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Unexpected endpoint" } }));
        return;
      }
      const body = await readBody(req);
      const recorded: RecordedRequest = { path, body };
      requests.push(recorded);
      const model = typeof body["model"] === "string" ? body["model"] : "";
      if (models.length === 0 || (model && !models.includes(model))) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: {
              message:
                models.length === 0
                  ? "No models loaded. Please load a model in the developer page or use the 'lms load' command."
                  : `Model "${model}" not found. Loaded models: ${models.join(", ")}`,
              type: "invalid_request_error",
              param: "model",
              code: null,
            },
          }),
        );
        return;
      }
      const behaviour: Behaviour | undefined =
        typeof script === "function"
          ? script(recorded, index)
          : script[Math.min(index, script.length - 1)];
      index++;
      if (!behaviour) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "mock has no script for this request" } }));
        return;
      }
      if (behaviour.kind === "http-error") {
        res.writeHead(behaviour.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: behaviour.message } }));
        return;
      }
      open.add(res);
      res.on("close", () => open.delete(res));
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      const chunk = (delta: Record<string, unknown>, finish: string | null = null) => ({
        id: "chatcmpl-mock",
        object: "chat.completion.chunk",
        model,
        choices: [{ index: 0, delta, finish_reason: finish }],
      });
      const usage = (completion: number, reasoning: number, prompt = 120) => ({
        id: "chatcmpl-mock",
        object: "chat.completion.chunk",
        model,
        choices: [],
        usage: {
          prompt_tokens: prompt,
          completion_tokens: completion,
          completion_tokens_details: { reasoning_tokens: reasoning },
        },
      });

      switch (behaviour.kind) {
        case "empty-with-reasoning": {
          const n = behaviour.reasoningTokens ?? 200;
          sse(res, chunk({ role: "assistant", reasoning: "Let me think about this." }));
          sse(res, chunk({}, "stop"));
          sse(res, usage(n, n));
          sse(res, "[DONE]");
          res.end();
          return;
        }
        case "drop": {
          sse(res, chunk({ role: "assistant", content: "" }));
          sse(res, chunk({ content: behaviour.content.slice(0, behaviour.afterChars) }));
          await sleep(20);
          res.destroy();
          return;
        }
        case "slow-first-token":
        case "reply": {
          if (behaviour.kind === "slow-first-token") await sleep(behaviour.ms);
          const text = behaviour.content;
          const size = behaviour.kind === "reply" ? (behaviour.chunkChars ?? 8) : 8;
          const delay = behaviour.kind === "reply" ? (behaviour.delayMs ?? 0) : 0;
          sse(res, chunk({ role: "assistant", content: "" }));
          for (const part of pieces(text, size)) {
            if (res.destroyed) return;
            sse(res, chunk({ content: part }));
            if (delay > 0) await sleep(delay);
          }
          sse(res, chunk({}, "stop"));
          const prompt = behaviour.kind === "reply" ? behaviour.promptTokens : undefined;
          sse(res, usage(Math.ceil(text.length / 4), 0, prompt));
          sse(res, "[DONE]");
          res.end();
          return;
        }
      }
    })().catch(() => {
      res.destroy();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${String(port)}`,
    requests,
    setScript(next) {
      script = next ?? [];
      index = 0;
    },
    setModels(next) {
      models = next;
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const res of open) res.destroy();
        server.close(() => {
          resolve();
        });
        server.closeAllConnections();
      }),
  };
}
