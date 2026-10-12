// CAPTURE: drives the real Lucid app (the built one in apps/desktop/out) against the real model in LM Studio and records
// what happens: still frames of the window with timestamps, the named moments, and where the mouse went.
// Nothing here is faked: the words go into the input box the way a dictation app delivers them, the model answers, the
// page changes, a PDF is typeset, an MCP client edits the open page. The result is video/.cache/capture/.
//
//   node capture/capture.mjs            # run it (about 4 minutes; keep your hands off the keyboard)
//   ATTEMPTS=3 node capture/capture.mjs # the model is not deterministic: a take that misses the story is thrown away and redone
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Recorder } from "./lib/recorder.mjs";
import {
  ROOT,
  VIEWPORT,
  barOf,
  barText,
  finished,
  launchApp,
  paste,
  rects,
  scrollEditor,
  scrollToBlock,
  sleep,
} from "./lib/app.mjs";

const HERE = resolve(import.meta.dirname, "..");
const OUT = join(HERE, ".cache", "capture");
const dictation = JSON.parse(readFileSync(join(HERE, "script", "dictation.json"), "utf8"));

/** A take that did not tell the story (the model is not deterministic) is redone from the start. */
class Retake extends Error {}

const flat = (blocks) => blocks.flatMap((b) => [b, ...flat(b.children ?? [])]);
const textOf = (b) => (Array.isArray(b.content) ? b.content.map((c) => c.text ?? "").join("") : "");

function savedPage(home) {
  const file = readdirSync(home).find((n) => n.endsWith(".lucid") && n !== ".lucid");
  if (!file) throw new Retake("no saved page");
  return JSON.parse(readFileSync(join(home, file), "utf8"));
}

async function session() {
  const { app, page, home } = await launchApp();
  const rec = new Recorder(page, OUT);
  const bar = barOf(page);
  const extra = { viewport: VIEWPORT, steps: [], mcp: [] };
  // How much of the window is the system's own title bar (not part of the page the stills show): 0 when the app draws
  // under it, which is when the composition draws the traffic lights over the top corner instead.
  extra.titleBar = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    return win.getBounds().height - win.getContentBounds().height;
  });
  try {
    const lm = await page.evaluate(async () => (await window.lucid.lm.status()).state);
    if (lm !== "ready")
      throw new Error(`LM Studio is not ready (${lm}): load qwen/qwen3.8-27b first.`);
    await sleep(600);

    rec.start();
    await sleep(900);
    rec.mark("launch.idle");

    // 1. A new page, with its title typed.
    await rec.click(page.getByRole("complementary").getByRole("button", { name: "New page" }), {
      ms: 900,
      name: "click.newpage",
    });
    await page.getByLabel("Page title").waitFor();
    await sleep(350);
    rec.mark("title.typing");
    await page.keyboard.type(dictation.title, { delay: 55 });
    rec.mark("title.typed");
    await sleep(300);
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    await bar.waitFor();
    // The mouse leaves the sidebar, so that no row stays highlighted for the rest of the take.
    await rec.moveTo(900, 560, 800);
    await sleep(700);
    rec.mark("page.ready", { rects: await rects(page) });

    // 2. What is said (or typed): each step is delivered, sent, answered; the marks say when.
    for (const step of dictation.steps) {
      const key = process.platform === "darwin" ? "Meta" : "Control";
      if (step.mode === "command") await page.keyboard.press(`${key}+2`);
      else await page.keyboard.press(`${key}+1`);
      await sleep(500);
      rec.mark(`${step.id}.mode`, { mode: step.mode });
      await paste(page, step.text);
      rec.mark(`${step.id}.pasted`);
      // Lucid sends a paste by itself after a short pause; wait for the model to start and to finish.
      const done = await finished(page, () => rec.mark(`${step.id}.sent`));
      const end = rec.mark(`${step.id}.done`, { state: done.state, modelMs: done.modelMs });
      const said = await barText(page);
      await sleep(1300);
      if (step.id === "d3" || step.id === "d4")
        await scrollToBlock(page, '.page-editor [data-content-type="diagram"]', 1100, 12);
      else await scrollEditor(page, 0, 600);
      await sleep(700);
      const r = await rects(page);
      rec.mark(`${step.id}.settled`, { rects: r, said });
      extra.steps.push({
        id: step.id,
        said,
        modelMs: done.modelMs,
        state: done.state,
        doneAt: end.t,
      });
      if (done.state !== "done") throw new Retake(`${step.id} ended as ${done.state}`);
      if (/may not match|not sure|unprocessed/i.test(said))
        throw new Retake(`${step.id}: "${said}"`);
    }

    // The story has to be in the saved page, or this take is thrown away.
    await sleep(1800);
    const doc = savedPage(home);
    const blocks = flat(doc.doc.blocks);
    const types = blocks.map((b) => b.type);
    if (!types.includes("heading")) throw new Retake(`no heading (blocks: ${types.join(", ")})`);
    if (blocks.filter((b) => b.type === "bulletListItem").length < 2) throw new Retake("no list");
    const table = blocks.find((b) => b.type === "table")?.props.table;
    if (
      !table ||
      table.rows.length < 3 ||
      table.rows.some((r) => r.cells.some((c) => c.trim() === ""))
    )
      throw new Retake(`no full table of three options: ${JSON.stringify(table)}`);
    const graph = blocks.find((b) => b.type === "diagram")?.props.graph;
    const label = (id) => graph?.nodes.find((n) => n.id === id)?.label ?? "";
    if (!graph) throw new Retake("no diagram");
    const cache = graph.nodes.find((n) => /cache/i.test(n.label));
    const database = graph.nodes.find((n) => /database|\bdb\b|postgres|sql/i.test(n.label));
    const lb = graph.nodes.find((n) => /load balancer/i.test(n.label));
    if (!cache || !database || !lb)
      throw new Retake(`diagram nodes: ${graph.nodes.map((n) => n.label).join(", ")}`);
    const around = graph.edges.filter((e) => e.from === cache.id || e.to === cache.id);
    if (!around.some((e) => e.from === database.id || e.to === database.id))
      throw new Retake(
        `the cache is not next to the database: ${graph.edges.map((e) => `${label(e.from)}>${label(e.to)}`).join(", ")}`,
      );
    if (around.length < 2) throw new Retake("the cache is not between two things");
    extra.story = {
      title: doc.title,
      nodes: graph.nodes.map((n) => n.label),
      rows: table.rows.map((r) => r.cells),
    };

    // 3. The history on the right, then one click for the PDF.
    rec.mark("history.shown", { rects: await rects(page) });
    await sleep(900);
    const pdfFile = join(home, "Designing a URL shortener.pdf");
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath });
    }, pdfFile);
    await scrollEditor(page, 0, 700);
    await sleep(500);
    await rec.click(page.getByRole("button", { name: "Download PDF" }), {
      ms: 1000,
      name: "click.pdf",
    });
    rec.mark("pdf.clicked");
    await page
      .getByRole("button", { name: "Making PDF…" })
      .waitFor({ timeout: 10_000 })
      .catch(() => undefined);
    rec.mark("pdf.busy");
    await page.getByText(/^Saved Designing a URL shortener\.pdf/).waitFor({ timeout: 120_000 });
    rec.mark("pdf.saved", { rects: await rects(page) });
    await sleep(1200);
    await rec.moveTo(900, 560, 700);
    mkdirSync(OUT, { recursive: true });
    execFileSync("/opt/homebrew/bin/pdftoppm", [
      "-r",
      "170",
      "-png",
      pdfFile,
      join(OUT, "pdf-page"),
    ]);
    extra.pdfPages = readdirSync(OUT).filter((n) => n.startsWith("pdf-page"));
    // The "Saved ..." note under the toolbar fades by itself after a few seconds; the agent part starts without it.
    await page
      .locator(".export-note")
      .waitFor({ state: "detached", timeout: 20_000 })
      .catch(() => undefined);
    await sleep(600);

    // 4. New page from a note format: say what it is about, the format is suggested, the five formats are listed. This is
    // done before the agent, so that the page behind the dialog is the page as it was.
    await scrollEditor(page, 0, 500);
    await rec.click(page.getByRole("button", { name: "New from a format…" }), {
      ms: 900,
      name: "click.format",
    });
    const dialog = page.getByRole("dialog", { name: "New page" });
    await dialog.waitFor();
    await sleep(700);
    rec.mark("fmt.open", { rects: await rects(page) });
    await dialog.locator("textarea").focus();
    await page.keyboard.type(dictation.formatAbout, { delay: 28 });
    rec.mark("fmt.typed");
    await sleep(300);
    await page.keyboard.press("Enter");
    rec.mark("fmt.asked");
    await page
      .getByText(/^Suggested:/)
      .waitFor({ timeout: 60_000 })
      .catch(() => undefined);
    rec.mark("fmt.suggested");
    await sleep(1200);
    const formats = await dialog.locator(".np-format").evaluateAll((els) =>
      els.map((e) => {
        const b = e.getBoundingClientRect();
        return {
          text: (e.textContent ?? "").replace(/\s+/g, " ").trim(),
          x: b.x,
          y: b.y,
          w: b.width,
          h: b.height,
        };
      }),
    );
    const dlg = await dialog.boundingBox();
    rec.mark("fmt.list", { formats, dialog: dlg });
    for (const f of formats.slice(1)) {
      await rec.moveTo(f.x + f.w * 0.62, f.y + f.h / 2, 420);
      await sleep(140);
    }
    await sleep(500);
    await rec.click(page.getByRole("button", { name: "Create page" }), {
      ms: 800,
      name: "click.create",
    });
    await page.getByLabel("Page title").waitFor();
    await sleep(1400);
    rec.mark("fmt.created", { rects: await rects(page) });
    await sleep(1600);

    // Back to the first page: the agent works on the page that is open.
    await rec.click(
      page
        .getByRole("navigation", { name: "Pages" })
        .getByRole("button")
        .filter({ hasText: "URL shortener" }),
      { ms: 900, name: "click.back" },
    );
    await page.waitForFunction(
      () => /URL shortener/i.test(document.querySelector('[aria-label="Page title"]')?.value ?? ""),
      null,
      { timeout: 10_000 },
    );
    await sleep(500);
    await rec.moveTo(900, 560, 600);
    await sleep(600);
    rec.mark("page.back", { rects: await rects(page) });

    // 5. An agent (an MCP client) edits the open page: it appears, and the history says who did it.
    execFileSync(process.execPath, [join(ROOT, "packages/mcp/scripts/bundle.mjs")], {
      stdio: "ignore",
    });
    const client = new Client({ name: dictation.agent.name, version: "1" });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [join(ROOT, "packages/mcp/dist/lucid-mcp.mjs")],
        env: { ...process.env, LUCID_HOME: home },
      }),
    );
    const text = (r) => r.content.map((c) => c.text).join("\n");
    const call = async (name, args) => {
      const started = rec.mark(`mcp.${name}.call`);
      const result = await client.callTool({ name, arguments: args });
      const out = text(result);
      extra.mcp.push({ name, args, result: out, isError: Boolean(result.isError), t: started.t });
      rec.mark(`mcp.${name}.result`);
      return out;
    };
    await sleep(500);
    rec.mark("mcp.begin");
    await call("list_documents", {});
    await sleep(500);
    const outline = await call("get_outline", {});
    const revision = /revision (\w+)\)/.exec(outline)?.[1];
    if (!revision) throw new Error("no revision in the outline");
    await sleep(700);
    await call("insert_notes", { lmd: dictation.agent.lmd, revision });
    await page.locator(".page-editor h2", { hasText: "Pitfalls" }).waitFor({ timeout: 20_000 });
    await sleep(500);
    await scrollEditor(page, 100000, 1000);
    await sleep(800);
    rec.mark("mcp.shown", { rects: await rects(page) });
    await sleep(1500);
    await client.close();

    await rec.stop();
    writeFileSync(join(OUT, "saved-page.json"), JSON.stringify(doc, null, 1));
    extra.ok = true;
    return rec;
  } finally {
    await rec.stop().catch(() => undefined);
    // Written even when the take is thrown away, so that it can be looked at.
    writeFileSync(join(OUT, "manifest.json"), JSON.stringify(rec.manifest(extra), null, 1));
    await app.close().catch(() => undefined);
  }
}

const attempts = Number(process.env.ATTEMPTS ?? 3);
for (let i = 1; i <= attempts; i++) {
  try {
    const rec = await session();
    console.log(
      `capture ok: ${rec.frames.length} frames, ${(rec.now() / 1000).toFixed(0)} s, ${rec.marks.length} marks`,
    );
    process.exit(0);
  } catch (error) {
    if (error instanceof Retake) console.log(`take ${i} thrown away: ${error.message}`);
    else throw error;
  }
}
console.error("no take told the story");
process.exit(1);
