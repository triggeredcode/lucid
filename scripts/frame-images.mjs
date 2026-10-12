// Makes the framed copies of the window pictures (docs/images/*.png -> docs/images/readme/*.png) that the README and the docs
// show: rounded corners and a thin edge, so a picture stands out on the page it sits on. A light picture on GitHub's white page
// gets a grey edge, and a dark one, which would melt into GitHub's dark page, gets a light edge (the edge is made to be seen on
// either page). The website frames its own pictures in CSS and uses the plain ones.
//
//   node scripts/frame-images.mjs        (needs Python with Pillow, as format-samples.mjs does)
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(root, "docs/images");
const to = join(from, "readme");
mkdirSync(to, { recursive: true });

// The social preview is a card on its own, not a window picture.
const skip = new Set(["social-preview.png", "poster.png"]);
const files = readdirSync(from).filter((f) => f.endsWith(".png") && !skip.has(f));
// The first picture of the README, a dark app with a light page, has a white edge: white, the dark app, the light page.
const white = ["page-look-light-page.png"];

execFileSync(
  "python3",
  [
    "-c",
    [
      "import sys, os",
      "from PIL import Image, ImageChops, ImageDraw, ImageStat",
      "src, dst, white = sys.argv[1], sys.argv[2], sys.argv[3].split(',')",
      "for name in sys.argv[4:]:",
      "    im = Image.open(os.path.join(src, name)).convert('RGB')",
      "    w, h = im.size",
      "    r = max(10, round(w / 150))",
      "    bw = max(2, round(w / 700))",
      // Light or dark is read from the picture's own edge, not its name: a light app can hold a dark page.
      "    strips = [im.crop((0, 0, w, 6)), im.crop((0, h - 6, w, h)), im.crop((0, 0, 6, h)), im.crop((w - 6, 0, w, h))]",
      "    lum = sum(ImageStat.Stat(s.convert('L')).mean[0] for s in strips) / 4",
      "    edge = (214, 222, 232, 255) if lum < 110 else (170, 178, 189, 255)",
      "    if name in white: edge = (255, 255, 255, 255)",
      "    k = 4",
      "    def rounded(inset, radius):",
      "        m = Image.new('L', (w * k, h * k), 0)",
      "        ImageDraw.Draw(m).rounded_rectangle([inset * k, inset * k, (w - inset) * k - 1, (h - inset) * k - 1], radius=radius * k, fill=255)",
      "        return m.resize((w, h), Image.LANCZOS)",
      "    outer, inner = rounded(0, r), rounded(bw, max(r - bw, 1))",
      "    ring = ImageChops.subtract(outer, inner)",
      "    out = Image.composite(Image.new('RGBA', (w, h), edge), im.convert('RGBA'), ring)",
      "    out.putalpha(outer)",
      "    out.save(os.path.join(dst, name), optimize=True)",
      "    print(name, 'white' if name in white else 'dark' if lum < 110 else 'light')",
    ].join("\n"),
    from,
    to,
    white.join(","),
    ...files,
  ],
  { stdio: "inherit" },
);
