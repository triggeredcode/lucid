import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COMMAND_DOC } from "@lucid/llm";
import { startMockLmStudio, type Behaviour, type MockLmStudio } from "@lucid/mock-lmstudio";
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { maximizeWindow } from "./helpers";

let mock: MockLmStudio | undefined;
test.afterEach(async () => {
  await mock?.close();
  mock = undefined;
});

const reply = (content: string): Behaviour => ({ kind: "reply", content, chunkChars: 400 });
const json = (over: Record<string, unknown>) =>
  JSON.stringify({
    kind: "edit",
    summary: null,
    ops: null,
    question: null,
    options: null,
    reason: null,
    ...over,
  });

async function launch(
  script: Behaviour[],
  opts: { withPage?: boolean } = {},
): Promise<{ app: ElectronApplication; page: Page; home: string }> {
  mock = await startMockLmStudio({ script });
  const home = mkdtempSync(join(tmpdir(), "lucid-home-"));
  const app = await electron.launch({
    args: [join(__dirname, "../out/main/index.js")],
    env: { ...process.env, LUCID_HOME: home, LUCID_LLM_URL: mock.url },
  });
  const page = await app.firstWindow();
  await maximizeWindow(app, page);
  if (opts.withPage) {
    await page.evaluate(async (doc) => {
      const file = await window.lucid.pages.create("Request flow and databases");
      await window.lucid.pages.save({ ...file, doc });
    }, COMMAND_DOC);
    await page.reload();
    await expect(page.locator(".page-editor")).toContainText("MongoDB");
  } else {
    await page.getByRole("complementary").getByRole("button", { name: "New page" }).click();
    await expect(page.getByLabel("Page title")).toBeFocused();
    await page.keyboard.type("SQL vs NoSQL");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    await expect(bar(page)).toBeVisible();
  }
  return { app, page, home };
}

const bar = (page: Page) => page.getByLabel("Dictate or type your notes");
const say = async (page: Page, text: string) => {
  await bar(page).fill(text);
  await bar(page).press("Enter");
};
const workbench = (page: Page) => page.getByRole("region", { name: "Table builder" });
const grid = (page: Page) => workbench(page).getByRole("table", { name: "Table being built" });
const gridRows = (page: Page) => grid(page).locator("tbody tr");
/** The text of each row of the grid, without the row number. */
const gridText = async (page: Page): Promise<string[][]> =>
  grid(page)
    .locator("tbody tr")
    .evaluateAll((trs) =>
      trs.map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent.trim())),
    );
const pageTables = (page: Page) => page.locator(".page-editor table.lucid-table");

function savedTables(home: string): { columns: { name: string }[]; rows: { cells: string[] }[] }[] {
  const file = readdirSync(home).find((n) => n !== ".lucid" && n.endsWith(".lucid"));
  const saved = JSON.parse(readFileSync(join(home, file ?? ""), "utf8")) as {
    doc: { blocks: { type: string; props: { table?: never } }[] };
  };
  return saved.doc.blocks.filter((b) => b.type === "table").map((b) => b.props.table as never);
}

test("columns, then rows said three ways, then fixes by number, in a maximized window, ending as one undo step", async () => {
  test.setTimeout(90_000);
  const { app, page, home } = await launch([]);
  try {
    await say(page, "table mode");
    await expect(workbench(page)).toBeVisible();
    await expect(page.getByRole("tab", { name: "1 Columns", selected: true })).toBeVisible();

    await say(page, "three columns: property, SQL, NoSQL");
    await expect(grid(page).locator("thead th").nth(2)).toContainText("2 SQL");
    await expect(workbench(page).getByRole("status")).toContainText("Added 3 columns");

    await say(page, "rows");
    await say(page, "schema, fixed, flexible");
    // One cell at a time: each phrase goes to the next empty cell, "skip" leaves one empty.
    await say(page, "relationships");
    await say(page, "joins");
    await expect(grid(page).locator('td[data-cursor="true"]')).toHaveCount(1);
    await say(page, "denormalised");
    await say(page, "scaling");
    await say(page, "skip");
    await say(page, "horizontal");
    // By column.
    await say(page, "SQL column: fixed, joins, vertical");
    expect(await gridText(page)).toEqual([
      ["Schema", "Fixed", "Flexible"],
      ["Relationships", "Joins", "Denormalised"],
      ["Scaling", "Vertical", "Horizontal"],
    ]);

    await say(page, "edit");
    await say(page, "cell 2 3 is embedded documents");
    await say(page, "add column consistency");
    await say(page, "delete row 3");
    await say(page, "undo");
    await expect(gridRows(page)).toHaveCount(3);
    await say(page, "row 3 column consistency is eventual");

    // The window really is big, and the builder fits it without scrolling sideways.
    const fits = await page.evaluate(() => {
      const box = document.querySelector(".wb-grid")?.getBoundingClientRect();
      return {
        width: window.innerWidth,
        sideways: document.documentElement.scrollWidth > window.innerWidth,
        gridWidth: box?.width ?? 0,
      };
    });
    expect(fits.sideways).toBe(false);
    expect(fits.gridWidth).toBeGreaterThan(700);

    await say(page, "done");
    await expect(workbench(page)).toBeHidden();
    await expect(pageTables(page)).toHaveCount(1);
    await expect(pageTables(page).first()).toContainText("Embedded documents");
    await expect(pageTables(page).locator("thead th")).toHaveText([
      "Property",
      "SQL",
      "NoSQL",
      "Consistency",
    ]);
    // Row and column numbers are scaffolding: they are not in the page.
    await expect(pageTables(page).first()).not.toContainText("1 Property");
    expect(mock?.requests.length).toBe(0);

    await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible({
      timeout: 15_000,
    });
    const [table] = savedTables(home);
    expect(table?.columns.map((c) => c.name)).toEqual(["Property", "SQL", "NoSQL", "Consistency"]);
    expect(table?.rows.map((r) => r.cells)).toEqual([
      ["Schema", "Fixed", "Flexible", ""],
      ["Relationships", "Joins", "Embedded documents", ""],
      ["Scaling", "Vertical", "Horizontal", "Eventual"],
    ]);

    // One spoken "undo" takes the whole table out; "redo" brings it back.
    await say(page, "undo");
    await expect(pageTables(page)).toHaveCount(0);
    await say(page, "redo");
    await expect(pageTables(page)).toHaveCount(1);
  } finally {
    await app.close();
  }
});

test("an existing table opens from its own button, and the fixes land as one undo step", async () => {
  test.setTimeout(90_000);
  const { app, page } = await launch([], { withPage: true });
  try {
    await pageTables(page).first().hover();
    await page.getByRole("button", { name: "Edit table" }).click();
    await expect(workbench(page)).toBeVisible();
    await expect(page.getByRole("tab", { name: "3 Edit", selected: true })).toBeVisible();
    expect(await gridText(page)).toEqual([
      ["Schema", "Fixed", "Flexible"],
      ["Relationships", "Joins", "Denormalised"],
      ["Scaling", "Vertical", "Horizontal"],
    ]);

    await say(page, "cell 2 3 is embedded documents");
    await say(page, "delete row 3");
    await say(page, "done");
    await expect(workbench(page)).toBeHidden();
    await expect(pageTables(page).first()).toContainText("Embedded documents");
    await expect(pageTables(page).first()).not.toContainText("Scaling");
    expect(mock?.requests.length).toBe(0);

    await say(page, "undo");
    await expect(pageTables(page).first()).toContainText("Scaling");
    await expect(pageTables(page).first()).not.toContainText("Embedded documents");
  } finally {
    await app.close();
  }
});

test("what the grammar cannot read goes to the model with the numbering", async () => {
  test.setTimeout(90_000);
  const fix = json({
    summary: "Spelled out the NoSQL scaling cell",
    ops: [
      {
        op: "table.set_cells",
        target: "b1",
        row: "r2",
        cells: [{ col: "c3", text: "Horizontal, by sharding" }],
      },
    ],
  });
  const { app, page } = await launch([reply(fix)]);
  try {
    await say(page, "table mode");
    await say(page, "property, SQL, NoSQL");
    await say(page, "rows");
    await say(page, "schema, fixed, flexible");
    await say(page, "scaling, vertical, horizontal");
    await say(page, "edit");

    await say(page, "make the NoSQL scaling cell say how it scales");
    await expect(grid(page)).toContainText("Horizontal, by sharding", { timeout: 30_000 });
    expect((await gridText(page))[0]).toEqual(["Schema", "Fixed", "Flexible"]);
    // The echo says what really changed, not only what the model said it did.
    await expect(workbench(page).getByRole("status")).toContainText("Changed: 1 cell: row 2 NoSQL");

    const sent = JSON.stringify(mock?.requests[0]?.body);
    expect(sent).toContain("rows from the top, columns from the left");
    expect(sent).toContain("3 = c3 (NoSQL)");
    expect(sent).toContain("2 = r2 (Scaling)");
    expect(mock?.requests[0]?.body).toMatchObject({ reasoning_effort: "none" });
  } finally {
    await app.close();
  }
});

test("thinking aloud collects notes, and 'draw it' makes the table from them", async () => {
  test.setTimeout(90_000);
  const made = `Table: Options
| Option | Verdict |
| --- | --- |
| PostgreSQL | Joins are needed |
| DynamoDB | Key-value at scale |`;
  const { app, page } = await launch([reply(made)]);
  try {
    await say(page, "table mode");
    await say(page, "think");
    await expect(page.getByRole("tab", { name: "Think", selected: true })).toBeVisible();
    await say(page, "I am comparing PostgreSQL and DynamoDB");
    await say(page, "actually postgres wins when joins are needed, dynamo for key value at scale");
    await expect(workbench(page).getByRole("status")).toContainText("Noted");

    await say(page, "draw it");
    await expect(grid(page)).toContainText("DynamoDB", { timeout: 30_000 });
    await expect(page.getByRole("tab", { name: "3 Edit", selected: true })).toBeVisible();
    const last = JSON.stringify(mock?.requests[0]?.body);
    expect(last).toContain("I am comparing PostgreSQL and DynamoDB");
    expect(last).toContain("later one wins");

    await say(page, "done");
    await expect(pageTables(page)).toHaveCount(1);
    await expect(pageTables(page).first()).toContainText("Key-value at scale");
  } finally {
    await app.close();
  }
});

test("an ambiguous number asks, and the answer can be spoken", async () => {
  test.setTimeout(90_000);
  const { app, page } = await launch([]);
  try {
    await say(page, "table mode");
    await say(page, "property, SQL, NoSQL");
    await say(page, "rows");
    await say(page, "schema, fixed, flexible");
    await say(page, "scaling, vertical, horizontal");
    await say(page, "edit");

    await say(page, "delete 2");
    const question = workbench(page).getByRole("group", { name: "Question" });
    await expect(question).toContainText("Delete row 2 or column 2?");
    await say(page, "the second one");
    await expect(question).toBeHidden();
    await expect(grid(page).locator("thead th")).toHaveCount(3);
    expect(await gridText(page)).toEqual([
      ["Schema", "Flexible"],
      ["Scaling", "Horizontal"],
    ]);
  } finally {
    await app.close();
  }
});

test("a half-built table survives a reload, and Cancel throws it away without touching the page", async () => {
  test.setTimeout(90_000);
  const { app, page } = await launch([]);
  try {
    await say(page, "table mode");
    await say(page, "property, SQL");
    await say(page, "rows");
    await say(page, "schema, fixed");
    await expect(page.getByText("Saved")).toBeVisible({ timeout: 15_000 });

    await page.reload();
    await expect(workbench(page)).toBeVisible();
    expect(await gridText(page)).toEqual([["Schema", "Fixed"]]);

    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(workbench(page)).toBeHidden();
    await expect(pageTables(page)).toHaveCount(0);
    await page.reload();
    await expect(bar(page)).toBeVisible();
    await expect(workbench(page)).toBeHidden();
  } finally {
    await app.close();
  }
});
