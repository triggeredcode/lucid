/* global window */
// Makes the pictures in docs/format-samples with the real app: each sample note (docs/format-samples/<format>.lmd) goes into
// Lucid as a page of its format and comes out through Download PDF, with the real diagrams, tables and math.
//
//   pnpm build && node scripts/format-samples.mjs
//
// Needs the built app (apps/desktop/out), the Tectonic that fetch-tectonic.mjs puts in place (or one on the PATH), and
// `pdftoppm` (poppler) and Python with Pillow to turn the pages into one picture.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const samples = join(root, "docs/format-samples");
const only = process.argv.slice(2);

const require = createRequire(join(root, "apps/desktop/package.json"));
const { _electron: electron } = require("@playwright/test");
const { build } = createRequire(join(root, "packages/mcp/package.json"))("esbuild");

// The note text is turned into blocks by the same parser the app uses.
const work = mkdtempSync(join(tmpdir(), "lucid-samples-"));
await build({
  entryPoints: [join(root, "packages/kit/src/index.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: join(work, "kit.mjs"),
  logLevel: "error",
});
const { parseLmd, FORMATS } = await import(pathToFileURL(join(work, "kit.mjs")).href);

const meta = JSON.parse(readFileSync(join(samples, "samples.json"), "utf8"));
const app = await electron.launch({
  args: [join(root, "apps/desktop/out/main/index.js")],
  env: { ...process.env, LUCID_HOME: mkdtempSync(join(tmpdir(), "lucid-home-")) },
});
try {
  const page = await app.firstWindow();
  await page.emulateMedia({ colorScheme: "light" });
  await app.evaluate(({ BrowserWindow, screen }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setBounds(screen.getPrimaryDisplay().workArea);
    win.maximize();
    win.show();
  });
  await page.waitForTimeout(1500);

  for (const format of FORMATS) {
    if (only.length > 0 && !only.includes(format.id)) continue;
    const { title, info } = meta[format.id];
    const parsed = parseLmd(readFileSync(join(samples, `${format.id}.lmd`), "utf8"));
    if (!parsed.ok) throw new Error(`${format.id}: ${JSON.stringify(parsed.errors)}`);

    await page.evaluate(
      async ({ title, format, info, blocks }) => {
        const file = await window.lucid.pages.create(title, { format });
        await window.lucid.pages.save({
          ...file,
          doc: { blocks },
          meta: { ...file.meta, info },
        });
      },
      { title, format: format.id, info, blocks: parsed.blocks },
    );
    await page.reload();
    await page
      .getByRole("navigation", { name: "Pages" })
      .getByRole("button", { name: new RegExp(title) })
      .click();
    if (parsed.blocks.some((b) => b.type === "diagram"))
      await page.locator(".page-editor svg g.node").first().waitFor({ timeout: 20_000 });

    const pdf = join(work, `${format.id}.pdf`);
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath });
    }, pdf);
    await page.locator('summary[aria-label="Page actions"]').click();
    await page.getByRole("button", { name: "Download PDF" }).click();
    await page.getByText(/^Saved /).waitFor({ timeout: 600_000 });

    // One picture per sample: its pages side by side.
    execFileSync("pdftoppm", ["-r", "100", "-png", pdf, join(work, format.id)]);
    execFileSync("python3", [
      "-c",
      [
        "import sys, glob",
        "from PIL import Image",
        "pages = [Image.open(p).convert('RGB') for p in sorted(glob.glob(sys.argv[1] + '-*.png'))]",
        "gap = 24",
        "w = sum(p.width for p in pages) + gap * (len(pages) - 1)",
        "out = Image.new('RGB', (w, pages[0].height), (214, 214, 214))",
        "x = 0",
        "for p in pages:",
        "    out.paste(p, (x, 0)); x += p.width + gap",
        "out.save(sys.argv[2], optimize=True)",
      ].join("\n"),
      join(work, format.id),
      join(samples, `format-${format.id}.png`),
    ]);
    console.log(`format-${format.id}.png`);
  }
} finally {
  await app.close();
  rmSync(work, { recursive: true, force: true });
}
