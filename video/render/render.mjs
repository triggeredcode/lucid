// RENDER: opens the stage in Chromium, asks it for every frame of the timeline, and gives the frames to FFmpeg. Then the
// audio is mixed (mix.mjs) and muxed in. This is the part that runs in the container: it needs only Chromium, FFmpeg,
// the pinned fonts (node_modules) and the files that the capture and the narration left in .cache.
//
//   node render/render.mjs                         # the whole video -> out/lucid-intro.mp4
//   node render/render.mjs --poster                # the 1280 x 640 poster -> out/poster.png
//   node render/render.mjs --still 12.5 out/a.png  # one frame, to look at
//   node render/render.mjs --from 20 --to 30       # a part, to check a scene (no audio)
//   RENDER_WORKERS=4 node render/render.mjs        # how many pages render at once (default 3)
import { spawn, execFileSync } from "node:child_process";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { chromium } from "playwright";
import { mix } from "./mix.mjs";

const HERE = resolve(import.meta.dirname, "..");
const CACHE = join(HERE, ".cache");
const OUT = join(HERE, "out");
const FFMPEG = process.env.FFMPEG ?? "ffmpeg";
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name) => (flag(name) ? args[args.indexOf(`--${name}`) + 1] : undefined);

const ROUTES = [
  ["/stage/", join(HERE, "render", "stage")],
  ["/fonts/", join(HERE, "node_modules", "@fontsource", "ia-writer-mono", "files")],
  ["/capture/", join(CACHE, "capture")],
  ["/assets/", join(HERE, "assets")],
];
const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
};

/** A tiny static server on a free local port: the stage page, the fonts, the captured frames and the timeline. */
function serve() {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    let file;
    if (url.pathname === "/timeline.json") file = join(CACHE, "render", "timeline.json");
    else {
      for (const [prefix, dir] of ROUTES) {
        if (url.pathname.startsWith(prefix)) {
          const rest = normalize(decodeURIComponent(url.pathname.slice(prefix.length)));
          if (rest.startsWith("..")) break;
          file = join(dir, rest);
        }
      }
    }
    if (!file || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    createReadStream(file).pipe(res);
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok(server)));
}

const CHROMIUM_ARGS = [
  "--force-color-profile=srgb",
  "--font-render-hinting=none",
  "--disable-lcd-text",
  "--disable-gpu",
  "--hide-scrollbars",
  "--no-sandbox",
];

async function openStage(browser, base, size, query = "") {
  const context = await browser.newContext({
    viewport: size,
    deviceScaleFactor: 1,
    colorScheme: "light",
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.error("stage error:", e.message));
  page.on("console", (m) => {
    if (m.type() === "error") console.error("stage:", m.text());
  });
  await page.goto(`${base}/stage/stage.html${query}`);
  const info = await page.evaluate(() => window.stage.init());
  const cdp = await context.newCDPSession(page);
  const shot = async () =>
    Buffer.from(
      (await cdp.send("Page.captureScreenshot", { format: "png", optimizeForSpeed: true })).data,
      "base64",
    );
  return { page, info, shot };
}

mkdirSync(OUT, { recursive: true });
const timelinePath = join(CACHE, "render", "timeline.json");
if (!existsSync(timelinePath)) throw new Error("no timeline: run `npm run plan` first");
const timeline = JSON.parse(readFileSync(timelinePath, "utf8"));
const server = await serve();
const base = `http://127.0.0.1:${server.address().port}`;
// CHROMIUM_PATH: use another Chromium than the one Playwright installs (for a quick run on the host; the container uses the pinned one).
const browser = await chromium.launch({
  args: CHROMIUM_ARGS,
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
});

try {
  if (flag("poster")) {
    const file =
      value("poster") && !value("poster").startsWith("--")
        ? value("poster")
        : join(OUT, "poster.png");
    const { shot } = await openStage(browser, base, { width: 1280, height: 640 }, "?poster=1");
    writeFileSync(file, await shot());
    console.log(`poster: ${file}`);
  } else if (flag("stills")) {
    // several frames in one go: --stills 1,2.5,7 out/dir
    const times = value("stills").split(",").map(Number);
    const dir = args[args.indexOf("--stills") + 2] ?? OUT;
    mkdirSync(dir, { recursive: true });
    const { page, shot } = await openStage(browser, base, { width: 1920, height: 1080 });
    for (const t of times) {
      await page.evaluate((x) => window.stage.seek(x), t);
      writeFileSync(join(dir, `t${t.toFixed(2).padStart(6, "0")}.png`), await shot());
    }
    console.log(`stills: ${times.length} in ${dir}`);
  } else if (flag("still")) {
    const t = Number(value("still"));
    const file = args[args.indexOf("--still") + 2] ?? join(OUT, `still-${t}.png`);
    const { page, shot } = await openStage(browser, base, { width: 1920, height: 1080 });
    await page.evaluate((x) => window.stage.seek(x), t);
    writeFileSync(file, await shot());
    console.log(`still: ${file}`);
  } else {
    const fps = timeline.fps;
    const from = Number(value("from") ?? 0);
    const to = Math.min(Number(value("to") ?? timeline.duration), timeline.duration);
    const partial = flag("from") || flag("to");
    const first = Math.round(from * fps);
    const last = Math.round(to * fps);
    const count = last - first;
    const videoOnly = join(OUT, partial ? "part.mp4" : "video-only.mp4");
    const ffmpeg = spawn(
      FFMPEG,
      [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "image2pipe",
        "-framerate",
        String(fps),
        "-vcodec",
        "png",
        "-i",
        "-",
        "-vf",
        "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p",
        "-c:v",
        "libx264",
        "-preset",
        "slow",
        "-crf",
        "15",
        "-profile:v",
        "high",
        "-colorspace",
        "bt709",
        "-color_primaries",
        "bt709",
        "-color_trc",
        "bt709",
        "-color_range",
        "tv",
        "-r",
        String(fps),
        "-movflags",
        "+faststart",
        videoOnly,
      ],
      { stdio: ["pipe", "inherit", "inherit"] },
    );
    const done = new Promise((ok, fail) => {
      ffmpeg.on("exit", (code) =>
        code === 0 ? ok() : fail(new Error(`ffmpeg exited with ${code}`)),
      );
    });

    const workers = Number(process.env.RENDER_WORKERS ?? 3);
    const pages = await Promise.all(
      Array.from({ length: workers }, () =>
        openStage(browser, base, { width: 1920, height: 1080 }),
      ),
    );
    const started = Date.now();
    const ready = new Map();
    let next = first;
    let written = first;
    const flush = async () => {
      while (ready.has(written)) {
        const png = ready.get(written);
        ready.delete(written);
        if (!ffmpeg.stdin.write(png)) await new Promise((ok) => ffmpeg.stdin.once("drain", ok));
        written++;
      }
    };
    await Promise.all(
      pages.map(async ({ page, shot }) => {
        for (;;) {
          // keep memory bounded: do not run far ahead of the writer
          while (next - written > workers * 4) await new Promise((ok) => setTimeout(ok, 20));
          const i = next++;
          if (i >= last) return;
          await page.evaluate((t) => window.stage.seek(t), i / fps);
          ready.set(i, await shot());
          await flush();
          if ((i - first) % 60 === 0) {
            const secs = (Date.now() - started) / 1000;
            console.log(
              `frame ${i - first}/${count}  ${(((i - first) / count) * 100).toFixed(0)}%  ${secs.toFixed(0)} s`,
            );
          }
        }
      }),
    );
    await flush();
    ffmpeg.stdin.end();
    await done;

    if (partial) {
      console.log(`part: ${videoOnly}`);
    } else {
      const audio = join(CACHE, "render", "audio.wav");
      mix(timeline, join(CACHE, "narration"), audio);
      const final = join(OUT, "lucid-intro.mp4");
      execFileSync(
        FFMPEG,
        [
          "-y",
          "-hide_banner",
          "-loglevel",
          "error",
          "-i",
          videoOnly,
          "-i",
          audio,
          "-map",
          "0:v:0",
          "-map",
          "1:a:0",
          "-c:v",
          "copy",
          "-af",
          "loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000",
          "-c:a",
          "aac",
          "-b:a",
          "192k",
          "-shortest",
          "-movflags",
          "+faststart",
          final,
        ],
        { stdio: "inherit" },
      );
      rmSync(videoOnly, { force: true });
      console.log(`video: ${final}`);
    }
  }
} finally {
  await browser.close();
  server.close();
}
