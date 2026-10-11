import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SERVER_VERSION } from "@lucid/mcp";
import { describe, expect, it } from "vitest";

/** One version for the whole product: a release is one number, and the changelog tells what is in it. */
const root = join(__dirname, "../../..");
const read = (file: string): string => readFileSync(join(root, file), "utf8");
const version = (file: string): string => (JSON.parse(read(file)) as { version: string }).version;

describe("the version", () => {
  it("is the same in the workspace, in the app and in the agent server", () => {
    const v = version("package.json");
    expect(v).toMatch(/^\d+\.\d+\.\d+$/);
    expect(version("apps/desktop/package.json")).toBe(v);
    expect(SERVER_VERSION).toBe(v);
  });

  it("has an entry in the changelog, newest first, with its link", () => {
    const v = version("package.json");
    const log = read("CHANGELOG.md");
    expect(log).toContain(`## [${v}] - `);
    expect(log).toContain(`[${v}]: https://github.com/triggeredcode/lucid/releases/tag/v${v}`);
    const headings = [...log.matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)].map((m) => m[1]);
    expect(headings[0]).toBe(v);
  });
});
