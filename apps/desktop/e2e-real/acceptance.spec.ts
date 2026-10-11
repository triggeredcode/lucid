import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COMMAND_DOC } from "@lucid/llm";
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { maximizeWindow } from "../e2e/helpers";

/**
 * The acceptance scenarios (A to I), driven through the real app in a maximized window against the REAL
 * model in LM Studio (`pnpm e2e:real`). Nothing is faked: a person's words go into the input box, the model answers, the
 * page changes, and the checks read the saved page. They are tolerant about wording (a model never writes the same
 * sentence twice) and strict about structure (which blocks exist, what is connected, what was kept).
 *
 * The scenarios run in order: A, B, D, G and H on one page (the way notes grow), then C, E and F on ready-made pages,
 * then I closes the app and opens it again.
 */

interface Blk {
  id: string;
  type: string;
  props: Record<string, unknown>;
  content?: unknown;
  children?: Blk[];
}
interface Graph {
  nodes: { id: string; label: string }[];
  edges: { id: string; from: string; to: string; label: string }[];
}
interface Tbl {
  columns: { id: string; name: string }[];
  rows: { id: string; cells: string[] }[];
}
interface Saved {
  title: string;
  changeLog: { summary: string }[];
  doc: { blocks: Blk[] };
}

const flat = (blocks: Blk[]): Blk[] => blocks.flatMap((b) => [b, ...flat(b.children ?? [])]);
const textOf = (b: Blk): string =>
  Array.isArray(b.content)
    ? (b.content as { text?: string }[]).map((c) => c.text ?? "").join("")
    : "";
const graphOf = (b: Blk): Graph => b.props["graph"] as Graph;
const tableOf = (b: Blk): Tbl => b.props["table"] as Tbl;
const ofType = (doc: Saved, type: string): Blk[] =>
  flat(doc.doc.blocks).filter((b) => b.type === type);
const allText = (doc: Saved): string => flat(doc.doc.blocks).map(textOf).join("\n");
const ids = (doc: Saved): string[] => flat(doc.doc.blocks).map((b) => b.id);

const CLIENT = /client|user|browser/i;
const DNS = /dns/i;
const WEB = /web|application|app server|api/i;
const REDIS = /redis|cache/i;
const PG = /postgres|database|\bdb\b/i;
/** Is there a connection from a node named like `a` to one named like `b` (or either way round)? */
function linked(g: Graph, a: RegExp, b: RegExp, eitherWay = false): boolean {
  const label = (id: string) => g.nodes.find((n) => n.id === id)?.label ?? "";
  return g.edges.some((e) => {
    const f = label(e.from);
    const t = label(e.to);
    return (a.test(f) && b.test(t)) || (eitherWay && b.test(f) && a.test(t));
  });
}

let app: ElectronApplication;
let page: Page;
let home: string;
const MAIN = "Acceptance notes";
const OPTIONS = "Database options";

async function start(): Promise<void> {
  // No fake model: LM Studio on its usual address, with the model already loaded.
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter(
      (e): e is [string, string] => e[1] !== undefined && e[0] !== "LUCID_LLM_URL",
    ),
  );
  env["LUCID_HOME"] = home;
  app = await electron.launch({ args: [join(__dirname, "../out/main/index.js")], env });
  page = await app.firstWindow();
  await maximizeWindow(app, page);
}

const bar = () => page.getByLabel("Dictate or type your notes");
const mode = (name: "Input" | "Command" | "Edit") =>
  page.getByRole("group", { name: "Mode" }).getByRole("button", { name });
const status = () => page.locator(".dictation");

/** What Lucid answered in the bar, for a failure message that says what went wrong. */
async function barText(): Promise<string> {
  return (await page.locator(".dictation [role=status]").innerText()).replace(/\s+/g, " ");
}

/** Waits for the model's job to start and finish. Resolves to how it ended (`done`, `clarify`, `failed`, ...). */
async function finished(): Promise<string> {
  await expect(status()).toHaveAttribute("data-status", /working|waiting/, { timeout: 20_000 });
  await expect(status()).not.toHaveAttribute("data-status", /working|waiting/, {
    timeout: 280_000,
  });
  return (await status().getAttribute("data-status")) ?? "";
}

/**
 * Says something that the model handles, and waits until it has finished and the page has been saved. If the model asks a
 * question and `pick` says which answer to click (by its text), the answer is given the way a person would, and the
 * question is noted; without `pick` a question fails the scenario.
 */
async function say(text: string, { pick }: { pick?: RegExp } = {}): Promise<void> {
  await bar().fill(text);
  await bar().press("Enter");
  let state = await finished();
  if (state === "clarify" && pick) {
    test
      .info()
      .annotations.push({ type: "Lucid asked", description: `"${text}" -> ${await barText()}` });
    await page.locator(".dictation-card").getByRole("button", { name: pick }).first().click();
    state = await finished();
  }
  expect(state, `Lucid said: ${await barText()}`).toBe("done");
  await expect(page.locator(".save-note")).toHaveText("Saved", { timeout: 20_000 });
}

/** A spoken command Lucid handles itself (undo, redo): no model. The checks poll the saved page for the result. */
async function sayLocal(text: string): Promise<void> {
  await bar().fill(text);
  await bar().press("Enter");
}

function savedPages(): Saved[] {
  return readdirSync(home)
    .filter((n) => n !== ".lucid" && n.endsWith(".lucid"))
    .map((n) => JSON.parse(readFileSync(join(home, n), "utf8")) as Saved);
}
function saved(title: string): Saved {
  const found = savedPages().find((p) => p.title === title);
  if (!found) throw new Error(`There is no saved page "${title}".`);
  return found;
}

/** A ready-made page, opened in the window from the page list (a reload makes the list show it). */
async function openFixture(title: string, doc: unknown, contains: string): Promise<void> {
  await page.evaluate(
    async ({ title: t, doc: d }) => {
      const file = await window.lucid.pages.create(t);
      await window.lucid.pages.save({ ...file, doc: d } as never);
    },
    { title, doc },
  );
  await page.reload();
  await openPage(title);
  await expect(page.locator(".page-editor")).toContainText(contains);
}

async function openPage(title: string): Promise<void> {
  await page
    .getByRole("navigation", { name: "Pages" })
    .getByRole("button", { name: new RegExp(title) })
    .click();
  await expect(page.getByLabel("Page title")).toHaveValue(title);
}

const shot = (name: string) =>
  page.screenshot({ path: join(__dirname, `../test-results/acceptance-${name}.png`) });

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "lucid-home-"));
  await start();
  // The model has to be loaded; say so clearly instead of failing every scenario.
  const ready = await page.evaluate(async () => (await window.lucid.lm.status()).state);
  expect(ready, "LM Studio must be running with the model loaded (`lms ps`).").toBe("ready");
  await page.getByRole("complementary").getByRole("button", { name: "New page" }).click();
  await expect(page.getByLabel("Page title")).toBeFocused();
  await page.keyboard.type(MAIN);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await expect(bar()).toBeVisible();
});
test.afterAll(async () => {
  await app.close().catch(() => undefined);
});

test("A. speak and structure notes: rough thoughts about load balancing become readable notes", async () => {
  test.setTimeout(300_000);
  await mode("Input").click();
  await say(
    "Load balancer. Multiple application servers behind it. Distribute incoming traffic. Health checks to avoid unhealthy servers. Database can become the bottleneck.",
  );
  const doc = saved(MAIN);
  expect(
    flat(doc.doc.blocks).some((b) => b.type === "heading" && /load.?balanc/i.test(textOf(b))),
    "a heading about the load balancer",
  ).toBe(true);
  const words = allText(doc).toLowerCase();
  for (const wanted of [/servers?/, /traffic/, /health/, /bottleneck|database/]) {
    expect(words).toMatch(wanted);
  }
  const pieces = flat(doc.doc.blocks).filter((b) =>
    ["bulletListItem", "numberedListItem", "paragraph"].includes(b.type),
  );
  const sentences = pieces.flatMap((b) => textOf(b).split(/[.!?]\s|\n/)).filter((s) => s.trim());
  expect(sentences.length).toBeGreaterThanOrEqual(3);
  expect(ofType(doc, "diagram")).toHaveLength(0);
  expect(ofType(doc, "table")).toHaveLength(0);
  expect(words, "no numbers were made up").not.toMatch(/\d/);
  await shot("A");
});

test("B. generate a diagram: a request flow with a database lookup", async () => {
  test.setTimeout(300_000);
  await say(
    "Create a request flow. The user enters a domain. DNS resolves the domain and returns an IP address. The client sends a request to the web server. The web server checks Redis. If the cache misses, it queries PostgreSQL. PostgreSQL returns the data, Redis stores the result, and the web server returns JSON to the client.",
  );
  const diagrams = ofType(saved(MAIN), "diagram");
  expect(diagrams).toHaveLength(1);
  const g = graphOf(diagrams[0] as Blk);
  for (const [name, re] of [
    ["the client or user", CLIENT],
    ["DNS", DNS],
    ["the web server", WEB],
    ["Redis", REDIS],
    ["PostgreSQL", PG],
  ] as const) {
    expect(
      g.nodes.some((n) => re.test(n.label)),
      `a node for ${name}: ${g.nodes.map((n) => n.label).join(", ")}`,
    ).toBe(true);
  }
  expect(linked(g, CLIENT, DNS, true), "client and DNS").toBe(true);
  expect(linked(g, CLIENT, WEB), "client to web server").toBe(true);
  expect(linked(g, WEB, REDIS), "web server to Redis").toBe(true);
  expect(linked(g, WEB, PG, true), "web server and PostgreSQL").toBe(true);
  expect(linked(g, WEB, CLIENT), "web server back to the client").toBe(true);
  await expect
    .poll(() => page.locator(".page-editor svg g.node").count(), { timeout: 30_000 })
    .toBeGreaterThanOrEqual(5);
  await shot("B");
});

test("D. create a comparison table, then add a row to it", async () => {
  test.setTimeout(300_000);
  await say(
    "Create a comparison table. Three columns: property, SQL, NoSQL. Rows: schema, relationships, scaling, consistency, and use cases.",
  );
  const first = ofType(saved(MAIN), "table");
  expect(first).toHaveLength(1);
  const t = tableOf(first[0] as Blk);
  expect(t.columns.map((c) => c.name.toLowerCase())).toEqual(["property", "sql", "nosql"]);
  expect(t.rows.map((r) => (r.cells[0] ?? "").toLowerCase())).toEqual([
    "schema",
    "relationships",
    "scaling",
    "consistency",
    "use cases",
  ]);
  await shot("D1");

  await mode("Command").click();
  // The table already has a "Consistency" row, so asking "fill that row, or add a new one?" is fair: answer it.
  await say("Add a row for consistency guarantees and fill in the SQL and NoSQL columns.", {
    pick: /new row|add a/i,
  });
  const after = ofType(saved(MAIN), "table");
  expect(after, "still exactly one table").toHaveLength(1);
  const rows = tableOf(after[0] as Blk).rows;
  expect(rows).toHaveLength(6);
  const added = rows.find((r) => /guarantee/i.test(r.cells[0] ?? ""));
  expect(added, `the new row: ${JSON.stringify(rows.map((r) => r.cells))}`).toBeTruthy();
  const said = saved(MAIN).changeLog.at(-1)?.summary;
  const detail = `${JSON.stringify(added?.cells)}; Lucid said: ${said}`;
  expect(added?.cells[1]?.trim(), `SQL cell filled in: ${detail}`).toBeTruthy();
  expect(added?.cells[2]?.trim(), `NoSQL cell filled in: ${detail}`).toBeTruthy();
  await shot("D2");
});

let beforeG: Saved;
let afterG: Saved;

test("G. separate input from commands: content goes in as content, then a command changes it", async () => {
  test.setTimeout(300_000);
  await mode("Input").click();
  const before = saved(MAIN);
  await say("Then we delete the old cache entries after thirty days.");
  beforeG = saved(MAIN);
  const added = flat(beforeG.doc.blocks).find(
    (b) =>
      /delet/i.test(textOf(b)) &&
      /thirty days|30 days/i.test(textOf(b)) &&
      !flat(before.doc.blocks).some((o) => o.id === b.id),
  );
  expect(added, "a new block with the sentence").toBeTruthy();
  for (const id of ids(before)) expect(ids(beforeG), `block ${id} was kept`).toContain(id);

  await mode("Command").click();
  await say("Make that a heading.");
  afterG = saved(MAIN);
  const heading = flat(afterG.doc.blocks).find((b) => /delet.*cache entries/i.test(textOf(b)));
  expect(heading?.type, "the new sentence became a heading").toBe("heading");
  await shot("G");
});

test("H. recover from mistakes: undo goes back one step, redo forward again", async () => {
  test.setTimeout(120_000);
  const blocks = () => saved(MAIN).doc.blocks;
  await sayLocal("undo");
  await expect
    .poll(blocks, { message: "undo restored the page as it was", timeout: 20_000 })
    .toEqual(beforeG.doc.blocks);
  await sayLocal("redo");
  await expect
    .poll(blocks, { message: "redo brought the change back", timeout: 20_000 })
    .toEqual(afterG.doc.blocks);
  await shot("H");
});

test("C. update an existing diagram: Redis and a cache-miss path, nothing else lost", async () => {
  test.setTimeout(300_000);
  const node = (id: string, kind: string, label: string) => ({
    id,
    kind,
    label,
    status: "normal",
  });
  const edge = (n: number, from: string, to: string, label: string) => ({
    id: `e${String(n)}`,
    from,
    to,
    label,
    arrow: "directed",
    style: "solid",
    status: "normal",
  });
  const flow = {
    blocks: [
      {
        id: "h1",
        type: "heading",
        props: { level: 2 },
        content: [{ type: "text", text: "Request flow", styles: {} }],
        children: [],
      },
      {
        id: "d1",
        type: "diagram",
        props: {
          caption: "",
          graph: {
            type: "flowchart",
            direction: "LR",
            title: "Request flow",
            nodes: [
              node("client", "client", "Client"),
              node("dns", "service", "DNS"),
              node("web", "service", "Web Server"),
              node("pg", "datastore", "PostgreSQL"),
            ],
            edges: [
              edge(1, "client", "dns", "resolve domain"),
              edge(2, "client", "web", "request"),
              edge(3, "web", "pg", "query"),
              edge(4, "pg", "web", "data"),
              edge(5, "web", "client", "JSON response"),
            ],
            groups: [],
            fragments: [],
          },
        },
        children: [],
      },
    ],
  };
  await openFixture("Request flow", flow, "Request flow");
  await mode("Command").click();
  await say("Add Redis between the web server and the database", { pick: /^1/ });
  const mid = graphOf(ofType(saved("Request flow"), "diagram")[0] as Blk);
  expect(
    mid.nodes.some((n) => REDIS.test(n.label)),
    "a Redis node",
  ).toBe(true);
  await say(
    "Add a cache-miss path to PostgreSQL and show that the result gets stored in Redis before returning.",
    { pick: /^1/ },
  );
  const diagrams = ofType(saved("Request flow"), "diagram");
  expect(diagrams, "still one diagram, updated rather than replaced").toHaveLength(1);
  const g = graphOf(diagrams[0] as Blk);
  for (const id of ["client", "dns", "web", "pg"])
    expect(
      g.nodes.map((n) => n.id),
      `node ${id} was kept`,
    ).toContain(id);
  expect(g.nodes.length).toBeGreaterThan(4);
  expect(linked(g, WEB, REDIS, true), "web server and Redis").toBe(true);
  expect(linked(g, WEB, PG) || linked(g, REDIS, PG), "a path to PostgreSQL on a cache miss").toBe(
    true,
  );
  const redis = g.nodes.find((n) => REDIS.test(n.label));
  const touching = g.edges.filter((e) => e.from === redis?.id || e.to === redis?.id);
  expect(
    touching.length,
    "the result is stored in Redis (an edge into it besides the lookup)",
  ).toBeGreaterThanOrEqual(2);
  await shot("C");
});

test("E. preserve discarded ideas: crossed out, still there, the chosen one marked", async () => {
  test.setTimeout(300_000);
  await openFixture(OPTIONS, COMMAND_DOC, "MongoDB");
  const items = (d: Saved) =>
    flat(d.doc.blocks).filter(
      (b) => b.type === "bulletListItem" && /PostgreSQL|MongoDB|DynamoDB/.test(textOf(b)),
    );
  const count = items(saved(OPTIONS)).length;
  await mode("Command").click();
  await say(
    "Cross out PostgreSQL and MongoDB. We're choosing DynamoDB for this design, but I want to remember the alternatives.",
  );
  const now = items(saved(OPTIONS));
  expect(now, "no option was deleted").toHaveLength(count);
  const statusOf = (name: string) => now.find((b) => textOf(b).includes(name))?.props["status"];
  expect(statusOf("PostgreSQL")).toBe("struck");
  expect(statusOf("MongoDB")).toBe("struck");
  expect(statusOf("DynamoDB")).toBe("chosen");
  await shot("E");
});

test("F. edit using context: a row goes into the table the cursor is in", async () => {
  test.setTimeout(300_000);
  const table = (id: string, caption: string, rows: string[][]) => ({
    id,
    type: "table",
    props: {
      caption,
      table: {
        columns: [
          { id: "c1", name: "Property", status: "normal" },
          { id: "c2", name: "Option A", status: "normal" },
          { id: "c3", name: "Option B", status: "normal" },
        ],
        rows: rows.map((cells, i) => ({ id: `r${String(i + 1)}`, cells, status: "normal" })),
        headerColumn: true,
      },
    },
    children: [],
  });
  const doc = {
    blocks: [
      {
        id: "h1",
        type: "heading",
        props: { level: 2 },
        content: [{ type: "text", text: "Storage engines", styles: {} }],
        children: [],
      },
      table("ta", "Engines", [
        ["Writes", "Fast", "Slow"],
        ["Reads", "Slow", "Fast"],
      ]),
      {
        id: "h2",
        type: "heading",
        props: { level: 2 },
        content: [{ type: "text", text: "Queues", styles: {} }],
        children: [],
      },
      table("tb", "Queues", [
        ["Ordering", "Per partition", "None"],
        ["Replay", "Yes", "No"],
      ]),
    ],
  };
  await openFixture("Two tables", doc, "Storage engines");
  const before = saved("Two tables");
  // Put the cursor in the second table: Edit mode, click into it, then leave Edit mode with Esc.
  await page.keyboard.press("Meta+e");
  // Clicking before Edit mode is on does not put the cursor anywhere.
  await expect(mode("Edit")).toHaveAttribute("aria-pressed", "true");
  await page.locator(".page-editor .lucid-table").nth(1).click();
  await page.keyboard.press("Escape");
  await mode("Command").click();
  await say("Add another row for consistency to this table.");
  const after = saved("Two tables");
  const [first, second] = ofType(after, "table") as [Blk, Blk];
  expect(tableOf(second).rows, "the second table has one more row").toHaveLength(3);
  expect(tableOf(first), "the first table is exactly as it was").toEqual(
    tableOf(ofType(before, "table")[0] as Blk),
  );
  await shot("F");
});

test("I. resume later: close the app, open it again, everything is as it was", async () => {
  test.setTimeout(240_000);
  const main = saved(MAIN);
  const options = saved(OPTIONS);
  await app.close();
  await start();
  await openPage(MAIN);
  expect(saved(MAIN).doc, "the page file is unchanged by closing and opening").toEqual(main.doc);
  await expect(page.locator(".page-editor")).toContainText("load balancer", { ignoreCase: true });
  await expect(page.locator(".page-editor .lucid-table")).toHaveCount(1);
  await expect
    .poll(() => page.locator(".page-editor svg g.node").count(), { timeout: 30_000 })
    .toBeGreaterThanOrEqual(5);
  await shot("I-main");

  await openPage(OPTIONS);
  expect(saved(OPTIONS).doc).toEqual(options.doc);
  const struck = page
    .locator('.page-editor [data-content-type="bulletListItem"]')
    .filter({ hasText: /^PostgreSQL$/ });
  await expect(struck).toHaveCSS("text-decoration-line", "line-through");
  await shot("I-options");
});
