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
  withDiagramPage = false,
): Promise<{ app: ElectronApplication; page: Page; home: string }> {
  mock = await startMockLmStudio({ script });
  const home = mkdtempSync(join(tmpdir(), "lucid-home-"));
  const app = await electron.launch({
    args: [join(__dirname, "../out/main/index.js")],
    env: { ...process.env, LUCID_HOME: home, LUCID_LLM_URL: mock.url },
  });
  const page = await app.firstWindow();
  await maximizeWindow(app, page);
  if (withDiagramPage) {
    await page.evaluate(async (doc) => {
      const file = await window.lucid.pages.create("Request flow and databases");
      await window.lucid.pages.save({ ...file, doc });
    }, COMMAND_DOC);
    await page.reload();
    await expect(page.locator(".page-editor")).toContainText("MongoDB");
  } else {
    await page.getByRole("complementary").getByRole("button", { name: "New page" }).click();
    await expect(page.getByLabel("Page title")).toBeFocused();
    await page.keyboard.type("Request flow");
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
const workbench = (page: Page) => page.getByRole("region", { name: "Diagram builder" });
const numbers = (page: Page) => workbench(page).getByLabel("Numbers");
const figures = (page: Page) => page.locator(".page-editor figure.figure");

/** The diagram blocks of the page file on disk. */
function savedDiagrams(home: string): {
  nodes: { label: string }[];
  edges: { id: string; from: string; to: string; label?: string }[];
}[] {
  const file = readdirSync(home).find((n) => n !== ".lucid" && n.endsWith(".lucid"));
  const saved = JSON.parse(readFileSync(join(home, file ?? ""), "utf8")) as {
    doc: { blocks: { type: string; props: { graph?: never } }[] };
  };
  return saved.doc.blocks.filter((b) => b.type === "diagram").map((b) => b.props.graph as never);
}

test("keywords first, then numbered connections, then fixes by number, all without the model, ending as one undo step", async () => {
  test.setTimeout(90_000);
  const { app, page, home } = await launch([]);
  try {
    await say(page, "diagram mode");
    await expect(workbench(page)).toBeVisible();
    await expect(page.getByRole("tab", { name: "1 Components", selected: true })).toBeVisible();

    await say(page, "add keywords: client, server, DNS, database");
    await expect(numbers(page)).toContainText("1 Client");
    await expect(numbers(page)).toContainText("4 Database");
    await expect(workbench(page).getByRole("status")).toContainText("Added 4 components");

    await say(page, "connections");
    await expect(page.getByRole("tab", { name: "2 Connections", selected: true })).toBeVisible();
    await say(page, "client to server");
    await say(page, "server to DNS");
    await say(page, "from server to client returns HTML");
    await say(page, "server to database");
    await expect(numbers(page)).toContainText("#1 Client → Server");
    await expect(numbers(page)).toContainText("#3 Server → Client “returns HTML”");
    await expect(numbers(page)).toContainText("#4 Server → Database");
    // The drawing carries the same numbers the person speaks.
    await expect(workbench(page).locator(".wb-svg svg")).toContainText("#3 returns HTML");

    await say(page, "edit");
    await say(page, "reverse 2");
    await say(page, "connection 2 is resolve domain");
    await expect(numbers(page)).toContainText("#2 DNS → Server “resolve domain”");

    // A wrong fix is undone inside the builder, one step at a time.
    await say(page, "delete connection 4");
    await expect(numbers(page)).not.toContainText("#4");
    await say(page, "undo");
    await expect(numbers(page)).toContainText("#4 Server → Database");

    await say(page, "done");
    await expect(workbench(page)).toBeHidden();
    await expect(figures(page)).toHaveCount(1);
    await expect(figures(page).first()).toContainText("resolve domain", { timeout: 20_000 });
    // The numbers are scaffolding: they are not in the page.
    // (Only the words in the drawing: the SVG also carries its stylesheet, whose colours look like "#2c2c2b".)
    const words = await figures(page).first().locator("svg text").allInnerTexts();
    expect(words.join(" ")).not.toContain("#2");
    expect(mock?.requests.length).toBe(0);

    await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible({
      timeout: 15_000,
    });
    const [graph] = savedDiagrams(home);
    expect(graph?.nodes.map((n) => n.label)).toEqual(["Client", "Server", "DNS", "Database"]);
    expect(graph?.edges.map((e) => `${e.from}>${e.to}${e.label ? `[${e.label}]` : ""}`)).toEqual([
      "client>server",
      "dns>server[resolve domain]",
      "server>client[returns HTML]",
      "server>database",
    ]);

    // One spoken "undo" removes the whole diagram; "redo" brings it back.
    await say(page, "undo");
    await expect(figures(page)).toHaveCount(0);
    await say(page, "redo");
    await expect(figures(page)).toHaveCount(1);
  } finally {
    await app.close();
  }
});

test("an existing diagram opens in the builder with its parts numbered, and the fixes land as one undo step", async () => {
  test.setTimeout(90_000);
  const { app, page } = await launch([], true);
  try {
    await expect(figures(page).first()).toContainText("Web Server", { timeout: 20_000 });
    await figures(page).first().hover();
    await page.getByRole("button", { name: "Edit diagram" }).click();
    await expect(workbench(page)).toBeVisible();
    await expect(page.getByRole("tab", { name: "3 Edit", selected: true })).toBeVisible();
    await expect(numbers(page)).toContainText("2 Web Server");
    await expect(numbers(page)).toContainText("#5 Web Server → Client");

    await say(page, "rename 2 to API gateway");
    await expect(numbers(page)).toContainText("2 API gateway");
    await say(page, "done");
    await expect(workbench(page)).toBeHidden();
    await expect(figures(page).first()).toContainText("API gateway", { timeout: 20_000 });
    expect(mock?.requests.length).toBe(0);

    await say(page, "undo");
    await expect(figures(page).first()).toContainText("Web Server", { timeout: 20_000 });
    await expect(figures(page).first()).not.toContainText("API gateway");
  } finally {
    await app.close();
  }
});

test("what the grammar cannot read goes to the model with the numbering, and its fix keeps the numbers", async () => {
  test.setTimeout(90_000);
  const fix = json({
    summary: "Added a Cache between the server and the database",
    ops: [
      {
        op: "graph.patch",
        target: "b1",
        lines: ["cache [cache]: Cache", "server -> cache: check cache"],
      },
    ],
  });
  const { app, page } = await launch([reply(fix)]);
  try {
    await say(page, "diagram mode");
    await say(page, "client, server, database");
    await say(page, "connections");
    await say(page, "client to server");
    await say(page, "server to database");
    await say(page, "edit");

    await say(page, "make the read path quicker somehow");
    await expect(numbers(page)).toContainText("4 Cache", { timeout: 30_000 });
    await expect(numbers(page)).toContainText("#3 Server → Cache “check cache”");
    await expect(workbench(page).getByRole("status")).toContainText("Changed: added Cache");
    // The earlier numbers did not move.
    await expect(numbers(page)).toContainText("3 Database");

    const sent = JSON.stringify(mock?.requests[0]?.body);
    expect(sent).toContain("refers to parts by number");
    expect(sent).toContain("1 = client (Client)");
    expect(sent).toContain("connection 2 = e2 (Server to Database)");
    expect(mock?.requests[0]?.body).toMatchObject({ reasoning_effort: "none" });
  } finally {
    await app.close();
  }
});

test("thinking aloud collects notes, and 'draw it' makes the diagram from them", async () => {
  test.setTimeout(90_000);
  const drawing = `\`\`\`graph type=flowchart dir=LR title="Flow"
client [client]: Client
cdn [cdn]: CDN
origin [service]: Origin
client -> cdn: request
cdn -> origin: cache miss
\`\`\``;
  const { app, page } = await launch([reply(drawing)]);
  try {
    await say(page, "diagram mode");
    await say(page, "think");
    await expect(page.getByRole("tab", { name: "Think", selected: true })).toBeVisible();
    await say(page, "the client asks the CDN first");
    await say(page, "actually the CDN only goes to the origin on a cache miss");
    await expect(workbench(page).getByRole("status")).toContainText("Noted");

    await say(page, "draw it");
    await expect(numbers(page)).toContainText("2 CDN", { timeout: 30_000 });
    await expect(page.getByRole("tab", { name: "3 Edit", selected: true })).toBeVisible();
    await expect(numbers(page)).toContainText("#2 CDN → Origin “cache miss”");

    // Both things the person said were in what the model was asked to draw.
    const last = JSON.stringify(mock?.requests[0]?.body);
    expect(last).toContain("the client asks the CDN first");
    expect(last).toContain("later one wins");

    await say(page, "done");
    await expect(figures(page)).toHaveCount(1);
    await expect(figures(page).first()).toContainText("cache miss", { timeout: 20_000 });
  } finally {
    await app.close();
  }
});

test("an ambiguous fix asks, and the answer can be spoken", async () => {
  test.setTimeout(90_000);
  const { app, page } = await launch([]);
  try {
    await say(page, "diagram mode");
    await say(page, "client, server, database");
    await say(page, "connections");
    await say(page, "client to server");
    await say(page, "server to database");
    await say(page, "edit");

    await say(page, "delete 2");
    const question = workbench(page).getByRole("group", { name: "Question" });
    await expect(question).toContainText("Delete component 2 or connection 2?");

    await say(page, "the second one");
    await expect(question).toBeHidden();
    await expect(numbers(page)).toContainText("2 Server");
    await expect(numbers(page)).not.toContainText("#2");
    await expect(numbers(page)).toContainText("#1 Client → Server");
  } finally {
    await app.close();
  }
});

test("a half-built diagram survives a reload, and Cancel throws it away without touching the page", async () => {
  test.setTimeout(90_000);
  const { app, page } = await launch([]);
  try {
    await say(page, "diagram mode");
    await say(page, "client, server");
    await expect(numbers(page)).toContainText("2 Server");
    await expect(page.getByText("Saved")).toBeVisible({ timeout: 15_000 });

    await page.reload();
    await expect(workbench(page)).toBeVisible();
    await expect(numbers(page)).toContainText("2 Server");

    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(workbench(page)).toBeHidden();
    await expect(figures(page)).toHaveCount(0);
    await page.reload();
    await expect(bar(page)).toBeVisible();
    await expect(workbench(page)).toBeHidden();
  } finally {
    await app.close();
  }
});
