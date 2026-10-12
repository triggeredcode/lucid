// Launching the real Lucid app and the small helpers the capture uses to drive it the way a person does.
import { mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron } from "playwright";

export const ROOT = resolve(import.meta.dirname, "../../..");

/** The window is 1600 x 900 CSS pixels at 2x, whatever the screen: the stills are 3200 x 1800. */
export const VIEWPORT = { width: 1600, height: 900, scale: 2 };

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Starts the built app (apps/desktop/out) with a throwaway library, against the real LM Studio on its usual address. */
export async function launchApp() {
  const require = createRequire(join(ROOT, "apps/desktop/package.json"));
  const home = mkdtempSync(join(tmpdir(), "lucid-video-home-"));
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k, v]) => v !== undefined && k !== "LUCID_LLM_URL"),
  );
  env.LUCID_HOME = home;
  env.LUCID_PDF_WARMUP = "0";
  const app = await electron.launch({
    executablePath: require("electron"),
    args: [join(ROOT, "apps/desktop/out/main/index.js")],
    env,
  });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }, v) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setContentSize(v.width, v.height);
    win.show();
  }, VIEWPORT);
  await page.emulateMedia({ colorScheme: "light" });
  await page.waitForFunction(() => innerWidth === 1600 && innerHeight === 900);
  return { app, page, home };
}

export const barOf = (page) => page.getByLabel("Dictate or type your notes");

/** What Lucid says in the bar under the page ("Added a heading and 4 bullets. Undo"). */
export async function barText(page) {
  return (await page.locator(".dictation [role=status]").innerText()).replace(/\s+/g, " ").trim();
}

/** Waits for the model's job to start and to finish; resolves to how it ended. */
export async function finished(page, onStart = () => undefined) {
  await page.waitForFunction(
    () =>
      /working|waiting/.test(
        document.querySelector(".dictation")?.getAttribute("data-status") ?? "",
      ),
    null,
    { timeout: 20_000, polling: 50 },
  );
  onStart();
  const started = performance.now();
  await page.waitForFunction(
    () =>
      !/working|waiting/.test(
        document.querySelector(".dictation")?.getAttribute("data-status") ?? "",
      ),
    null,
    { timeout: 240_000, polling: 100 },
  );
  return {
    state: (await page.locator(".dictation").getAttribute("data-status")) ?? "",
    modelMs: Math.round(performance.now() - started),
  };
}

/**
 * Delivers text to the input box the way a dictation app does (Wispr Flow pastes with Cmd+V): the text lands at once and the
 * paste event makes Lucid send it by itself after a short pause. A synthetic paste event plus an inserted text is used so
 * the person's own clipboard is never touched.
 */
export async function paste(page, text) {
  await page.evaluate((words) => {
    const box = document.querySelector('textarea[aria-label="Dictate or type your notes"]');
    if (!(box instanceof HTMLTextAreaElement)) throw new Error("no input box");
    box.focus();
    const data = new DataTransfer();
    data.setData("text/plain", words);
    box.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
    );
    document.execCommand("insertText", false, words);
  }, text);
}

/** Smooth, eased scroll of the page area (frames are recorded meanwhile). */
export async function scrollEditor(page, top, ms = 900) {
  await page.evaluate(
    ({ top: to, ms: duration }) =>
      new Promise((done) => {
        const el = document.querySelector(".editor-scroll");
        if (!el) return done();
        const from = el.scrollTop;
        const t0 = performance.now();
        const step = (now) => {
          const p = Math.min(1, (now - t0) / duration);
          const e = p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2;
          el.scrollTop = from + (to - from) * e;
          if (p < 1) requestAnimationFrame(step);
          else done();
        };
        requestAnimationFrame(step);
      }),
    { top, ms },
  );
}

/** Scrolls so that the first element matching the selector has its top `offset` px under the top of the page area. */
export async function scrollToBlock(page, selector, ms = 900, offset = 24) {
  const top = await page.evaluate(
    ({ selector: s, offset: o }) => {
      const el = document.querySelector(s);
      const area = document.querySelector(".editor-scroll");
      if (!el || !area) return 0;
      return area.scrollTop + el.getBoundingClientRect().top - area.getBoundingClientRect().top - o;
    },
    { selector, offset },
  );
  await scrollEditor(page, Math.max(0, top), ms);
}

/** Bounding boxes (CSS pixels, relative to the window) of the things the composition draws rings around. */
export async function rects(page) {
  return page.evaluate(() => {
    const r = (e) => {
      const b = e.getBoundingClientRect();
      return { x: b.x, y: b.y, w: b.width, h: b.height };
    };
    const all = (s) => [...document.querySelectorAll(s)];
    const first = (s) => {
      const e = document.querySelector(s);
      return e ? r(e) : null;
    };
    // A block's box is as wide as the page column; the ring should hug the words: from the block's left edge to the
    // right end of its text.
    const tight = (e) => {
      const box = e.getBoundingClientRect();
      const walker = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
      let right = box.left;
      let top = Infinity;
      let bottom = -Infinity;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if ((node.textContent ?? "").trim().length === 0) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const q of range.getClientRects()) {
          if (q.width < 1) continue;
          right = Math.max(right, q.right);
          top = Math.min(top, q.top);
          bottom = Math.max(bottom, q.bottom);
        }
      }
      if (!Number.isFinite(top)) return r(e);
      return { x: box.left, y: top, w: right - box.left, h: bottom - top };
    };
    const area = document.querySelector(".editor-scroll");
    return {
      bar: first(".dictation"),
      editor: area ? r(area) : null,
      title: first('[aria-label="Page title"]'),
      headings: all('.page-editor [data-content-type="heading"]').map(tight),
      bullets: all('.page-editor [data-content-type="bulletListItem"]').map(tight),
      paragraphs: all('.page-editor [data-content-type="paragraph"]').map(tight),
      tables: all('.page-editor [data-content-type="lucidTable"]').map(r),
      diagrams: all('.page-editor [data-content-type="diagram"]').map(r),
      nodes: all('.page-editor [data-content-type="diagram"] g.node').map((g) => ({
        label: (g.textContent ?? "").trim(),
        ...r(g),
      })),
      history: first("aside.side"),
      historyItems: all("aside.side li[data-source]").map((e) => ({
        source: e.getAttribute("data-source"),
        text: (e.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 120),
        ...r(e),
      })),
      download: first("button.primary"),
      sidebar: first("aside.sidebar"),
      model: first(".lm-pill"),
      status: first(".dictation [role=status]"),
      undo: first(".dictation [role=status] button"),
      modes: first('[role=group][aria-label="Mode"]'),
    };
  });
}
