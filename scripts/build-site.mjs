#!/usr/bin/env node
// Assembles the GitHub Pages site into _site/: the page in site/, the pictures in docs/images and the user guide.
//   node scripts/build-site.mjs        (then: npx serve _site, or open _site/index.html)
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "_site");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(root, "site"), out, { recursive: true });
cpSync(join(root, "docs", "images"), join(out, "images"), { recursive: true });
cpSync(join(root, "docs", "guide.html"), join(out, "guide.html"));
// Served as plain files: no Jekyll.
writeFileSync(join(out, ".nojekyll"), "");

for (const file of ["index.html", "style.css", "main.js", "guide.html", "images/lucid-light.png"]) {
  if (!existsSync(join(out, file))) throw new Error(`The site is missing ${file}`);
}
console.log(`Site assembled in ${out}`);
