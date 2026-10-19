import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CredentialVault, type SecretEncryption } from "./credentials";

const dirs: string[] = [];
afterEach(async () => Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true }))));

const encryption = (available = true): SecretEncryption => ({
  secureAvailable: () => available,
  encrypt: (value) => Buffer.from(`encrypted:${value}`, "utf8"),
  decrypt: (value) => value.toString("utf8").replace(/^encrypted:/, ""),
});

async function vault(available = true) {
  const dir = await mkdtemp(join(tmpdir(), "lucid-credentials-"));
  dirs.push(dir);
  return { dir, vault: new CredentialVault(dir, encryption(available)) };
}

describe("CredentialVault", () => {
  it("saves, reads, and deletes an encrypted persistent secret without writing plaintext", async () => {
    const { dir, vault: first } = await vault();
    const status = await first.save("openai", "sk-private-value", true);
    expect(status).toEqual({ present: true, storage: "secure", securePersistenceAvailable: true });
    expect(await first.read("openai")).toBe("sk-private-value");
    expect(await readFile(join(dir, "credentials.json"), "utf8")).not.toContain("sk-private-value");

    const reopened = new CredentialVault(dir, encryption());
    expect(await reopened.read("openai")).toBe("sk-private-value");
    await reopened.delete("openai");
    expect(await reopened.status("openai")).toMatchObject({ present: false, storage: "none" });
  });

  it("falls back only to memory when secure persistence is unavailable", async () => {
    const { dir, vault: current } = await vault(false);
    expect(await current.save("anthropic", "session-secret", true)).toEqual({
      present: true,
      storage: "session",
      securePersistenceAvailable: false,
    });
    expect(await current.read("anthropic")).toBe("session-secret");
    await expect(readFile(join(dir, "credentials.json"), "utf8")).rejects.toThrow();
    expect(await new CredentialVault(dir, encryption(false)).read("anthropic")).toBeUndefined();
  });

  it("uses session storage when encryption fails temporarily", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lucid-credentials-"));
    dirs.push(dir);
    const failing: SecretEncryption = {
      secureAvailable: () => true,
      encrypt: () => {
        throw new Error("keychain unavailable");
      },
      decrypt: () => "",
    };
    const current = new CredentialVault(dir, failing);
    expect(await current.save("openrouter", "temporary-secret", true)).toMatchObject({
      present: true,
      storage: "session",
    });
    expect(await current.read("openrouter")).toBe("temporary-secret");
  });
});
