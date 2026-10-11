import type { MenuItemConstructorOptions } from "electron";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  BrowserWindow: {},
  Menu: {},
  app: {},
  shell: {},
}));

const { buildMenu } = await import("./menu");

const labels = (items: MenuItemConstructorOptions[]) =>
  items.map((i) => (typeof i.label === "string" ? i.label : (i.role ?? "")));
const submenu = (items: MenuItemConstructorOptions[], label: string) =>
  (items.find((i) => i.label === label || i.role === label)?.submenu ??
    []) as MenuItemConstructorOptions[];

describe("the application menu", () => {
  const send = () => undefined;

  it("on a Mac starts with the Lucid menu, closes with ⌘W and keeps About out of Help", () => {
    const menu = buildMenu(send, "darwin");
    expect(labels(menu)[0]).toBe("appMenu");
    expect(submenu(menu, "File").at(-1)?.role).toBe("close");
    expect(submenu(menu, "help").some((i) => i.id === "help-about")).toBe(false);
  });

  it.each(["win32", "linux"] as const)(
    "on %s has no Lucid menu, quits from File, and has About in Help",
    (platform) => {
      const menu = buildMenu(send, platform);
      expect(labels(menu)).not.toContain("appMenu");
      expect(submenu(menu, "File").at(-1)?.role).toBe("quit");
      expect(submenu(menu, "help").some((i) => i.id === "help-about")).toBe(true);
    },
  );

  it.each(["darwin", "win32", "linux"] as const)(
    "on %s has the same File, View and Help items, with the shortcuts written for the system",
    (platform) => {
      const menu = buildMenu(send, platform);
      const ids = menu.flatMap(
        (m) => (m.submenu as MenuItemConstructorOptions[] | undefined) ?? [],
      );
      for (const id of [
        "import-note",
        "export-note",
        "zoom-in",
        "zoom-out",
        "zoom-reset",
        "help-guide",
      ])
        expect(
          ids.some((i) => i.id === id),
          id,
        ).toBe(true);
      // Electron turns CommandOrControl into ⌘ on a Mac and Ctrl elsewhere.
      expect(ids.find((i) => i.id === "export-note")?.accelerator).toBe("Shift+CommandOrControl+E");
    },
  );
});
