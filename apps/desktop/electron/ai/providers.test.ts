import { describe, expect, it, vi } from "vitest";
import type { ProviderProfile } from "../ipc/types";
import { inspectProvider } from "./providers";

const profile = (change: Partial<ProviderProfile> = {}): ProviderProfile => ({
  id: "local",
  name: "Local",
  kind: "lmstudio",
  baseUrl: "http://127.0.0.1:1234",
  model: "local/model",
  ...change,
});

describe("inspectProvider", () => {
  it("reads OpenAI-shaped model lists from the provider's models endpoint", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "z-model" }, { id: "a-model" }] }), {
        status: 200,
      }),
    );
    const result = await inspectProvider(profile(), undefined, request);
    expect(result).toEqual({
      ok: true,
      message: "Connected to LM Studio. 2 models available.",
      models: ["a-model", "z-model"],
    });
    expect(request.mock.calls[0]?.[0]).toEqual(new URL("http://127.0.0.1:1234/v1/models"));
  });

  it("reads Ollama-shaped model lists from the native tags endpoint", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ models: [{ name: "llama3.2" }] }), { status: 200 }),
      );
    const result = await inspectProvider(
      profile({ kind: "ollama", baseUrl: "http://localhost:11434" }),
      undefined,
      request,
    );
    expect(result.models).toEqual(["llama3.2"]);
    expect(request.mock.calls[0]?.[0]).toEqual(new URL("http://localhost:11434/api/tags"));
  });

  it("requires credentials before contacting a cloud provider", async () => {
    const request = vi.fn<typeof fetch>();
    const result = await inspectProvider(
      profile({
        kind: "openai",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4.1-mini",
      }),
      undefined,
      request,
    );
    expect(result).toEqual({
      ok: false,
      message: "Add an API key for OpenAI API, then try again.",
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("uses provider-specific authentication without returning the key", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    const result = await inspectProvider(
      profile({
        kind: "anthropic",
        baseUrl: "https://api.anthropic.com/v1",
        model: "claude-sonnet-4-5",
      }),
      "top-secret",
      request,
    );
    expect(request.mock.calls[0]?.[1]?.headers).toMatchObject({
      "x-api-key": "top-secret",
      "anthropic-version": "2023-06-01",
    });
    expect(JSON.stringify(result)).not.toContain("top-secret");
  });

  it("redacts credentials from actionable network failures", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("Bearer top-secret was rejected"));
    const result = await inspectProvider(
      profile({
        kind: "custom",
        baseUrl: "https://models.example.test/v1",
        model: "custom",
      }),
      "top-secret",
      request,
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Could not connect");
    expect(result.message).not.toContain("top-secret");
  });
});
