import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Block } from "@lucid/core";
import { COMMAND_DOC } from "@lucid/llm";
import { registry } from "@lucid/kit";
import { startMockLmStudio, type Behaviour, type MockLmStudio } from "@lucid/mock-lmstudio";
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { maximizeWindow } from "./helpers";

/**
 * A light number in the margin of every block (B1, B2, ...): a list is one block, a table is one, a diagram is one. They are the
 * references the model uses, so "item 2 of block 4" means the same to the person and the model.
 */
const text = (s: string) => ({ type: "text" as const, text: s, styles: {} });
const fixture = (type: Block["type"]): Block => {
  const found = registry.get(type).fixtures[0];
  if (!found) throw new Error(`no fixture for ${type}`);
  return found;
};
// 1 heading, 2 paragraph, 3 diagram, 4 list of three, 5 table, 6 numbered list of two
const blocks = (): Block[] => [
  { id: "h1", type: "heading", props: { level: 2 }, content: [text("Caching")], children: [] },
  {
    id: "p1",
    type: "paragraph",
    props: {},
    content: [text("A cache hit costs microseconds.")],
    children: [],
  },
  fixture("diagram"),
  { id: "o1", type: "bulletListItem", props: {}, content: [text("Redis")], children: [] },
  { id: "o2", type: "bulletListItem", props: {}, content: [text("Memcached")], children: [] },
  { id: "o3", type: "bulletListItem", props: {}, content: [text("Local LRU")], children: [] },
  fixture("table"),
  { id: "n1", type: "numberedListItem", props: {}, content: [text("Client to DNS")], children: [] },
  { id: "n2", type: "numberedListItem", props: {}, content: [text("DNS answers")], children: [] },
];

let mock: MockLmStudio | undefined;
test.afterEach(async () => {
  await mock?.close();
  mock = undefined;
});

async function launch(
  doc: { blocks: Block[] },
  script: Behaviour[] = [],
): Promise<{ app: ElectronApplication; page: Page }> {
  mock = await startMockLmStudio({ script });
  const app = await electron.launch({
    args: [join(__dirname, "../out/main/index.js")],
    env: {
      ...process.env,
      LUCID_HOME: mkdtempSync(join(tmpdir(), "lucid-home-")),
      LUCID_LLM_URL: mock.url,
    },
  });
  const page = await app.firstWindow();
  await maximizeWindow(app, page);
  await page.evaluate(async (d) => {
    const file = await window.lucid.pages.create("Block notes");
    await window.lucid.pages.save({ ...file, doc: d });
  }, doc);
  await page.reload();
  await page
    .getByRole("navigation", { name: "Pages" })
    .getByRole("button", { name: /Block notes/ })
    .click();
  await expect(page.locator(".page-editor")).toContainText("Caching");
  return { app, page };
}

const labels = (page: Page) => page.locator(".block-no");
const menu = (app: ElectronApplication, id: string) =>
  app.evaluate(({ Menu }, itemId) => {
    Menu.getApplicationMenu()?.getMenuItemById(itemId)?.click();
  }, id);

/** The vertical distance from the top of a block's content to the middle of its number (it must be on the first line). */
async function offset(page: Page, label: number, blockId: string): Promise<number> {
  const l = await labels(page).nth(label).boundingBox();
  const b = await page
    .locator(`.bn-block-outer[data-id="${blockId}"] .bn-block-content`)
    .first()
    .boundingBox();
  if (!l || !b) throw new Error("no box");
  return l.y + l.height / 2 - b.y;
}

test("every block has a light number in the margin: a list is one, a table is one, a diagram is one", async () => {
  test.setTimeout(90_000);
  const { app, page } = await launch({ blocks: blocks() });
  try {
    await expect(labels(page)).toHaveText(["B1", "B2", "B3", "B4", "B5", "B6"]);
    const names = await labels(page).evaluateAll((els) =>
      els.map((e) => e.getAttribute("aria-label")),
    );
    expect(names).toEqual([
      "Block 1: heading Caching",
      "Block 2: paragraph A cache hit costs microseconds.",
      expect.stringMatching(/^Block 3: diagram /) as unknown as string,
      "Block 4: list 3 items",
      expect.stringMatching(/^Block 5: table /) as unknown as string,
      "Block 6: list 2 items",
    ]);
    // Each number is beside the first line of its block, in the margin (left of the text).
    const text0 = await page.locator(".bn-editor").boundingBox();
    for (const [i, id] of ["h1", "p1", "dg-placeholder", "o1", "tb-placeholder", "n1"].entries()) {
      const box = await labels(page).nth(i).boundingBox();
      expect(
        box && text0 && box.x + box.width <= text0.x,
        `label ${String(i + 1)} is in the margin`,
      ).toBe(true);
      if (id.endsWith("placeholder")) continue;
      const d = await offset(page, i, id);
      expect(d, `label ${String(i + 1)} is on the first line`).toBeGreaterThan(-4);
      expect(d).toBeLessThan(30);
    }
  } finally {
    await app.close();
  }
});

test("a click on a number shows the parts of the block, and what to say", async () => {
  test.setTimeout(60_000);
  const { app, page } = await launch({ blocks: blocks() });
  try {
    await labels(page).nth(3).click();
    const parts = page.getByRole("dialog", { name: "Parts of block 4" });
    await expect(parts).toContainText("Redis");
    await expect(parts).toContainText("Local LRU");
    await expect(parts).toContainText("item 2 of block 4");
    // The table: columns from the left and rows from the top, with what to say.
    await labels(page).nth(4).click();
    const table = page.getByRole("dialog", { name: "Parts of block 5" });
    await expect(table).toContainText("Columns");
    await expect(table).toContainText("Rows");
    await expect(table).toContainText("row 2 of block 5");
    await expect(page.getByRole("dialog", { name: "Parts of block 4" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(table).toHaveCount(0);
    // The diagram: its parts and connections in the order the builder numbers them.
    await labels(page).nth(2).click();
    const diagram = page.getByRole("dialog", { name: "Parts of block 3" });
    await expect(diagram).toContainText("Parts");
    await expect(diagram).toContainText("Connections");
    await expect(diagram).toContainText("node 2 of block 3");
  } finally {
    await app.close();
  }
});

test("the numbers follow the page: zoom, and a block added by hand", async () => {
  test.setTimeout(90_000);
  const { app, page } = await launch({ blocks: blocks() });
  try {
    for (let i = 0; i < 3; i++) await menu(app, "zoom-in");
    await expect(page.locator(".zoom-chip")).toHaveText("150%");
    // Still beside the first line of their block, with the page bigger.
    await expect.poll(() => offset(page, 1, "p1")).toBeGreaterThan(-4);
    expect(await offset(page, 1, "p1")).toBeLessThan(45);
    await expect.poll(() => offset(page, 3, "o1")).toBeLessThan(45);
    await menu(app, "zoom-reset");

    // A new paragraph typed by hand after the heading: the numbers move down by one.
    await page.keyboard.press("Meta+3");
    await page.locator('.bn-block-outer[data-id="h1"] .bn-inline-content').click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("A new paragraph");
    await expect(labels(page)).toHaveCount(7);
    await expect(labels(page).nth(1)).toHaveAttribute(
      "aria-label",
      /^Block 2: paragraph A new paragraph/,
    );
    await expect(labels(page).nth(4)).toHaveAttribute("aria-label", "Block 5: list 3 items");
  } finally {
    await app.close();
  }
});

test("Settings can hide the numbers, and the choice is remembered", async () => {
  test.setTimeout(60_000);
  const { app, page } = await launch({ blocks: blocks() });
  try {
    await expect(labels(page)).toHaveCount(6);
    await page.keyboard.press("Meta+,");
    const dialog = page.getByRole("dialog", { name: "Settings" });
    await dialog.getByRole("radio", { name: "Hide" }).click();
    await page.keyboard.press("Escape");
    await expect(labels(page)).toHaveCount(0);
    await page.reload();
    await page
      .getByRole("navigation", { name: "Pages" })
      .getByRole("button", { name: /Block notes/ })
      .click();
    await expect(page.locator(".page-editor")).toContainText("Caching");
    await expect(labels(page)).toHaveCount(0);
    await page.keyboard.press("Meta+,");
    await page
      .getByRole("dialog", { name: "Settings" })
      .getByRole("radio", { name: "Show" })
      .click();
    await page.keyboard.press("Escape");
    await expect(labels(page)).toHaveCount(6);
  } finally {
    await app.close();
  }
});

test("what the person says reaches the model as the reference the margin shows", async () => {
  test.setTimeout(60_000);
  const strike = JSON.stringify({
    kind: "edit",
    summary: "Crossed out MongoDB",
    ops: [{ op: "set_status", target: "b6.2", in: null, status: "struck" }],
    question: null,
    options: null,
    reason: null,
  });
  const { app, page } = await launch(COMMAND_DOC, [
    { kind: "reply", content: strike, chunkChars: 400 },
  ]);
  try {
    // COMMAND_DOC: b1 heading, b2 paragraph, b3 diagram, b4 table, b5 heading, b6 the three options.
    await expect(labels(page)).toHaveCount(6);
    await page
      .getByRole("group", { name: "Mode" })
      .getByRole("button", { name: "Command" })
      .click();
    const bar = page.getByLabel("Dictate or type your notes");
    await bar.fill("Cross out item 2 of block 6");
    await bar.press("Enter");
    await expect(page.getByText("Crossed out MongoDB.")).toBeVisible({ timeout: 20_000 });
    const sent =
      (mock?.requests[0]?.body["messages"] as { content: string }[]).at(-1)?.content ?? "";
    expect(sent).toContain("BLOCK NUMBERS");
    expect(sent).toMatch(/"item 2 of block 6" → \[b6\.2\] "MongoDB"/);
  } finally {
    await app.close();
  }
});
