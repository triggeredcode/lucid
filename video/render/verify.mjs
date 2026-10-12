// VERIFY: checks the finished video itself, not the plan. It reads the audio track of out/lucid-intro.mp4, listens to it with
// the local Whisper, and compares when every sentence is really heard with when the timeline says the captions show it. It
// also prints the format facts (codecs, size, duration) from ffprobe.
//
//   node render/verify.mjs [out/lucid-intro.mp4]
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { normalize, spokenSimilarity } from "../narration/lib/text.mjs";

const HERE = resolve(import.meta.dirname, "..");
const video = process.argv[2] ?? join(HERE, "out", "lucid-intro.mp4");
const work = join(HERE, ".cache", "verify");
mkdirSync(work, { recursive: true });
const T = JSON.parse(readFileSync(join(HERE, ".cache", "render", "timeline.json"), "utf8"));
const run = (cmd, args) =>
  execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const probe = JSON.parse(
  run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration,size,bit_rate:stream=codec_name,profile,width,height,r_frame_rate,pix_fmt,sample_rate,channels",
    "-of",
    "json",
    video,
  ]),
);
console.log("format:", JSON.stringify(probe.format));
for (const s of probe.streams) console.log("stream:", JSON.stringify(s));

const wav = join(work, "audio.wav");
run("ffmpeg", ["-y", "-v", "error", "-i", video, "-vn", "-ac", "1", "-ar", "16000", wav]);
run(process.env.MLX_WHISPER ?? "mlx_whisper", [
  wav,
  "--model",
  process.env.WHISPER_MODEL ?? "mlx-community/whisper-large-v3-turbo",
  "--language",
  "en",
  "--word-timestamps",
  "True",
  "--output-format",
  "json",
  "--output-dir",
  work,
  "--output-name",
  "heard",
  "--verbose",
  "False",
]);
const heard = JSON.parse(readFileSync(join(work, "heard.json"), "utf8"));
const words = heard.segments
  .flatMap((s) => s.words ?? [])
  .map((w) => ({ w: w.word.trim(), start: w.start, end: w.end }));
console.log(`\nWhisper heard ${words.length} words in the final audio:\n  ${heard.text.trim()}\n`);

// For each caption sentence: find where its first and last words are heard (the nearest matching word to the planned time).
let worst = 0;
let count = 0;
for (const c of T.captions) {
  const first = normalize(c.words[0].w).replace(/ /g, "");
  const last = normalize(c.words[c.words.length - 1].w).replace(/ /g, "");
  const near = (target, t) =>
    words
      .filter((x) => spokenSimilarity(target, x.w) > 0.6)
      .sort((a, b) => Math.abs(a.start - t) - Math.abs(b.start - t))[0];
  const a = near(first, c.t0);
  const b = near(last, c.t1 - 0.2);
  const da = a ? a.start - c.words[0].t0 : NaN;
  const db = b ? b.end - c.words[c.words.length - 1].t1 : NaN;
  worst = Math.max(worst, Math.abs(da) || 0, Math.abs(db) || 0);
  count++;
  console.log(
    `${c.t0.toFixed(2).padStart(6)}  start ${Number.isNaN(da) ? "  ?  " : (da >= 0 ? "+" : "") + da.toFixed(2)} s   end ${Number.isNaN(db) ? "  ?  " : (db >= 0 ? "+" : "") + db.toFixed(2)} s   ${c.words
      .map((w) => w.w)
      .join(" ")
      .slice(0, 60)}`,
  );
}
console.log(
  `\n${count} sentences compared; the largest difference between the timeline and the audio is ${worst.toFixed(2)} s`,
);
