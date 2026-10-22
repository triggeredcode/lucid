/* global window, document */
// Makes the window pictures of the README, the docs and the site (docs/images) with the real app, in the light and the dark
// theme: a library of three pages, the first with a diagram and some history; the diagram builder in its three phases (the
// keywords, the connections, edits by number: the builder card of each); the New page and Export note dialogs; block 4 opened in the margin; and the page
// with a look of its own, apart from the app's. Then frame-images.mjs makes the framed copies the README and the docs show.
//
//   pnpm build && node scripts/screenshots.mjs
//
// The page is captured without the window's frame (the operating system does not let a program photograph another window
// without a permission), and on a Mac the window has no title bar of its own: the three round buttons sit at the top left of
// the page, so they are drawn at the place where the real ones are (electron/chrome.ts), and nowhere else is touched.
import { mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "docs/images");
const require = createRequire(join(root, "apps/desktop/package.json"));
const { _electron: electron } = require("@playwright/test");
const { build } = createRequire(join(root, "packages/mcp/package.json"))("esbuild");

// The note text is turned into blocks by the same parser the app uses.
const work = mkdtempSync(join(tmpdir(), "lucid-shots-"));
await build({
  entryPoints: [join(root, "packages/kit/src/index.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: join(work, "kit.mjs"),
  logLevel: "error",
});
const { parseLmd } = await import(pathToFileURL(join(work, "kit.mjs")).href);

const note = `## Start simple
One server runs the web app and the database. It works until traffic grows, then the tiers are **split** and each one scales on its own.

## The request flow
\`\`\`graph type=flowchart dir=TB title="Request flow at about a million users"
browser [client]: Browser
lb [loadbalancer]: Load balancer
order [service]: Order service
redis [cache]: Redis
pg [datastore]: PostgreSQL
kafka [queue]: Kafka
browser -> lb: API calls
lb -> order
order -> redis: read
order -> pg: cache miss
order -> kafka: order placed
\`\`\`

## The database
- PostgreSQL {chosen}
- MongoDB {struck}
`;
const parsed = parseLmd(note);
if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
const ids = parsed.blocks.map((b) => b.id);

// "Just now": the entries are made at the moment the pictures are.
const at = (seconds) => new Date(Date.now() + seconds * 1000).toISOString();
const transcripts = [
  {
    id: "t-1",
    text: "The browser sends API calls to a load balancer, which forwards them to the order service. The order service reads from Redis, queries PostgreSQL on a cache miss and publishes an event to Kafka when an order is placed.",
    source: "wispr",
    mode: "input",
    createdAt: at(-20),
    status: "applied",
  },
  {
    id: "t-2",
    text: "cross out MongoDB, we are choosing PostgreSQL",
    source: "wispr",
    mode: "command",
    createdAt: at(-10),
    status: "applied",
  },
];
// The two list items the second change touched, and the way back for it (what Revert uses).
const touched = parsed.blocks.slice(-2);
const normal = (block) => {
  const { status, ...props } = block.props;
  void status;
  return { ...block, props };
};
const changeLog = [
  {
    id: "c-1",
    at: at(-20),
    summary: "Added a diagram",
    source: "lucid",
    affected: [ids[3] ?? "x"],
    reverted: false,
  },
  {
    id: "c-2",
    at: at(-10),
    summary: "Crossed out MongoDB; marked PostgreSQL chosen",
    source: "lucid",
    affected: touched.map((b) => b.id),
    reverted: false,
    revert: {
      undo: { steps: touched.map((b) => ({ kind: "update", id: b.id, block: normal(b) })) },
      expect: Object.fromEntries(touched.map((b) => [b.id, b])),
    },
  },
];

const app = await electron.launch({
  args: [join(root, "apps/desktop/out/main/index.js")],
  env: {
    ...process.env,
    LUCID_HOME: mkdtempSync(join(tmpdir(), "lucid-home-")),
    LUCID_PDF_WARMUP: "0",
    LUCID_SKIP_ONBOARDING: "1",
  },
});
try {
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow, screen }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setBounds(screen.getPrimaryDisplay().workArea);
    win.maximize();
    win.show();
  });
  await page.emulateMedia({ colorScheme: "light" });
  await page.waitForTimeout(1500);

  // Three pages; the newest is the one that is open.
  await page.evaluate(
    async ({ blocks, transcripts, changeLog }) => {
      await window.lucid.pages.create("Raft consensus", { format: "concept-note" });
      await window.lucid.pages.create("Designing a URL shortener", { format: "system-design" });
      const file = await window.lucid.pages.create("Scaling from 0 to a million users");
      await window.lucid.pages.save({ ...file, doc: { blocks }, transcripts, changeLog });
    },
    { blocks: parsed.blocks, transcripts, changeLog },
  );
  await page.reload();
  await page
    .getByRole("navigation", { name: "Pages" })
    .getByRole("button", { name: /Scaling/ })
    .click();
  await page.locator(".page-editor svg g.node").first().waitFor({ timeout: 20_000 });
  await page.waitForTimeout(800);

  // History is intentionally closed on a normal first launch. Open it for the
  // feature and guide captures so the annotated screenshot still documents it.
  await page.getByRole("button", { name: "History" }).click();
  await page.getByRole("complementary", { name: "History" }).waitFor();

  /** The window as it is, with the three round buttons where the real ones sit on a Mac. */
  const shoot = async () => {
    // Not hovering anything, so no row shows its delete button.
    await page.evaluate(() => {
      document.activeElement?.blur();
    });
    await page.mouse.move(900, 1090);
    await page.waitForTimeout(250);
    await page.evaluate(() => {
      const bar = document.querySelector(".topbar")?.getBoundingClientRect().height ?? 56;
      ["#ff5f57", "#febc2e", "#28c840"].forEach((color, i) => {
        const dot = document.createElement("div");
        dot.className = "traffic-light-mark";
        dot.style.cssText = `position:fixed;left:${String(20 + i * 20)}px;top:${String(Math.round((bar - 12) / 2))}px;width:12px;height:12px;border-radius:50%;background:${color};z-index:99999;pointer-events:none`;
        document.body.appendChild(dot);
      });
    });
    const png = await page.screenshot();
    await page.evaluate(() => {
      document.querySelectorAll(".traffic-light-mark").forEach((e) => {
        e.remove();
      });
    });
    return png;
  };
  const resized = async (png, name, wide = 1800) => {
    // The window is as big as the screen, at the screen's density: bring every picture to 1800 pixels wide (a crop, less).
    const data = await app.evaluate(
      ({ nativeImage }, { base64, wide }) => {
        const image = nativeImage.createFromBuffer(Buffer.from(base64, "base64"));
        const size = image.getSize();
        return image
          .resize({
            width: wide,
            height: Math.round((wide * size.height) / size.width),
            quality: "best",
          })
          .toPNG()
          .toString("base64");
      },
      { base64: png.toString("base64"), wide },
    );
    writeFileSync(join(out, name), Buffer.from(data, "base64"));
    console.log(name);
  };

  for (const scheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(600);
    if (scheme === "light") {
      // Where two things of the top bar are, in the pixels of the pictures (the guide puts numbered markers on them).
      const anchors = await page.evaluate(() => {
        const scale = 1800 / window.innerWidth;
        const box = (selector) => {
          const r = document.querySelector(selector)?.getBoundingClientRect();
          return r
            ? { x: r.x * scale, y: r.y * scale, w: r.width * scale, h: r.height * scale }
            : null;
        };
        return {
          height: window.innerHeight * scale,
          pill: box(".lm-pill"),
          look: box(".page-look"),
        };
      });
      console.log(`anchors ${JSON.stringify(anchors)}`);
    }
    await resized(await shoot(), scheme === "light" ? "lucid-light.png" : "lucid-dark.png");

    const dark = scheme === "dark";
    const named = (name) => (dark ? `${name}-dark.png` : `${name}.png`);

    // The diagram builder, in its three phases: the keywords, the connections, then edits by number.
    const bar = page.getByLabel("Dictate or type your notes");
    const say = async (text) => {
      await bar.fill(text);
      await bar.press("Enter");
    };
    await bar.focus();
    await page.keyboard.press("Meta+4");
    await say("add keywords: browser, CDN, load balancer, order service, Redis, PostgreSQL, Kafka");
    await page.locator(".wb-svg svg g.node").first().waitFor({ timeout: 20_000 });
    await page.waitForTimeout(1200);
    const card = page.locator(".workbench");
    await resized(await card.screenshot(), named("builder-keywords"), 1000);
    await say("connections");
    for (const line of ["1 to 2", "1 to 3", "3 to 4", "4 to 5", "4 to 6", "4 to 7"])
      await say(line);
    await page.waitForTimeout(1200);
    await resized(await shoot(), named("diagram-builder"));
    await resized(await card.screenshot(), named("builder-connections"), 1000);
    await say("edit");
    for (const line of [
      "connection 1 is static files",
      "connection 4 is cache reads",
      "rename 7 to Event bus",
    ])
      await say(line);
    await page.waitForTimeout(1200);
    await resized(await card.screenshot(), named("builder-edit"), 1000);
    await page.getByRole("button", { name: "Cancel" }).click();
    await page.waitForTimeout(500);

    // The New page dialog, as the guide shows it.
    await page.getByRole("button", { name: "New from a format…" }).click();
    await page.locator(".np-dialog").waitFor();
    await page.waitForTimeout(500);
    await page.locator(".np-dialog").screenshot({ path: join(out, named("new-page")) });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    // The Export note dialog.
    await page.getByRole("button", { name: "Export note" }).click();
    const exporting = page.getByRole("dialog", { name: "Export note" });
    await exporting.waitFor();
    await page.waitForTimeout(500);
    await exporting.screenshot({ path: join(out, named("export-note")) });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    // Block 4 opened in the margin.
    await page.locator(".block-no").nth(3).click();
    await page.waitForTimeout(600);
    await resized(await shoot(), named("block-numbers"));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    // The page's own look, the other way round from the app's.
    const look = dark ? "light" : "dark";
    const switchLook = page.locator(".page-look");
    for (let i = 0; i < 3; i++) {
      if (
        ((await switchLook.getAttribute("aria-label")) ?? "").startsWith(
          `Look of the page: ${look}.`,
        )
      )
        break;
      await switchLook.click();
    }
    await page.waitForTimeout(800);
    await resized(await shoot(), `page-look-${look}-page.png`);
    for (let i = 0; i < 3; i++) {
      if (
        ((await switchLook.getAttribute("aria-label")) ?? "").startsWith(
          "Look of the page: like the app.",
        )
      )
        break;
      await switchLook.click();
    }
  }
} finally {
  await app.close();
}

// The framed copies the README and the docs show.
await import("./frame-images.mjs");
