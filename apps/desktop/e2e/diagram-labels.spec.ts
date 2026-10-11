import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SAMPLE_DOC } from "@lucid/kit";
import { _electron as electron, expect, test } from "@playwright/test";
import { maximizeWindow } from "./helpers";

test("the text on a connection is drawn over the line, on an opaque background, so the line never runs through the words", async () => {
  test.setTimeout(60_000);
  const home = mkdtempSync(join(tmpdir(), "lucid-home-"));
  const app = await electron.launch({
    args: [join(__dirname, "../out/main/index.js")],
    env: { ...process.env, LUCID_HOME: home },
  });
  try {
    const page = await app.firstWindow();
    await maximizeWindow(app, page);
    await page.evaluate(async (doc) => {
      const file = await window.lucid.pages.create("Request flow");
      await window.lucid.pages.save({ ...file, doc });
    }, SAMPLE_DOC);
    await page.reload();
    const svg = page.locator(".page-editor svg").first();
    await expect(svg.locator("g.node").first()).toBeVisible({ timeout: 20_000 });

    // The sample has five labelled connections: every label's background is solid white (Mermaid's own is half see-through).
    const backgrounds = await svg.locator(".edgeLabel rect").evaluateAll((rects) =>
      rects.map((r) => {
        const style = getComputedStyle(r);
        return { opacity: style.opacity, fill: style.fill };
      }),
    );
    expect(backgrounds).toHaveLength(5);
    for (const b of backgrounds) expect(b).toEqual({ opacity: "1", fill: "rgb(255, 255, 255)" });

    // The labels are the last thing drawn, so the words are on top of the lines and of the boxes.
    const labelsOnTop = await svg.evaluate((root) => {
      const lines = root.querySelector("g.edgePaths");
      const labels = root.querySelector("g.edgeLabels");
      const nodes = root.querySelector("g.nodes");
      const after = (a: Element | null, b: Element | null) =>
        a !== null &&
        b !== null &&
        (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
      // After the lines, and after the boxes too: a box standing where a label was placed cannot hide its words.
      return after(lines, labels) && after(nodes, labels);
    });
    expect(labelsOnTop).toBe(true);

    await svg.screenshot({ path: join(__dirname, "../test-results/diagram-labels.png") });
  } finally {
    await app.close();
  }
});
