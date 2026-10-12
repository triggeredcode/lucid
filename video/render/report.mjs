// REPORT: prints the timeline in words, so that it can be checked without watching the video: every scene with its start
// and end, every sentence with the time it is said, and every ring, label and sound cue with the word being spoken at that
// moment. Nothing is rendered.
//
//   node render/report.mjs
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const HERE = resolve(import.meta.dirname, "..");
const T = JSON.parse(readFileSync(join(HERE, ".cache", "render", "timeline.json"), "utf8"));

const words = T.captions.flatMap((c) => c.words);
const at = (t) => {
  const w = words.find((x) => t >= x.t0 - 0.05 && t <= x.t1 + 0.05);
  if (w) return `"${w.w}"`;
  const prev = [...words].reverse().find((x) => x.t1 < t);
  return prev ? `after "${prev.w}" (+${(t - prev.t1).toFixed(2)} s)` : "before the voice";
};
const f = (t) => t.toFixed(2).padStart(6);

console.log(`duration ${T.duration.toFixed(2)} s, ${T.fps} fps, ${T.width}x${T.height}`);
console.log("\nscenes");
for (const [id, s] of Object.entries(T.scenes))
  console.log(`  ${id.padEnd(10)} ${f(s.t0)} - ${f(s.t1)}`);

console.log("\nsentences");
for (const c of T.captions) {
  console.log(`  ${f(c.t0)} - ${f(c.t1)}  ${c.words.map((w) => w.w).join(" ")}`);
}

console.log("\nrings (what is circled, and the word being said when it appears)");
for (const r of T.rings) {
  console.log(`  ${f(r.t0)}  ${(r.label ?? "").padEnd(24)} on ${at(r.t0)}`);
}
console.log("\nlabels");
for (const p of T.pills) {
  console.log(`  ${f(p.t0)}  ${(p.text + (p.sub ? ` ${p.sub}` : "")).padEnd(40)} on ${at(p.t0)}`);
}
console.log("\ncuts (source jumps, with a dissolve)");
T.map.forEach((m, i) => {
  if (!m.x) return;
  const prev = T.map[i - 1];
  console.log(
    `  ${f(m.o0)}  source ${((prev?.s1 ?? 0) / 1000).toFixed(1)} s -> ${(m.s0 / 1000).toFixed(1)} s  (${m.x} s dissolve)`,
  );
});
const sounds = {};
for (const s of T.audio.sfx) sounds[s.name] = (sounds[s.name] ?? 0) + 1;
console.log(`\nsounds: ${JSON.stringify(sounds)}`);
console.log(`narration cues: ${T.audio.narration.length}`);
