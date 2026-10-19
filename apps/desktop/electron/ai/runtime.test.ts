import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createRuntimeResolver } from "./runtime";

describe("createRuntimeResolver", () => {
  it("builds the LM Studio adapter in main from a migrated settings file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lucid-runtime-"));
    await mkdir(join(dir, ".lucid"));
    await writeFile(
      join(dir, ".lucid", "settings.json"),
      JSON.stringify({ llm: { baseUrl: "http://localhost:9876", model: "local/model" } }),
      "utf8",
    );
    const runtime = await createRuntimeResolver(dir, vi.fn<typeof fetch>(), undefined)("lmstudio");
    expect(runtime).toMatchObject({
      endpoint: "http://localhost:9876",
      client: { provider: "lmstudio" },
    });
  });

  it("keeps the environment override used by tests and development", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lucid-runtime-"));
    const runtime = await createRuntimeResolver(
      dir,
      vi.fn<typeof fetch>(),
      "http://127.0.0.1:4567/",
    )("lmstudio");
    expect(runtime?.endpoint).toBe("http://127.0.0.1:4567");
  });

  it("builds the native Ollama adapter without applying the LM Studio override", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lucid-runtime-"));
    await mkdir(join(dir, ".lucid"));
    await writeFile(
      join(dir, ".lucid", "settings.json"),
      JSON.stringify({
        ai: {
          defaultProfileId: "ollama",
          profiles: [
            {
              id: "ollama",
              name: "Ollama",
              kind: "ollama",
              baseUrl: "http://localhost:11434",
              model: "qwen3:8b",
            },
          ],
        },
      }),
      "utf8",
    );
    const runtime = await createRuntimeResolver(
      dir,
      vi.fn<typeof fetch>(),
      "http://127.0.0.1:4567",
    )("ollama");
    expect(runtime).toMatchObject({
      endpoint: "http://localhost:11434",
      client: { provider: "ollama" },
    });
  });

  it("resolves cloud providers only when main can read the saved credential", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lucid-runtime-"));
    await mkdir(join(dir, ".lucid"));
    await writeFile(
      join(dir, ".lucid", "settings.json"),
      JSON.stringify({
        ai: {
          defaultProfileId: "openai",
          profiles: [
            {
              id: "openai",
              name: "OpenAI",
              kind: "openai",
              baseUrl: "https://api.openai.com/v1",
              model: "gpt-5-mini",
            },
          ],
        },
      }),
      "utf8",
    );
    expect(await createRuntimeResolver(dir)("openai")).toBeUndefined();
    const read = vi.fn(() => Promise.resolve("main-only-secret"));
    const runtime = await createRuntimeResolver(
      dir,
      vi.fn<typeof fetch>(),
      undefined,
      read,
    )("openai");
    expect(runtime).toMatchObject({
      endpoint: "https://api.openai.com/v1",
      client: { provider: "openai" },
      secrets: ["main-only-secret"],
    });
    expect(read).toHaveBeenCalledWith("provider.openai");
  });

  it("resolves Anthropic with only its saved main-process key", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lucid-runtime-"));
    await mkdir(join(dir, ".lucid"));
    await writeFile(
      join(dir, ".lucid", "settings.json"),
      JSON.stringify({
        ai: {
          defaultProfileId: "claude",
          profiles: [
            {
              id: "claude",
              name: "Claude",
              kind: "anthropic",
              baseUrl: "https://api.anthropic.com/v1",
              model: "claude-sonnet-4-5",
            },
          ],
        },
      }),
      "utf8",
    );
    const read = vi.fn(() => Promise.resolve("main-only-secret"));
    const runtime = await createRuntimeResolver(
      dir,
      vi.fn<typeof fetch>(),
      undefined,
      read,
    )("claude");
    expect(runtime).toMatchObject({
      endpoint: "https://api.anthropic.com/v1",
      client: { provider: "anthropic" },
      secrets: ["main-only-secret"],
    });
    expect(read).toHaveBeenCalledWith("provider.claude");
  });
});
