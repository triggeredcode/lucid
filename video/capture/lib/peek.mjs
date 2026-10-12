// Developer tool: copies the captured frame nearest to a time (or a mark) to a file you can look at.
//   node capture/lib/peek.mjs d1.done+400 out.jpg   |   node capture/lib/peek.mjs 12.5s out.jpg
import { copyFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const dir = join(resolve(import.meta.dirname, "../.."), ".cache", "capture");
const m = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
const [spec, out] = process.argv.slice(2);
let t;
if (/^[\d.]+s$/.test(spec)) t = parseFloat(spec) * 1000;
else {
  const [name, off] = spec.split(/(?=[+-]\d)/);
  const mark = m.marks.find((x) => x.name === name);
  if (!mark) throw new Error(`no mark ${name}`);
  t = mark.t + Number(off ?? 0);
}
let best = m.frames[0];
for (const f of m.frames) if (f.t <= t) best = f;
copyFileSync(join(dir, best.file), out);
console.log(`${best.file} @${best.t} (asked ${Math.round(t)})`);
