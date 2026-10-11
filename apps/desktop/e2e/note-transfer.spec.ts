import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Block } from "@lucid/core";
import { registry } from "@lucid/kit";
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { maximizeWindow, showHistory } from "./helpers";

/**
 * A note leaves as one file with everything in it (what was said and the history too, unless the person leaves them out)
 * and comes back, in another Lucid folder or the same one, without overwriting anything. The save and open dialogs of the
 * system are answered by the test.
 */
const text = (s: string) => ({ type: "text" as const, text: s, styles: {} });
const fixture = (type: Block["type"]): Block => {
  const found = registry.get(type).fixtures[0];
  if (!found) throw new Error(`no fixture for ${type}`);
  return found;
};

async function launch(): Promise<{ app: ElectronApplication; page: Page; home: string }> {
  const home = mkdtempSync(join(tmpdir(), "lucid-home-"));
  const app = await electron.launch({
    args: [join(__dirname, "../out/main/index.js")],
    env: { ...process.env, LUCID_HOME: home },
  });
  const page = await app.firstWindow();
  await maximizeWindow(app, page);
  return { app, page, home };
}

/** A note with notes, a table, a diagram, what was said, and two changes (the newest with its way back). */
async function seed(page: Page): Promise<void> {
  const blocks: Block[] = [
    {
      id: "p1",
      type: "paragraph",
      props: { status: "normal", unprocessed: false },
      content: [text("Start with one server.")],
      children: [],
    },
    fixture("table"),
    fixture("diagram"),
  ];
  const at = new Date().toISOString();
  await page.evaluate(
    async ({ blocks: b, at: when }) => {
      const file = await window.lucid.pages.create("Scaling notes");
      await window.lucid.pages.save({
        ...file,
        doc: { blocks: b },
        transcripts: [
          {
            id: "t1",
            text: "start with one server",
            source: "wispr",
            mode: "input",
            createdAt: when,
            status: "applied",
          },
          {
            id: "t2",
            text: "add a table",
            source: "typed",
            mode: "command",
            createdAt: when,
            status: "applied",
          },
        ],
        changeLog: [
          {
            id: "c1",
            at: when,
            summary: "Added a note",
            source: "local-model",
            affected: ["p1"],
            reverted: false,
          },
          {
            id: "c2",
            at: when,
            summary: "Added a table",
            source: "local-model",
            affected: [b[1]?.id ?? ""],
            reverted: false,
            revert: {
              undo: { steps: [{ kind: "remove", id: b[1]?.id ?? "" }] },
              expect: { [b[1]?.id ?? ""]: b[1] ?? null },
            },
          },
        ],
      } as never);
    },
    { blocks, at },
  );
  await page.reload();
  await page
    .getByRole("navigation", { name: "Pages" })
    .getByRole("button", { name: /Scaling notes/ })
    .click();
  await expect(page.getByLabel("Page title")).toHaveValue("Scaling notes");
}

const saveTo = (app: ElectronApplication, filePath: string) =>
  app.evaluate(({ dialog }, p) => {
    dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: p });
  }, filePath);
const openFiles = (app: ElectronApplication, filePaths: string[]) =>
  app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: p });
  }, filePaths);
const exportDialog = (page: Page) => page.getByRole("dialog", { name: "Export note" });
const json = (path: string) => JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
// Pages only: the `.lucid` folder in the library holds settings and backups.
const lucidFiles = (home: string) =>
  readdirSync(home, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".lucid"))
    .map((e) => e.name);

test("Export note saves the whole note, with what was said and the history, or only the notes", async () => {
  test.setTimeout(90_000);
  const { app, page, home } = await launch();
  try {
    await seed(page);
    const out = mkdtempSync(join(tmpdir(), "lucid-out-"));

    // The whole note.
    await saveTo(app, join(out, "whole.lucid"));
    await page.getByRole("button", { name: "Export note" }).click();
    await expect(exportDialog(page)).toBeVisible();
    await expect(exportDialog(page)).toContainText("2 things you said");
    await expect(exportDialog(page)).toContainText("2 changes in the history");
    await exportDialog(page).getByRole("button", { name: "Export…" }).click();
    await expect(page.getByText("Saved whole.lucid.")).toBeVisible();
    const whole = json(join(out, "whole.lucid"));
    expect(whole["title"]).toBe("Scaling notes");
    expect((whole["transcripts"] as unknown[]).length).toBe(2);
    const log = whole["changeLog"] as { id: string; revert?: unknown }[];
    expect(log.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(log[1]?.revert).toBeDefined();
    expect((whole["doc"] as { blocks: unknown[] }).blocks.length).toBe(3);

    // Only the notes: nothing of what was said, nothing of the history.
    await saveTo(app, join(out, "clean.lucid"));
    await page.getByRole("button", { name: "Export note" }).click();
    await exportDialog(page).getByLabel("Include what I said and the change history").uncheck();
    await expect(exportDialog(page)).toContainText("stay with you");
    await exportDialog(page).getByRole("button", { name: "Export…" }).click();
    await expect(page.getByText("Saved clean.lucid.")).toBeVisible();
    const clean = json(join(out, "clean.lucid"));
    expect(clean["transcripts"]).toEqual([]);
    expect(clean["changeLog"]).toEqual([]);
    expect(clean["doc"]).toEqual(whole["doc"]);

    // The note in the library is as it was.
    expect(lucidFiles(home)).toHaveLength(1);
  } finally {
    await app.close();
  }
});

test("Export note: cancelling saves nothing, and the Lucid folder itself is refused in words", async () => {
  test.setTimeout(60_000);
  const { app, page, home } = await launch();
  try {
    await seed(page);
    await app.evaluate(({ dialog }) => {
      dialog.showSaveDialog = () => Promise.resolve({ canceled: true, filePath: "" });
    });
    await page.getByRole("button", { name: "Export note" }).click();
    await exportDialog(page).getByRole("button", { name: "Export…" }).click();
    await expect(exportDialog(page)).toHaveCount(0);
    await expect(page.getByText(/^Saved .*\.lucid/)).toHaveCount(0);

    await saveTo(app, join(home, "inside.lucid"));
    await page.getByRole("button", { name: "Export note" }).click();
    await exportDialog(page).getByRole("button", { name: "Export…" }).click();
    await expect(page.getByText(/outside your Lucid folder/)).toBeVisible();
    expect(lucidFiles(home)).toHaveLength(1);
  } finally {
    await app.close();
  }
});

test("Import note brings a note into another library with its history, refuses bad files in words, and keeps both when it is already there", async () => {
  test.setTimeout(120_000);
  const out = mkdtempSync(join(tmpdir(), "lucid-out-"));
  const file = join(out, "scaling.lucid");
  {
    const { app, page } = await launch();
    try {
      await seed(page);
      await saveTo(app, file);
      await page.getByRole("button", { name: "Export note" }).click();
      await exportDialog(page).getByRole("button", { name: "Export…" }).click();
      await expect(page.getByText("Saved scaling.lucid.")).toBeVisible();
    } finally {
      await app.close();
    }
  }
  const notANote = join(out, "other.lucid");
  writeFileSync(notANote, JSON.stringify({ hello: "world" }));
  const notJson = join(out, "plain.lucid");
  writeFileSync(notJson, "this is just text");
  const damaged = join(out, "damaged.lucid");
  writeFileSync(
    damaged,
    JSON.stringify({
      ...json(file),
      id: "other-id",
      doc: { blocks: [{ id: "x", type: "table", props: { nonsense: true } }] },
    }),
  );

  const { app, page, home } = await launch();
  try {
    await openFiles(app, [file, notANote, notJson, damaged]);
    await page.getByRole("button", { name: "Import a note…" }).click();
    const notice = page.locator(".import-notice");
    await expect(notice).toContainText("Imported Scaling notes.");
    await expect(notice).toContainText(
      "other.lucid could not be imported: This file is not a Lucid page.",
    );
    await expect(notice).toContainText(
      "plain.lucid could not be imported: This file is not a Lucid page.",
    );
    await expect(notice).toContainText("damaged.lucid could not be imported: This page is damaged");
    await expect(notice).toContainText("Nothing was changed.");

    // It is in the list and open, with what was said and its history; the newest change can still be taken back.
    await expect(page.getByLabel("Page title")).toHaveValue("Scaling notes");
    await expect(
      page
        .getByRole("navigation", { name: "Pages" })
        .getByRole("button", { name: /Scaling notes/ }),
    ).toHaveCount(1);
    await showHistory(page);
    const history = page.getByRole("complementary", { name: "History" });
    await expect(history).toContainText("Added a table");
    await expect(history).toContainText("Added a note");
    await expect(history).toContainText("start with one server");
    await expect(
      history.locator(".changes li").first().getByRole("button", { name: "Revert" }),
    ).toBeEnabled();
    expect(lucidFiles(home)).toHaveLength(1);

    // The same note again: both are kept.
    await openFiles(app, [file]);
    await page.getByRole("button", { name: "Import a note…" }).click();
    await expect(page.locator(".import-notice")).toContainText(
      "You already had this note, so both are kept.",
    );
    await expect(page.getByLabel("Page title")).toHaveValue("Scaling notes (copy)");
    expect(lucidFiles(home)).toHaveLength(2);
    // Cancelling the picker changes nothing.
    await app.evaluate(({ dialog }) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: true, filePaths: [] });
    });
    await page.getByRole("button", { name: "Import a note…" }).click();
    await page.waitForTimeout(500);
    expect(lucidFiles(home)).toHaveLength(2);
  } finally {
    await app.close();
  }
});

test("the File menu has Import Note… and Export Note…, and they do what the buttons do", async () => {
  test.setTimeout(90_000);
  const out = mkdtempSync(join(tmpdir(), "lucid-out-"));
  const file = join(out, "menu.lucid");
  const { app, page, home } = await launch();
  try {
    const keys = await app.evaluate(({ Menu }) =>
      ["import-note", "export-note"].map(
        (id) => Menu.getApplicationMenu()?.getMenuItemById(id)?.accelerator ?? "",
      ),
    );
    expect(keys).toEqual(["CommandOrControl+O", "Shift+CommandOrControl+E"]);

    await seed(page);
    await app.evaluate(({ Menu }) => {
      Menu.getApplicationMenu()?.getMenuItemById("export-note")?.click();
    });
    await expect(exportDialog(page)).toBeVisible();
    await saveTo(app, file);
    await exportDialog(page).getByRole("button", { name: "Export…" }).click();
    await expect(page.getByText("Saved menu.lucid.")).toBeVisible();

    await openFiles(app, [file]);
    await app.evaluate(({ Menu }) => {
      Menu.getApplicationMenu()?.getMenuItemById("import-note")?.click();
    });
    await expect(page.locator(".import-notice")).toContainText("both are kept");
    expect(lucidFiles(home)).toHaveLength(2);
  } finally {
    await app.close();
  }
});
