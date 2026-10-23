/* global setTimeout */
// Makes docs/images/social-preview.png (1280 x 640): the picture GitHub shows when the repository link is pasted somewhere.
// GitHub has no API for it: upload the file by hand in the repository's Settings, under Social preview.
//
//   pnpm build && node scripts/social-preview.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "apps/desktop/package.json"));
const { _electron: electron } = require("@playwright/test");
const b64 = (path) => readFileSync(path).toString("base64");
const font = (weight) =>
  b64(
    require.resolve(
      `@fontsource/ia-writer-mono/files/ia-writer-mono-latin-${String(weight)}-normal.woff2`,
    ),
  );

const html = `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:W;font-weight:400;src:url(data:font/woff2;base64,${font(400)})}
@font-face{font-family:W;font-weight:700;src:url(data:font/woff2;base64,${font(700)})}
*{box-sizing:border-box;margin:0}
body{width:1280px;height:640px;overflow:hidden;font-family:W,monospace;color:#111318;
  background:radial-gradient(circle at 22% 18%,#e9ddff 0,transparent 33%),
    linear-gradient(135deg,#fbfcff 0%,#e6ecff 100%);position:relative}
body:before{content:"";position:absolute;inset:0 auto 0 0;width:14px;background:#2457ff}
.text{position:absolute;left:72px;top:0;bottom:0;width:560px;display:flex;flex-direction:column;justify-content:center}
.brand{display:flex;align-items:center;gap:22px}
.brand img{width:92px;height:92px;border-radius:22px;box-shadow:0 6px 18px rgba(0,0,0,.18)}
.brand b{font-size:88px;line-height:1;letter-spacing:-2px}
h1{font-size:42px;line-height:1.18;margin:38px 0 22px;font-weight:700}
p{font-size:21px;line-height:1.5;color:#45495a}
.tags{margin-top:30px;font-size:17px;color:#7134e8;font-weight:700}
.shot{position:absolute;left:660px;top:92px;width:700px;height:470px;border-radius:14px 0 0 14px;overflow:hidden;
  box-shadow:0 24px 60px rgba(25,42,96,.24),0 0 0 2px #2457ff}
.shot img{width:1100px;display:block}
</style>
<div class="text">
  <div class="brand"><img src="data:image/png;base64,${b64(join(root, "apps/desktop/resources/icon.png"))}"><b>Lucid</b></div>
  <h1>Voice to structured notes and diagrams.</h1>
  <p>Talk, and a local model builds the headings, lists, tables and diagrams while you think.</p>
  <div class="tags">hands-free · local-first · macOS · Windows · Linux</div>
</div>
<div class="shot"><img src="data:image/png;base64,${b64(join(root, "docs/images/lucid-light.png"))}"></div>`;

const app = await electron.launch({
  args: [join(root, "apps/desktop/out/main/index.js")],
  env: { ...process.env, LUCID_PDF_WARMUP: "0" },
});
try {
  const png = await app.evaluate(async ({ BrowserWindow }, page) => {
    const win = new BrowserWindow({
      width: 1280,
      height: 640,
      show: false,
      useContentSize: true,
      webPreferences: { sandbox: true },
    });
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`);
    await new Promise((r) => setTimeout(r, 800));
    const image = await win.webContents.capturePage();
    const size = image.getSize();
    const out = image
      .resize({ width: 1280, height: Math.round((1280 * size.height) / size.width) })
      .toPNG();
    win.destroy();
    return out.toString("base64");
  }, html);
  writeFileSync(join(root, "docs/images/social-preview.png"), Buffer.from(png, "base64"));
  console.log("docs/images/social-preview.png");
} finally {
  await app.close();
}
