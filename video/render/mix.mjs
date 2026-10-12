// The audio mix, done in plain code so that it is the same every time: the narration sentences at the times of the
// timeline, the synthesised sound effects (sfx.mjs) at theirs, and a very quiet pad that ducks under the voice.
// Writes a stereo 48 kHz WAV; render.mjs encodes it into the video.
//
//   node render/mix.mjs            # uses .cache/render/timeline.json and writes .cache/render/audio.wav
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { SR, library, pad } from "./sfx.mjs";

const HERE = resolve(import.meta.dirname, "..");

/** 16-bit PCM mono WAV -> Float32Array. */
export function readWav(file) {
  const buf = readFileSync(file);
  if (buf.toString("ascii", 0, 4) !== "RIFF") throw new Error(`${file} is not a WAV file`);
  let pos = 12;
  let channels = 1;
  let rate = SR;
  while (pos + 8 <= buf.length) {
    const id = buf.toString("ascii", pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    if (id === "fmt ") {
      channels = buf.readUInt16LE(pos + 10);
      rate = buf.readUInt32LE(pos + 12);
    }
    if (id === "data") {
      if (rate !== SR || channels !== 1)
        throw new Error(`${file}: expected 48 kHz mono, got ${rate} Hz, ${channels} ch`);
      const n = Math.floor(Math.min(size, buf.length - pos - 8) / 2);
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = buf.readInt16LE(pos + 8 + i * 2) / 32768;
      return out;
    }
    pos += 8 + size + (size % 2);
  }
  throw new Error(`${file}: no data chunk`);
}

function writeWavStereo(file, left, right) {
  const n = left.length;
  const data = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(left[i] * 32767))), i * 4);
    data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(right[i] * 32767))), i * 4 + 2);
  }
  const head = Buffer.alloc(44);
  head.write("RIFF", 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write("WAVEfmt ", 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(2, 22);
  head.writeUInt32LE(SR, 24);
  head.writeUInt32LE(SR * 4, 28);
  head.writeUInt16LE(4, 32);
  head.writeUInt16LE(16, 34);
  head.write("data", 36);
  head.writeUInt32LE(data.length, 40);
  writeFileSync(file, Buffer.concat([head, data]));
}

/** How loud the voice is, per sample, smoothed: quick to rise, slow to fall (0 silent, 1 speaking). */
function envelope(voice) {
  const env = new Float32Array(voice.length);
  const block = Math.round(0.01 * SR);
  let level = 0;
  const attack = 1 - Math.exp(-block / (0.05 * SR));
  const release = 1 - Math.exp(-block / (0.55 * SR));
  for (let start = 0; start < voice.length; start += block) {
    let sum = 0;
    const end = Math.min(voice.length, start + block);
    for (let i = start; i < end; i++) sum += voice[i] * voice[i];
    const rms = Math.sqrt(sum / (end - start));
    const target = Math.min(1, rms / 0.04);
    level += (target - level) * (target > level ? attack : release);
    env.fill(level, start, end);
  }
  return env;
}

export function mix(timeline, narrationDir, outFile) {
  const total = Math.ceil((timeline.duration + 0.6) * SR);
  const L = new Float32Array(total);
  const R = new Float32Array(total);
  const voice = new Float32Array(total);

  for (const cue of timeline.audio.narration) {
    const wav = readWav(join(narrationDir, cue.file));
    const at = Math.round(cue.t * SR);
    const gain = cue.gain ?? 1;
    for (let i = 0; i < wav.length && at + i < total; i++) {
      L[at + i] += wav[i] * gain;
      R[at + i] += wav[i] * gain;
      voice[at + i] += wav[i] * gain;
    }
  }
  const env = envelope(voice);

  // The pad, quiet, and quieter still while someone speaks.
  const [pl, pr] = pad(total / SR);
  const padGain = timeline.audio.padGain ?? 0.05;
  for (let i = 0; i < total; i++) {
    const duck = 1 - 0.7 * env[i];
    L[i] += pl[i] * padGain * duck;
    R[i] += pr[i] * padGain * duck;
  }

  // The sound effects.
  const sounds = library();
  for (const cue of timeline.audio.sfx) {
    const buf = sounds[cue.name];
    if (!buf) throw new Error(`no sound called ${cue.name}`);
    const at = Math.round(cue.t * SR);
    const pan = Math.max(-1, Math.min(1, cue.pan ?? 0));
    const lg = Math.cos(((pan + 1) * Math.PI) / 4);
    const rg = Math.sin(((pan + 1) * Math.PI) / 4);
    const duck = 1 - 0.3 * (env[Math.min(total - 1, Math.max(0, at))] ?? 0);
    const gain = (cue.gain ?? 0.3) * duck;
    for (let i = 0; i < buf.length && at + i < total; i++) {
      if (at + i < 0) continue;
      L[at + i] += buf[i] * gain * lg * 1.4142;
      R[at + i] += buf[i] * gain * rg * 1.4142;
    }
  }

  // A gentle ceiling, so nothing clips whatever is stacked.
  for (let i = 0; i < total; i++) {
    L[i] = Math.tanh(L[i] * 0.9) / 0.9;
    R[i] = Math.tanh(R[i] * 0.9) / 0.9;
  }
  writeWavStereo(outFile, L, R);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const timeline = JSON.parse(
    readFileSync(join(HERE, ".cache", "render", "timeline.json"), "utf8"),
  );
  const out = join(HERE, ".cache", "render", "audio.wav");
  mix(timeline, join(HERE, ".cache", "narration"), out);
  console.log(`wrote ${out}`);
}
