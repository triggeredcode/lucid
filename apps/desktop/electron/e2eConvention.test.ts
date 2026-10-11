import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The e2e tests run in a maximized window, the way the app is used (and where it has to scale): every spec that starts the
 * app calls `maximizeWindow` from helpers.ts, and none fakes a smaller viewport except the test that is about window sizes.
 */
const dir = join(__dirname, "../e2e");
const realDir = join(__dirname, "../e2e-real");
const specs = readdirSync(dir).filter((f) => f.endsWith(".spec.ts"));
const text = (f: string) => readFileSync(join(dir, f), "utf8");

describe("e2e window convention", () => {
  it("finds the specs", () => {
    expect(specs.length).toBeGreaterThan(10);
  });

  it("maximizes the window in every spec that starts the app", () => {
    const missing = specs.filter(
      (f) => text(f).includes("electron.launch(") && !text(f).includes("maximizeWindow("),
    );
    expect(missing).toEqual([]);
  });

  it("maximizes the window in the real-model acceptance specs too", () => {
    const real = readdirSync(realDir).filter((f) => f.endsWith(".spec.ts"));
    expect(real.length).toBeGreaterThan(0);
    for (const f of real) {
      const body = readFileSync(join(realDir, f), "utf8");
      expect(body.includes("electron.launch(") && !body.includes("maximizeWindow("), f).toBe(false);
      expect(body, f).not.toMatch(/setViewportSize\(/);
    }
  });

  it("does not fake a viewport, except in the test about window sizes", () => {
    const fakes = specs.filter((f) => /setViewportSize\(/.test(text(f)));
    expect(fakes).toEqual(["editing.spec.ts"]);
  });

  it("does not start in a small default size by accident: the helper waits for the real size", () => {
    const helpers = text("helpers.ts");
    expect(helpers).toContain("export async function maximizeWindow(");
    expect(helpers).toContain("workArea");
    expect(helpers).toContain("win.maximize()");
  });
});
