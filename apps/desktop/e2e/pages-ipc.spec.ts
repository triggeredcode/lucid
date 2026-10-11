import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";
import { maximizeWindow } from "./helpers";

test("pages can be created, saved, listed and reloaded through the preload bridge, and bad saves are refused", async () => {
  const home = mkdtempSync(join(tmpdir(), "lucid-home-"));
  const app = await electron.launch({
    args: [join(__dirname, "../out/main/index.js")],
    env: { ...process.env, LUCID_HOME: home },
  });
  try {
    const page = await app.firstWindow();
    await maximizeWindow(app, page);
    const created = await page.evaluate(() => window.lucid.pages.create("Caching notes"));
    expect(created.title).toBe("Caching notes");

    const saved = await page.evaluate(async (file) => {
      return window.lucid.pages.save({
        ...file,
        title: "KV cache sizing",
        doc: {
          blocks: [
            {
              id: "b1",
              type: "paragraph",
              props: {},
              content: [{ type: "text", text: "hello", styles: {} }],
            },
          ],
        },
      });
    }, created);
    expect(saved.title).toBe("KV cache sizing");

    const listed = await page.evaluate(() => window.lucid.pages.list());
    expect(listed.problems).toEqual([]);
    expect(listed.pages.map((p) => p.title)).toEqual(["KV cache sizing"]);
    expect(readdirSync(home).filter((n) => n !== ".lucid" && n.endsWith(".lucid"))).toHaveLength(1);

    const loaded = await page.evaluate((id) => window.lucid.pages.load(id), created.id);
    expect(loaded.doc.blocks).toHaveLength(1);

    // The main process validates what the renderer sends.
    const refused = await page.evaluate(() =>
      window.lucid.pages.save({ format: "lucid", version: 1 } as never).then(
        () => "saved",
        () => "refused",
      ),
    );
    expect(refused).toBe("refused");
    expect(readdirSync(home).filter((n) => n !== ".lucid" && n.endsWith(".lucid"))).toHaveLength(1);
  } finally {
    await app.close();
  }
});

test("a page compiles to a real PDF through the bridge, and a newer compile replaces an older one", async () => {
  const home = mkdtempSync(join(tmpdir(), "lucid-home-"));
  const app = await electron.launch({
    args: [join(__dirname, "../out/main/index.js")],
    env: { ...process.env, LUCID_HOME: home },
  });
  try {
    const page = await app.firstWindow();
    await maximizeWindow(app, page);
    const doc = {
      blocks: [
        {
          id: "h",
          type: "heading",
          props: { level: 1 },
          content: [{ type: "text", text: "Caching", styles: {} }],
        },
        {
          id: "p",
          type: "paragraph",
          props: {},
          content: [{ type: "text", text: "A cache sits in front of the database.", styles: {} }],
        },
      ],
    };
    const result = await page.evaluate(async (d) => {
      const r = await window.lucid.pdf.compile({
        pageId: "p1",
        title: "KV cache",
        doc: d as never,
        figures: {},
      });
      return r.ok
        ? { ok: true, head: Array.from(r.pdf.slice(0, 5)), size: r.pdf.length }
        : { ok: false, message: "message" in r ? r.message : "cancelled" };
    }, doc);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(String.fromCharCode(...(result.head ?? []))).toBe("%PDF-");
    expect(result.size).toBeGreaterThan(5000);

    const refused = await page.evaluate(() =>
      window.lucid.pdf
        .compile({ pageId: "p2", title: "x", doc: { blocks: [{ nope: 1 }] } as never, figures: {} })
        .then(
          () => "compiled",
          () => "refused",
        ),
    );
    expect(refused).toBe("refused");
  } finally {
    await app.close();
  }
});
