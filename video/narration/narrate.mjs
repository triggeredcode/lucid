// NARRATION: speaks every sentence of script/narration.json with the local voice server (the owner's cloned voice, with
// the owner's permission), measures how long each one really is, and listens to the result with a local Whisper to make
// sure the words are right. The measured durations drive the whole timeline (audio first), and the word times drive the
// captions. Everything is written to video/.cache/narration (never committed).
//
//   node narration/narrate.mjs                 # all sentences
//   node narration/narrate.mjs --only hook-1   # redo one
//   VENT_TTS_URL=http://127.0.0.1:8880 node narration/narrate.mjs
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { normalize, spokenSimilarity, timeWords } from "./lib/text.mjs";

const HERE = resolve(import.meta.dirname, "..");
const OUT = join(HERE, ".cache", "narration");
const RAW = join(OUT, "raw");
const TTS = process.env.VENT_TTS_URL ?? "http://127.0.0.1:8880";
const WHISPER_MODEL = process.env.WHISPER_MODEL ?? "mlx-community/whisper-large-v3-turbo";
const MLX_WHISPER = process.env.MLX_WHISPER ?? "mlx_whisper";
const FFMPEG = process.env.FFMPEG ?? "ffmpeg";
const FFPROBE = process.env.FFPROBE ?? "ffprobe";
const ACCEPT = 0.975; // how close the transcript must be to the text
const ROUNDS = 6;
// Words the recogniser must hear as written, whatever the similarity: a mispronounced name is the worst mistake here.
const MUST_HEAR = ["lucid"];

const script = JSON.parse(readFileSync(join(HERE, "script", "narration.json"), "utf8"));
const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : undefined;
mkdirSync(RAW, { recursive: true });

/** The clone when the server has it loaded; otherwise the server's default Kokoro voice, and the manifest says so. */
async function chooseVoice() {
  let health;
  try {
    health = await (await fetch(`${TTS}/health`)).json();
  } catch {
    throw new Error(
      `The voice server is not answering at ${TTS}. Start it (./voice/start.sh --bg in the VENT folder) or set VENT_TTS_URL.`,
    );
  }
  const clone = health.clone?.enabled === true && health.clone?.loaded === true;
  if (clone) return { name: script.voice.name, clone: true, engine: health.clone.model };
  console.warn(
    `The voice clone is not loaded on the server; using ${script.voice.fallback} (Kokoro) instead.`,
  );
  return { name: script.voice.fallback, clone: false, engine: health.model };
}

async function speak(text, voice, file) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(`${TTS}/v1/audio/speech`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "kokoro",
          voice: voice.name,
          input: text,
          response_format: "wav",
          style: script.voice.style,
        }),
      });
      if (!response.ok)
        throw new Error(`voice server: ${response.status} ${await response.text()}`);
      writeFileSync(file, Buffer.from(await response.arrayBuffer()));
      return;
    } catch (error) {
      // A connection that sat idle while Whisper was listening can be closed by the server: try again.
      if (attempt >= 3) throw error;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

const run = (cmd, argv) =>
  execFileSync(cmd, argv, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const duration = (file) =>
  parseFloat(
    run(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]),
  );

/** Trims the silence at both ends, brings every sentence to the same loudness, 48 kHz mono. */
function polish(raw, out) {
  const trim =
    "silenceremove=start_periods=1:start_threshold=-48dB:start_silence=0.03,areverse," +
    "silenceremove=start_periods=1:start_threshold=-48dB:start_silence=0.14,areverse";
  const tmp = `${out}.tmp.wav`;
  run(FFMPEG, ["-y", "-i", raw, "-af", trim, "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", tmp]);
  const log = execFileSync(FFMPEG, ["-i", tmp, "-af", "volumedetect", "-f", "null", "-"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const mean = parseFloat(/mean_volume: (-?[\d.]+) dB/.exec(log)?.[1] ?? "-20");
  const gain = Math.max(-12, Math.min(12, -20 - mean));
  run(FFMPEG, [
    "-y",
    "-i",
    tmp,
    "-af",
    `volume=${gain.toFixed(2)}dB,alimiter=limit=0.89`,
    "-c:a",
    "pcm_s16le",
    out,
  ]);
  run("rm", ["-f", tmp]);
}

/** Whisper (mlx-whisper, on the Mac's GPU) hears each file again. Returns id -> the recogniser's words with times. */
function listen(files) {
  const heard = {};
  for (const file of files) {
    const id = file
      .split("/")
      .pop()
      .replace(/\.wav$/, "");
    // One run per file: the command line tool reuses the first output name for every later file.
    run(MLX_WHISPER, [
      file,
      "--model",
      WHISPER_MODEL,
      "--language",
      "en",
      "--word-timestamps",
      "True",
      "--output-format",
      "json",
      "--output-dir",
      join(OUT, "heard"),
      "--output-name",
      id,
      "--verbose",
      "False",
    ]);
    const json = JSON.parse(readFileSync(join(OUT, "heard", `${id}.json`), "utf8"));
    heard[id] = {
      text: json.text.trim(),
      words: json.segments
        .flatMap((s) => s.words ?? [])
        .map((w) => ({
          w: w.word.trim(),
          start: w.start,
          end: w.end,
        })),
    };
  }
  return heard;
}

// --retime: only give the words of the captions their times again (after a change to lib/text.mjs), from the Whisper
// transcripts already in .cache/narration/heard. No voice is needed.
if (args.includes("--retime")) {
  const manifest = JSON.parse(readFileSync(join(OUT, "manifest.json"), "utf8"));
  for (const s of manifest.sentences) {
    const heard = JSON.parse(readFileSync(join(OUT, "heard", `${s.id}_r${s.round}.json`), "utf8"));
    const words = heard.segments
      .flatMap((g) => g.words ?? [])
      .map((w) => ({ w: w.word.trim(), start: w.start, end: w.end }));
    s.words = timeWords(s.text.split(/\s+/), words).map((w) => ({
      w: w.w,
      start: Math.round(w.start * 1000) / 1000,
      end: Math.round(w.end * 1000) / 1000,
    }));
  }
  writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 1));
  console.log(`retimed ${manifest.sentences.length} sentences`);
  process.exit(0);
}

const voice = await chooseVoice();
console.log(
  `voice: ${voice.name}${voice.clone ? " (cloned, " + voice.engine + ")" : " (no clone)"}`,
);

const all = script.scenes.flatMap((scene) =>
  scene.sentences.map((s) => ({ ...s, scene: scene.id })),
);
const wanted = only ? all.filter((s) => s.id === only) : all;
const previous = existsSync(join(OUT, "manifest.json"))
  ? JSON.parse(readFileSync(join(OUT, "manifest.json"), "utf8"))
  : { sentences: [] };
const results = new Map(previous.sentences.map((s) => [s.id, s]));
const best = new Map();

// A sentence that was accepted before is kept, unless its text changed since.
const upToDate = (s) => {
  const r = results.get(s.id);
  return r?.accepted === true && r.text === s.text && (r.say ?? null) === (s.say ?? null);
};
let pending = wanted.filter((s) => !(upToDate(s) && s.id !== only));
for (let round = 1; round <= ROUNDS && pending.length > 0; round++) {
  console.log(`round ${round}: ${pending.length} sentence(s)`);
  const made = [];
  for (const s of pending) {
    const raw = join(RAW, `${s.id}_r${round}.wav`);
    await speak(s.say ?? s.text, voice, raw);
    const out = join(OUT, `${s.id}_r${round}.wav`);
    polish(raw, out);
    made.push({ s, out });
  }
  const heard = listen(made.map((m) => m.out));
  const next = [];
  for (const { s, out } of made) {
    const id = out
      .split("/")
      .pop()
      .replace(/\.wav$/, "");
    const h = heard[id];
    const expected = s.say ?? s.text;
    const heardWords = normalize(h.text).split(" ");
    const missing = MUST_HEAR.filter(
      (w) => normalize(expected).split(" ").includes(w) && !heardWords.includes(w),
    );
    const sim = spokenSimilarity(expected, h.text) - (missing.length > 0 ? 0.5 : 0);
    const seconds = duration(out);
    console.log(`  ${s.id}: ${seconds.toFixed(2)} s, match ${sim.toFixed(3)}  "${h.text}"`);
    const candidate = { s, out, sim, seconds, h, round };
    if (!best.has(s.id) || best.get(s.id).sim < sim) best.set(s.id, candidate);
    if (sim < ACCEPT) next.push(s);
  }
  pending = next;
}

for (const [id, c] of best) {
  const final = join(OUT, `${id}.wav`);
  run("cp", [c.out, final]);
  const words = timeWords(c.s.text.split(/\s+/), c.h.words);
  results.set(id, {
    id,
    scene: c.s.scene,
    text: c.s.text,
    say: c.s.say ?? null,
    file: `${id}.wav`,
    duration: Math.round(duration(final) * 1000) / 1000,
    similarity: Math.round(c.sim * 1000) / 1000,
    accepted: c.sim >= ACCEPT,
    heard: c.h.text,
    words: words.map((w) => ({
      w: w.w,
      start: Math.round(w.start * 1000) / 1000,
      end: Math.round(w.end * 1000) / 1000,
    })),
    round: c.round,
  });
}
const sentences = all.map((s) => results.get(s.id)).filter(Boolean);
writeFileSync(
  join(OUT, "manifest.json"),
  JSON.stringify({ voice, whisper: WHISPER_MODEL, sentences }, null, 1),
);
const bad = sentences.filter((s) => !s.accepted);
const total = sentences.reduce((a, s) => a + s.duration, 0);
console.log(
  `narration: ${sentences.length} sentences, ${total.toFixed(1)} s of speech, ${bad.length} not accepted`,
);
if (bad.length > 0) {
  console.error(`Check by ear: ${bad.map((s) => s.id).join(", ")}`);
  process.exit(2);
}
