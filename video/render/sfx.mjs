// Sound design, made from nothing: every click, pop, whoosh and chime is synthesised here from noise and sine waves with a
// seeded random generator (so the same sounds come out every time), and a very quiet ambient pad. No sample libraries, so
// no licences to worry about. All sounds are mono Float32 arrays at 48 kHz; mix.mjs places them.

export const SR = 48000;

/** A small seeded random generator (mulberry32), so noise is the same on every run. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const seconds = (s) => new Float32Array(Math.round(s * SR));
const TAU = Math.PI * 2;

/** A state-variable band-pass filter, with a centre frequency that can change per sample. */
function bandpass(input, centre, q) {
  const out = new Float32Array(input.length);
  let ic1 = 0;
  let ic2 = 0;
  const k = 1 / q;
  for (let i = 0; i < input.length; i++) {
    const g = Math.tan((Math.PI * centre(i)) / SR);
    const a1 = 1 / (1 + g * (g + k));
    const a2 = g * a1;
    const a3 = g * a2;
    const v3 = input[i] - ic2;
    const v1 = a1 * ic1 + a2 * v3;
    const v2 = ic2 + a2 * ic1 + a3 * v3;
    ic1 = 2 * v1 - ic1;
    ic2 = 2 * v2 - ic2;
    out[i] = v1;
  }
  return out;
}

function normalise(buf, peak) {
  let max = 0;
  for (const v of buf) max = Math.max(max, Math.abs(v));
  if (max === 0) return buf;
  const k = peak / max;
  for (let i = 0; i < buf.length; i++) buf[i] *= k;
  return buf;
}

/** A short mouse click: a burst of high noise and a tiny tone. */
function click() {
  const r = rng(11);
  const out = seconds(0.09);
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    const noise = (r() * 2 - 1) * Math.exp(-t / 0.004);
    const tone = Math.sin(TAU * 2100 * t) * Math.exp(-t / 0.006);
    const body = Math.sin(TAU * 140 * t) * Math.exp(-t / 0.012);
    out[i] = 0.45 * noise + 0.5 * tone + 0.35 * body;
  }
  return normalise(out, 0.5);
}

/** A soft key tick, for typing. */
function tick(seed = 5, pitch = 3000) {
  const r = rng(seed);
  const out = seconds(0.05);
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    out[i] =
      ((r() * 2 - 1) * Math.exp(-t / 0.0025) * 0.5 +
        Math.sin(TAU * pitch * t) * Math.exp(-t / 0.003)) *
      0.6;
  }
  return normalise(out, 0.32);
}

/** A round pop: a sine that falls in pitch. */
function pop(f0 = 620, f1 = 330, decay = 0.05) {
  const out = seconds(0.28);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    const f = f1 + (f0 - f1) * Math.exp(-t / 0.03);
    phase += (TAU * f) / SR;
    const attack = Math.min(1, t / 0.003);
    out[i] = (Math.sin(phase) + 0.25 * Math.sin(2 * phase)) * Math.exp(-t / decay) * attack;
  }
  return normalise(out, 0.5);
}

/** A small rising blip, for a ring being drawn. */
function blip() {
  const out = seconds(0.2);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    const f = 760 + 520 * (1 - Math.exp(-t / 0.035));
    phase += (TAU * f) / SR;
    out[i] = Math.sin(phase) * Math.exp(-t / 0.045) * Math.min(1, t / 0.004);
  }
  return normalise(out, 0.4);
}

/** A whoosh: noise through a band that sweeps up, with a smooth swell. */
function whoosh(length = 0.8, from = 220, to = 2600, seed = 3) {
  const r = rng(seed);
  const n = Math.round(length * SR);
  const noise = new Float32Array(n);
  for (let i = 0; i < n; i++) noise[i] = r() * 2 - 1;
  const swept = bandpass(noise, (i) => from * (to / from) ** ((i / n) ** 1.4), 1.6);
  for (let i = 0; i < n; i++) {
    const p = i / n;
    swept[i] *= Math.sin(Math.PI * p) ** 2.2 * (0.55 + 0.45 * p);
  }
  return normalise(swept, 0.5);
}

/** A soft two-note chime, for "it is done". */
function chime(f = 784) {
  const out = seconds(1.1);
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    const a = Math.sin(TAU * f * t) * Math.exp(-t / 0.22);
    const b = Math.sin(TAU * f * 1.5 * t) * Math.exp(-t / 0.16) * 0.6;
    const c = Math.sin(TAU * f * 2.01 * t) * Math.exp(-t / 0.09) * 0.25;
    const d = t > 0.09 ? Math.sin(TAU * f * 2 * (t - 0.09)) * Math.exp(-(t - 0.09) / 0.2) * 0.5 : 0;
    out[i] = (a + b + c + d) * Math.min(1, t / 0.004);
  }
  return normalise(out, 0.4);
}

/** A dull thock, for text landing in the box. */
function thock() {
  const r = rng(21);
  const out = seconds(0.16);
  let lp = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    lp += 0.12 * (r() * 2 - 1 - lp);
    out[i] = (lp * 3 * Math.exp(-t / 0.02) + Math.sin(TAU * 170 * t) * Math.exp(-t / 0.035)) * 0.7;
  }
  return normalise(out, 0.45);
}

/** A slow swell that ends in a soft chime, for the last card. */
function finale() {
  const swell = whoosh(1.5, 180, 1600, 9);
  const bell = chime(659);
  const out = new Float32Array(Math.round(2.6 * SR));
  for (let i = 0; i < swell.length; i++) out[i] += swell[i] * 0.7;
  const at = Math.round(1.3 * SR);
  for (let i = 0; i < bell.length && at + i < out.length; i++) out[at + i] += bell[i];
  return normalise(out, 0.5);
}

/**
 * A very quiet ambient pad: a D major ninth chord of slightly detuned sines, each with its own slow breath, in stereo.
 * Returns [left, right].
 */
export function pad(length) {
  const n = Math.round(length * SR);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  const notes = [73.42, 146.83, 220.0, 277.18, 329.63, 369.99, 440.0]; // D2 D3 A3 C#4 E4 F#4 A4
  notes.forEach((f, k) => {
    const breath = 0.05 + 0.017 * k;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const amp = 0.55 + 0.45 * Math.sin(TAU * breath * t + k * 1.3);
      const tone = Math.sin(TAU * f * t + 0.4 * Math.sin(TAU * 0.11 * t + k));
      const gain = (k === 0 ? 1.2 : 0.7 / (1 + k * 0.25)) * amp;
      left[i] += tone * gain;
      right[i] += Math.sin(TAU * f * 1.0012 * t + k * 0.9) * gain;
    }
  });
  const fadeIn = 3.5 * SR;
  const fadeOut = 4.5 * SR;
  for (let i = 0; i < n; i++) {
    const g = Math.min(1, i / fadeIn, (n - i) / fadeOut);
    const s = g * g * (3 - 2 * g);
    left[i] *= s;
    right[i] *= s;
  }
  normalise(left, 0.5);
  normalise(right, 0.5);
  return [left, right];
}

/** Every sound the timeline can ask for, by name. */
export function library() {
  return {
    click: click(),
    tick: tick(5, 3000),
    tick2: tick(8, 2600),
    tick3: tick(13, 3400),
    pop: pop(),
    pop_low: pop(440, 240, 0.06),
    blip: blip(),
    whoosh: whoosh(0.85, 220, 2600, 3),
    whoosh_short: whoosh(0.55, 300, 3200, 4),
    whoosh_back: whoosh(0.85, 2400, 200, 6),
    chime: chime(784),
    chime_low: chime(587),
    thock: thock(),
    finale: finale(),
  };
}
