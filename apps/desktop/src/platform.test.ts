import { describe, expect, it } from "vitest";
import { keys } from "./platform";

describe("keys", () => {
  it("leaves the Mac's symbols alone on a Mac", () => {
    expect(keys("Export (⇧⌘E). Hold the right ⌥ key", true)).toBe(
      "Export (⇧⌘E). Hold the right ⌥ key",
    );
  });

  it("spells the keys out on Windows and Linux", () => {
    expect(keys("Export (⇧⌘E)", false)).toBe("Export (Ctrl+Shift+E)");
    expect(keys("Input (⌘1) · ⌘/ switches · Settings (⌘,)", false)).toBe(
      "Input (Ctrl+1) · Ctrl+/ switches · Settings (Ctrl+,)",
    );
    expect(keys("Hold the right ⌥ key for one command", false)).toBe(
      "Hold the right Alt key for one command",
    );
    expect(keys("click for 100% (⌘0). ⌘+ and ⌘− zoom", false)).toBe(
      "click for 100% (Ctrl+0). Ctrl++ and Ctrl+− zoom",
    );
  });
});
