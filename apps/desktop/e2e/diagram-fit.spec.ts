import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseLgnOrThrow } from "@lucid/core";
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { autoSaveDialog, downloadPdf, maximizeWindow } from "./helpers";

/**
 * A big diagram must not just shrink until it cannot be read. It is drawn in the direction that has to be squeezed least,
 * and keeps a readable minimum size (the text at least 70% of its natural 16 px): on screen in the page and in the
 * builder, and on the PDF page.
 */
const PDFTOTEXT = "/opt/homebrew/bin/pdftotext";
const READABLE = 0.7;

const chain = (n: number): string =>
  [
    ...Array.from(
      { length: n },
      (_, i) => `s${String(i + 1)} [service]: Step number ${String(i + 1)}`,
    ),
    ...Array.from({ length: n - 1 }, (_, i) => `s${String(i + 1)} -> s${String(i + 2)}: next`),
  ].join("\n");

const ARCHITECTURE = `user [actor]: User
cdn [cdn]: CDN
lb [loadbalancer]: Load Balancer
gw [gateway]: API Gateway
orders [service]: Order Service
users [service]: User Service
pay [service]: Payment Service
redis [cache]: Redis
db [datastore]: PostgreSQL
q [queue]: Kafka
w1 [service]: Invoice Worker
w2 [service]: Email Worker
s3 [storage]: S3
search [datastore]: Elasticsearch
mon [external]: Monitoring
user -> cdn: static
user -> lb: API call
lb -> gw
gw -> orders: orders
gw -> users: profiles
gw -> pay: payments
orders -> redis: cache
orders -> db: query
orders -> q: publish
q -> w1: invoices
q -> w2: emails
w1 -> s3: save pdf
users -> search: index
pay -> db: ledger
w2 -> mon: metrics
`;

async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  const home = mkdtempSync(join(tmpdir(), "lucid-home-"));
  const app = await electron.launch({
    args: [join(__dirname, "../out/main/index.js")],
    env: { ...process.env, LUCID_HOME: home },
  });
  const page = await app.firstWindow();
  await maximizeWindow(app, page);
  return { app, page };
}

/** A page with one diagram, written left to right, opened in the window. */
async function openDiagram(page: Page, title: string, source: string): Promise<void> {
  const graph = parseLgnOrThrow(source, { type: "flowchart", direction: "LR", title });
  const doc = {
    blocks: [{ id: "d1", type: "diagram", props: { caption: title, graph }, children: [] }],
  };
  await page.evaluate(
    async (arg) => {
      const file = await window.lucid.pages.create(arg.name);
      await window.lucid.pages.save({ ...file, doc: arg.doc } as never);
    },
    { name: title, doc },
  );
  await page.reload();
  // After a reload the window shows the page it showed before: open this one.
  await page
    .getByRole("navigation", { name: "Pages" })
    .getByRole("button", { name: new RegExp(title) })
    .click();
  await expect(page.getByLabel("Page title")).toHaveValue(title);
  await expect(page.locator(".page-editor svg g.node").first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(800);
}

/** How big the drawing is shown, compared with its natural size, and which way it was drawn. */
const shown = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((box) => {
      const svg = box.querySelector("svg") as SVGSVGElement;
      const natural = svg.viewBox.baseVal;
      const rect = svg.getBoundingClientRect();
      return {
        scale: rect.width / natural.width,
        flipped: box.getAttribute("data-flipped") === "true",
        scrolls: box.scrollWidth > box.clientWidth + 1,
      };
    });

test("a diagram with 6, 10 or 15 parts is shown at a readable size, drawn top to bottom when that is less squeezed", async () => {
  test.setTimeout(150_000);
  const { app, page } = await launch();
  try {
    // A small one is left as it was drawn, at its natural size.
    await openDiagram(page, "small", chain(3));
    const small = await shown(page, ".page-editor .figure-svg");
    expect(small).toMatchObject({ scale: 1, flipped: false });

    for (const [name, source] of [
      ["chain6", chain(6)],
      ["chain10", chain(10)],
      ["chain15", chain(15)],
      ["architecture", ARCHITECTURE],
    ] as const) {
      await openDiagram(page, name, source);
      const m = await shown(page, ".page-editor .figure-svg");
      expect(
        m.scale,
        `${name}: the text is at least ${String(READABLE * 100)}% of its natural size`,
      ).toBeGreaterThanOrEqual(READABLE);
      expect(
        m.flipped,
        `${name}: written left to right, drawn top to bottom to stay readable`,
      ).toBe(true);
      expect(m.scrolls, `${name}: no sideways scrolling needed`).toBe(false);
    }
    await page
      .locator(".page-editor .figure")
      .first()
      .screenshot({ path: join(__dirname, "../test-results/diagram-fit-architecture.png") });
  } finally {
    await app.close();
  }
});

test("on the PDF page a big diagram's words are not tiny: it is drawn the way that is squeezed least", async () => {
  test.setTimeout(150_000);
  const { app, page } = await launch();
  try {
    await openDiagram(page, "architecture", ARCHITECTURE);
    const path = await autoSaveDialog(app);
    await downloadPdf(page, path);
    if (!existsSync(PDFTOTEXT)) return;
    const bbox = execFileSync(PDFTOTEXT, ["-bbox", path, "-"], { encoding: "utf8" });
    const kafka = /yMin="([\d.]+)" xMax="[\d.]+" yMax="([\d.]+)">Kafka</.exec(bbox);
    expect(kafka, "the node 'Kafka' is in the PDF").toBeTruthy();
    const height = Number(kafka?.[2]) - Number(kafka?.[1]);
    // Left to right it would be about 2.7 pt high; with the page's margins and height used, this diagram gets about 7.8 pt.
    expect(height).toBeGreaterThan(7);
  } finally {
    await app.close();
  }
});

test("the diagram builder shows a chain of twelve components at a readable size too", async () => {
  test.setTimeout(90_000);
  const { app, page } = await launch();
  try {
    await page.getByRole("complementary").getByRole("button", { name: "New page" }).click();
    await expect(page.getByLabel("Page title")).toBeFocused();
    await page.keyboard.type("Builder");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    const bar = page.getByLabel("Dictate or type your notes");
    // The page is left in Edit mode by Escape; the box takes over once it is ready.
    await expect(bar).toBeEditable();
    await bar.fill("diagram mode");
    await bar.press("Enter");
    await bar.fill(
      "add keywords: customer web application, content delivery network, regional load balancer, public API gateway, order management service, payment processing service, shared Redis cache, primary PostgreSQL database, Kafka event queue, invoice generation worker, object storage bucket, monitoring dashboard",
    );
    await bar.press("Enter");
    await bar.fill("connections");
    await bar.press("Enter");
    // A chain: written left to right it would be about 1,700 px wide, in a canvas of about 900.
    for (let n = 1; n < 12; n++) {
      await bar.fill(`${String(n)} to ${String(n + 1)}`);
      await bar.press("Enter");
    }
    // The builder starts top to bottom: say left to right, which is what makes a chain wide.
    await bar.fill("direction left to right");
    await bar.press("Enter");
    await expect(page.locator(".wb-svg svg g.node").first()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(800);
    const m = await shown(page, ".wb-svg");
    expect(m.scale).toBeGreaterThanOrEqual(READABLE);
  } finally {
    await app.close();
  }
});
