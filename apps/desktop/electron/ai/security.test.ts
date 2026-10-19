import { describe, expect, it } from "vitest";
import {
  redactSensitive,
  secureProviderFetch,
  validateProviderEndpoint,
  validateProviderRedirect,
} from "./security";

describe("provider endpoint security", () => {
  it.each([
    "https://api.openai.com/v1",
    "https://models.example.test/custom/v1",
    "http://127.0.0.1:11434/v1",
    "http://localhost:1234/v1",
    "http://[::1]:8080/v1",
  ])("allows %s", (value) => {
    expect(validateProviderEndpoint(value).href).toContain("://");
  });

  it.each([
    "http://example.com/v1",
    "ftp://example.com/v1",
    "file:///tmp/secret",
    "https://key@example.com/v1",
    "https://example.com/v1?api_key=secret",
    "not a URL",
  ])("refuses %s", (value) => {
    expect(() => validateProviderEndpoint(value)).toThrow();
  });

  it("allows only validated same-origin redirects", () => {
    const from = validateProviderEndpoint("https://api.example.com/v1/chat");
    expect(validateProviderRedirect(from, "/v2/chat").href).toBe("https://api.example.com/v2/chat");
    expect(() => validateProviderRedirect(from, "https://elsewhere.example/v1")).toThrow(
      /another origin/,
    );
    expect(() => validateProviderRedirect(from, "http://api.example.com/v1")).toThrow();
  });

  it("manually validates a redirect before following it", async () => {
    const fetcher = (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return Promise.resolve(
        url.endsWith("/first")
          ? new Response(null, { status: 307, headers: { location: "/second" } })
          : new Response("ok", { status: 200 }),
      );
    };
    expect(
      await (await secureProviderFetch("https://api.example.com/first", {}, fetcher)).text(),
    ).toBe("ok");
    await expect(
      secureProviderFetch("https://api.example.com/first", {}, async () =>
        Promise.resolve(
          new Response(null, {
            status: 302,
            headers: { location: "https://attacker.example/steal" },
          }),
        ),
      ),
    ).rejects.toThrow(/another origin/);
  });

  it("redacts bearer tokens, query credentials, and known secrets", () => {
    const secret = "sk-super-secret";
    const text = redactSensitive(
      new Error(`Bearer abc123 failed at https://x.test?a=1&api_key=query-secret: ${secret}`),
      [secret],
    );
    expect(text).not.toContain("abc123");
    expect(text).not.toContain("query-secret");
    expect(text).not.toContain(secret);
    expect(text).toContain("[redacted]");
  });
});
