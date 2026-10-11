import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ ipcMain: { handle: vi.fn() } }));

const { checkLlmUrl } = await import("./llm");

describe("checkLlmUrl", () => {
  it("allows the two LM Studio endpoints on this computer", () => {
    expect(checkLlmUrl("http://127.0.0.1:1234/v1/models").pathname).toBe("/v1/models");
    expect(checkLlmUrl("http://localhost:1234/v1/chat/completions").hostname).toBe("localhost");
    expect(checkLlmUrl("http://[::1]:1234/v1/models").hostname).toBe("[::1]");
  });

  it.each([
    "https://127.0.0.1:1234/v1/models",
    "http://example.com/v1/models",
    "http://192.168.1.5:1234/v1/models",
    "http://127.0.0.1:1234/v1/embeddings",
    "http://127.0.0.1:1234/",
    "file:///etc/passwd",
  ])("refuses %s", (url) => {
    expect(() => checkLlmUrl(url)).toThrow();
  });
});
