// PLAN: the director. It takes the two things that really happened, the narration (how long each sentence is and when
// every word is said) and the capture (what the real app did, and when), and writes the one file the stage needs:
// .cache/render/timeline.json. Audio comes first: the voice decides how long every scene is, and each visual beat is
// pinned to the word it belongs to ("heading", "table", "cache"). Where the model took longer than the sentence, the
// working time is cut short with a dissolve and a small note says so.
//
//   node render/plan.mjs
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { readWav } from "./mix.mjs";

const HERE = resolve(import.meta.dirname, "..");
const CAP = join(HERE, ".cache", "capture");
const OUT = join(HERE, ".cache", "render");
const FPS = 30;
const GAP = 0.28; // between two sentences of one scene

const cap = JSON.parse(readFileSync(join(CAP, "manifest.json"), "utf8"));
const nar = JSON.parse(readFileSync(join(HERE, ".cache", "narration", "manifest.json"), "utf8"));
const dict = JSON.parse(readFileSync(join(HERE, "script", "dictation.json"), "utf8"));
const script = JSON.parse(readFileSync(join(HERE, "script", "narration.json"), "utf8"));
if (cap.ok !== true)
  throw new Error("the capture in .cache/capture is not a finished take; run the capture again");

// ---------------------------------------------------------------- reading the capture
const mark = (name) => {
  const m = cap.marks.find((x) => x.name === name);
  if (!m) throw new Error(`the capture has no mark "${name}"`);
  return m;
};
/** Source time (ms) of a mark, plus an offset. */
const ms = (name, off = 0) => mark(name).t + off;
const rects = (name) => {
  const r = mark(name).rects;
  if (!r) throw new Error(`the mark "${name}" carries no rectangles`);
  return r;
};
const box = (r) => ({ u: r.x, v: r.y, w: r.w, h: r.h });
const union = (list) => {
  const x0 = Math.min(...list.map((r) => r.x));
  const y0 = Math.min(...list.map((r) => r.y));
  const x1 = Math.max(...list.map((r) => r.x + r.w));
  const y1 = Math.max(...list.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};
const TB = cap.titleBar ?? 0;

// ---------------------------------------------------------------- what the timeline collects
const placements = [];
const sfx = [];
const map = [];
const camera = [{ t: 0, u: 800, v: 450, z: 1 }];
const card = [{ t: 0, s: 0.9, dx: 0, dy: 60, o: 0 }];
const rings = [];
const pills = [];
const heroes = [];
const panels = [];
const chapters = [];
const bgMood = [{ t: 0, hue: 0 }];
const sent = {};
const scenes = {};

const sound = (t, name, gain = 0.3, pan = 0) => sfx.push({ t: Math.max(0, t), name, gain, pan });
/** Where the camera is at time t, from the keys given so far. */
function camAt(t) {
  const keys = [...camera].sort((a, b) => a.t - b.t);
  if (t <= keys[0].t) return keys[0];
  const last = keys[keys.length - 1];
  if (t >= last.t) return last;
  let i = 0;
  while (keys[i + 1].t <= t) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const x = (t - a.t) / (b.t - a.t);
  const k = b.e === "lin" ? x : x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
  return { u: a.u + (b.u - a.u) * k, v: a.v + (b.v - a.v) * k, z: a.z + (b.z - a.z) * k };
}
/** The camera stays where it is until t0, then moves to (u, v, zoom) by t1. */
function camTo(t0, t1, u, v, z, e = "inOut") {
  const p = camAt(t0);
  camera.push({ t: t0, u: p.u, v: p.v, z: p.z, e: "lin" });
  camera.push({ t: t1, u, v, z, e });
}
const pose = (t, p, e = "out5") => card.push({ t, e, s: 1, dx: 0, dy: 0, o: 1, r: 0, ...p });
const seg = (o0, o1, s0, s1, extra = {}) => {
  if (o1 < o0 - 1e-6) throw new Error(`segment runs backwards: ${o0} -> ${o1}`);
  map.push({ o0, o1: Math.max(o0, o1), s0, s1, ...extra });
};
const hold = (o0, o1, s, extra = {}) => seg(o0, o1, s, s, extra);
const play = (o0, s0, s1, speed = 1, extra = {}) => {
  const o1 = o0 + (s1 - s0) / 1000 / speed;
  seg(o0, o1, s0, s1, extra);
  return o1;
};
/** Output time at which the source plays time `src` (ms), if it is played in a segment. */
const outOf = (src) => {
  for (const s of map)
    if (s.s1 > s.s0 && src >= s.s0 && src <= s.s1)
      return s.o0 + ((src - s.s0) / (s.s1 - s.s0)) * (s.o1 - s.o0);
  return null;
};
const ring = (t0, t1, rect, c, label, pos, pad) =>
  rings.push({ t0, t1, ...box(rect), c, label, pos, pad });
const pill = (p) => pills.push({ tone: "light", space: "screen", ...p });

/** Puts the sentences of a scene one after the other from time t; returns when the last one ends. */
function say(sceneId, t) {
  let at = t;
  let end = t;
  for (const s of nar.sentences.filter((x) => x.scene === sceneId)) {
    sent[s.id] = {
      id: s.id,
      t0: at,
      t1: at + s.duration,
      text: s.text,
      words: s.words.map((w) => ({ w: w.w, t0: at + w.start, t1: at + w.end })),
    };
    placements.push({ file: s.file, t: at, id: s.id });
    end = at + s.duration;
    at = end + GAP;
  }
  return end;
}
const squash = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
/** When the word starting with `query` is said in sentence `id`. */
function wordAt(id, query, edge = "t0") {
  const s = sent[id];
  if (!s) throw new Error(`no sentence ${id}`);
  const w = s.words.find((x) => squash(x.w).startsWith(squash(query)));
  if (!w) throw new Error(`no word "${query}" in ${id}: ${s.text}`);
  return w[edge];
}

/**
 * One dictated step: the text lands in the box (held for `hold` seconds, so that it can be read), Lucid sends it, the
 * model works, the result appears. When the model took longer than the story has room for, its working time is shown
 * for a moment and then cut with a dissolve ("shortened"). `doneAt` is when the result should be visible.
 */
function dictStep(id, { oPaste, holdFor, doneAt = null, maxWork = 6 }) {
  const pasted = ms(`${id}.pasted`, 60);
  const sentAt = ms(`${id}.sent`);
  const done = ms(`${id}.done`);
  const oSend = oPaste + holdFor;
  seg(oPaste, oSend, pasted, pasted, { x: 0.22 });
  const oWorking = oSend + 0.75;
  seg(oSend, oWorking, pasted, sentAt + 300);
  const realWork = (done - (sentAt + 300)) / 1000;
  const budget = doneAt === null ? maxWork : Math.max(0.5, doneAt - oWorking);
  let oDone;
  let oEnd;
  let shortened = false;
  if (realWork <= budget) {
    oDone = oWorking + realWork;
    oEnd = oDone + 0.55;
    seg(oWorking, oEnd, sentAt + 300, done + 550);
  } else {
    shortened = true;
    const keep = Math.max(0.4, budget - 0.28);
    seg(oWorking, oWorking + keep, sentAt + 300, sentAt + 300 + keep * 1000);
    seg(oWorking + keep, oWorking + keep + 0.8, done - 200, done + 550, { x: 0.28 });
    oDone = oWorking + keep + 0.28;
    oEnd = oWorking + keep + 0.8;
  }
  return {
    id,
    oPaste,
    oSend,
    oWorking,
    oDone,
    oEnd,
    shortened,
    real: (done - sentAt) / 1000,
    after: done + 550,
  };
}

/** The real "Structuring your notes" wait, labelled when it was cut. */
function shortenedNote(step, bar) {
  if (!step.shortened) return;
  pill({
    t0: step.oWorking + 0.1,
    t1: step.oDone + 0.6,
    space: "card",
    x: bar.x + bar.w,
    y: bar.y - 40,
    anchor: "r",
    small: true,
    c: "var(--amber)",
    dot: true,
    text: `Model time: ${Math.round(step.real)} s`,
    sub: "shortened",
  });
}

// ================================================================ the story
const bar0 = rects("page.ready").bar;
let clock = 0;

// ---------------------------------------------------------------- hook: the title card
{
  const t0 = 0;
  const end = say("hook", t0 + 1.1);
  const lucid = wordAt("hook-2", "Lucid");
  const hero = {
    t0,
    t1: end + 0.55,
    fadeIn: 0.5,
    fadeOut: 0.75,
    markAt: 0.25,
    wordAt: lucid - 0.08 - t0,
    taglineAt: lucid + 0.85 - t0,
    tagline2At: lucid + 1.65 - t0,
    word: "Lucid",
    tagline: "A structured document, built while you think.",
    tagline2: "Voice or keyboard. Runs on your own Mac.",
    // A waveform of the voice under the mark, until the name is said and the letters take its place.
    wave: { t0: 0.7, t1: lucid - 0.12, top: 455 },
  };
  heroes.push(hero);
  sound(0.25, "whoosh_short", 0.22);
  sound(lucid - 0.08, "pop", 0.34);
  sound(lucid + 0.85, "pop_low", 0.2);
  scenes.hook = { t0, t1: end + 0.4 };
  clock = end + 0.4;
}

// ---------------------------------------------------------------- speak: say it, or type it
let step1;
{
  const t0 = clock;
  const nEnd = say("speak", t0 + 2.2);
  pose(t0 - 0.1, { s: 0.88, dy: 80, o: 0, e: "lin" });
  pose(t0 + 1.0, { s: 1, dy: 0, o: 1, e: "out5" });
  sound(t0 - 0.05, "whoosh", 0.34);

  // The empty window, then the real click on "New page" and the title being typed.
  hold(0, t0 + 1.0, ms("launch.idle"));
  const clickFrom = ms("click.newpage", -1000);
  const typedTo = ms("title.typed", 350);
  const oPlay = t0 + 1.0;
  const oTyped = play(oPlay, clickFrom, typedTo);
  const oClick = outOf(ms("click.newpage"));
  if (oClick !== null) sound(oClick, "click", 0.4);
  const typing = [ms("title.typing"), ms("title.typed")];
  const chars = dict.title.length;
  for (let i = 0; i < chars; i++) {
    const o = outOf(typing[0] + ((typing[1] - typing[0]) * (i + 0.5)) / chars);
    if (o !== null) sound(o, ["tick", "tick2", "tick3"][i % 3], 0.16 + 0.05 * ((i * 7) % 3));
  }
  chapters.push({
    t0: t0 + 0.8,
    t1: 0,
    n: 1,
    text: script.scenes.find((s) => s.id === "speak").chapter,
  });

  // The dictated words land in the input box (as a paste does), then the model works.
  const oPaste = Math.max(oTyped + 0.05, sent["speak-2"].t0 - 0.2);
  step1 = dictStep("d1", { oPaste, holdFor: 1.7, maxWork: 5.4 });
  sound(oPaste, "thock", 0.4);
  sound(step1.oSend, "pop_low", 0.2);

  camTo(oPaste - 0.9, oPaste - 0.1, 738, 690, 1.3);
  pill({
    t0: oPaste + 0.05,
    t1: step1.oDone + 0.3,
    space: "card",
    x: bar0.x + bar0.w / 2,
    y: bar0.y - 215,
    tone: "dark",
    text: "Pasted into the box by a dictation app",
  });
  const apps = [
    ["Wispr", "Wispr Flow", "var(--coral)", -250],
    ["OpenWhispr", "OpenWhispr", "var(--indigo)", 0],
    ["VoiceNative", "VoiceNative", "var(--teal)", 250],
  ];
  for (const [query, label, c, dx] of apps) {
    const at = wordAt("speak-2", query) - 0.05;
    pill({
      t0: at,
      t1: step1.oDone + 0.3,
      space: "card",
      x: bar0.x + bar0.w / 2 + dx,
      y: bar0.y - 150,
      c,
      dot: true,
      text: label,
    });
    sound(at + 0.02, "pop", 0.26, dx / 500);
  }
  sound(step1.oDone, "chime", 0.3);
  bgMood.push({ t: t0 + 1, hue: 0 });
  scenes.speak = { t0, t1: step1.oDone - 0.3 };
  clock = step1.oDone - 0.3;
}

// ---------------------------------------------------------------- structure: heading, list, table
let step2;
{
  const t0 = clock;
  const nEnd = say("structure", step1.oDone + 0.1);
  const r1 = rects("d1.settled");
  const heading = r1.headings[0];
  const list = union(r1.bullets);
  // after d1: the blocks are there; the page stays still
  camTo(step1.oDone, step1.oDone + 1.3, 700, 250, 1.28);
  const oHeading = wordAt("structure-1", "heading") - 0.15;
  const oList = wordAt("structure-1", "list") - 0.15;
  const oLocal = wordAt("structure-1", "own") - 0.1;
  ring(oLocal, oLocal + 2.2, r1.model, "var(--teal)", "Local model", "below", 7);
  ring(oHeading, sent["structure-2"].t0 - 0.2, heading, "var(--indigo)", "Heading", "east");
  ring(oList, sent["structure-2"].t0 - 0.2, list, "var(--coral)", "List", "east");

  // The comparison: the words land, the table appears as it is said.
  const oPaste = sent["structure-2"].t0 - 0.5;
  camTo(oPaste - 1.0, oPaste - 0.1, 800, 500, 1.2);
  step2 = dictStep("d2", { oPaste, holdFor: 0.9, doneAt: wordAt("structure-2", "table") - 0.05 });
  shortenedNote(step2, bar0);
  const table = rects("d2.settled").tables[0];
  ring(step2.oDone + 0.2, step2.oDone + 4.5, table, "var(--teal)", "Table", "right");
  camTo(step2.oDone + 0.1, step2.oDone + 1.2, 800, 440, 1.28);
  sound(oPaste, "thock", 0.34);
  sound(step2.oSend, "pop_low", 0.18);
  sound(step2.oDone, "chime", 0.3);
  chapters.push({
    t0: step1.oDone,
    t1: 0,
    n: 2,
    text: script.scenes.find((s) => s.id === "structure").chapter,
  });
  bgMood.push({ t: t0 + 1, hue: 10 });
  const end = Math.max(step2.oDone + 2.3, nEnd + 0.9);
  scenes.structure = { t0, t1: end };
  clock = end;
}

// ---------------------------------------------------------------- diagram, from words
let step3;
{
  const t0 = clock;
  say("diagram", t0 + 1.25);
  const oPaste = t0 + 0.25;
  const doneAt = wordAt("diagram-1", "draws") + 0.05;
  step3 = dictStep("d3", { oPaste, holdFor: 0.9, doneAt });
  shortenedNote(step3, bar0);
  // The real scroll down to the new diagram.
  const settled = ms("d3.settled");
  const o1 = play(step3.oEnd, step3.after, ms("d3.done", 1200), 2.0);
  const o2 = play(o1, ms("d3.done", 1200), settled);
  const r3 = rects("d3.settled");
  const diagram = r3.diagrams[0];
  const node = (re) => r3.nodes.find((n) => re.test(n.label));
  const lb = node(/load balancer/i);
  const db = node(/database|db/i);
  camTo(oPaste - 0.5, oPaste + 0.3, 800, 500, 1.2);
  camTo(o1, o1 + 1.2, diagram.x + diagram.w / 2, diagram.y + diagram.h / 2, 1.1);
  if (lb) ring(o2 + 0.1, o2 + 3.2, lb, "var(--indigo)", "Load balancer: hexagon", "right", 8);
  if (db) ring(o2 + 0.8, o2 + 3.2, db, "var(--coral)", "Database: cylinder", "right", 8);
  chapters.push({
    t0: t0 + 0.3,
    t1: 0,
    n: 3,
    text: script.scenes.find((s) => s.id === "diagram").chapter,
  });
  sound(oPaste, "thock", 0.34);
  sound(step3.oSend, "pop_low", 0.18);
  sound(step3.oDone, "chime", 0.3);
  bgMood.push({ t: t0 + 1, hue: -12 });
  const end = o2 + 3.3;
  scenes.diagram = { t0, t1: end };
  clock = end;
}

// ---------------------------------------------------------------- command mode
let step4;
{
  const t0 = clock;
  const nEnd = say("command", t0 + 0.15);
  // Command mode is switched on (Cmd+2), then the words land.
  const oMode = Math.max(t0 + 0.05, wordAt("command-1", "Command") - 0.35);
  const modeFrom = ms("d4.mode", -700);
  const pastedAt = ms("d4.pasted", 60);
  hold(Math.max(clock, t0), oMode, ms("d3.settled"));
  const oAfterMode = play(oMode, modeFrom, pastedAt);
  step4 = dictStep("d4", {
    oPaste: oAfterMode,
    holdFor: 0.85,
    doneAt: wordAt("command-2", "changes") + 0.1,
  });
  shortenedNote(step4, bar0);
  const o1 = play(step4.oEnd, step4.after, ms("d4.done", 1200), 2.0);
  const o2 = play(o1, ms("d4.done", 1200), ms("d4.settled"));
  const r4 = rects("d4.settled");
  const cache = r4.nodes.find((n) => /cache/i.test(n.label));
  camTo(t0, t0 + 1.0, 800, 500, 1.12);
  camTo(step4.oDone, step4.oDone + 1.2, 800, 520, 1.1);
  if (cache) ring(o2 + 0.1, o2 + 3.5, cache, "var(--indigo)", "New: the cache", "right", 8);
  const undoRect = r4.undo ?? r4.status;
  if (undoRect)
    ring(
      wordAt("command-2", "undo") - 0.1,
      o2 + 3.5,
      undoRect,
      "var(--coral)",
      "One undo step",
      "east",
      8,
    );
  chapters.push({
    t0: t0 + 0.2,
    t1: 0,
    n: 4,
    text: script.scenes.find((s) => s.id === "command").chapter,
  });
  sound(oMode + 0.3, "click", 0.28);
  sound(oAfterMode, "thock", 0.34);
  sound(step4.oSend, "pop_low", 0.18);
  sound(step4.oDone, "chime", 0.3);
  bgMood.push({ t: t0 + 1, hue: 14 });
  const end = Math.max(o2 + 3.6, nEnd + 1.2);
  scenes.command = { t0, t1: end };
  clock = end;
}

// ---------------------------------------------------------------- pdf
let pdfEnd;
{
  const t0 = clock;
  const nEnd = say("pdf", t0 + 0.35);
  const oClickWord = wordAt("pdf-1", "click");
  const clickAt = ms("click.pdf");
  const startSrc = ms("history.shown", 800);
  const savedSrc = ms("pdf.saved", 800);
  // Play the real scroll to the top, the mouse to the button, the click and "Making PDF..." at 1.15x so the click is near its word.
  const lead = (clickAt - startSrc) / 1000 / 1.15;
  const oStart = Math.max(t0, oClickWord - lead);
  hold(t0, oStart, ms("d4.settled"));
  const oEnd = play(oStart, startSrc, savedSrc, 1.0);
  const oClick = outOf(clickAt);
  if (oClick !== null) sound(oClick, "click", 0.42);
  chapters.push({
    t0: t0 + 0.2,
    t1: 0,
    n: 5,
    text: script.scenes.find((s) => s.id === "pdf").chapter,
  });
  const rP = rects("pdf.saved");
  camTo(t0, t0 + 1.0, 800, 450, 1.0);
  camTo(oStart + 0.1, oStart + 1.0, 1000, 230, 1.15);
  camTo(oEnd - 0.9, oEnd - 0.1, 800, 450, 1.0);
  // The paper comes in; the window steps aside.
  const oPaper = oEnd + 0.1;
  pose(oPaper, { s: 1, dx: 0, dy: 0 }, "lin");
  pose(oPaper + 0.95, { s: 0.7, dx: -420, dy: 40, o: 1, r: -0.6 }, "out5");
  panels.push({
    kind: "paper",
    src: "/capture/pdf-page-1.png",
    keys: [
      { t: oPaper - 0.05, x: 2250, y: 640, s: 0.92, r: 7, o: 0 },
      { t: oPaper + 0.1, x: 2250, y: 640, s: 0.92, r: 7, o: 1, e: "lin" },
      { t: oPaper + 1.05, x: 1440, y: 500, s: 0.95, r: 1.4, o: 1, e: "out5" },
      { t: oPaper + 4.0, x: 1440, y: 492, s: 0.97, r: 1.0, o: 1, e: "inOut" },
    ],
  });
  pill({
    t0: oPaper + 0.9,
    t1: oPaper + 4.2,
    x: 1440,
    y: 72,
    tone: "dark",
    small: true,
    text: "A real page of the PDF",
  });
  pill({
    t0: oPaper + 1.5,
    t1: oPaper + 4.2,
    x: 1440,
    y: 930,
    small: true,
    c: "var(--teal)",
    dot: true,
    text: "Typeset on this Mac",
    sub: "Tectonic",
  });
  sound(oPaper, "whoosh", 0.34, 0.4);
  sound(outOf(ms("pdf.saved")) ?? oEnd, "chime", 0.3);
  bgMood.push({ t: t0 + 1, hue: -6 });
  pdfEnd = Math.max(nEnd + 1.1, oPaper + 4.0);
  scenes.pdf = { t0, t1: pdfEnd };
  clock = pdfEnd;
  void rP;
}

// ---------------------------------------------------------------- formats
let formatsEnd;
{
  const t0 = clock;
  const nEnd = say("formats", t0 + 0.55);
  const fmt = mark("fmt.list");
  const formats = fmt.formats; // Blank, Concept, System design, Comparison, Inference, Benchmark
  const dlg = fmt.dialog;
  // The paper leaves, the window comes back to the middle.
  const oBack = t0 + 0.05;
  pose(oBack, { s: 0.7, dx: -420, dy: 40, o: 1, r: -0.6 }, "lin");
  pose(oBack + 0.9, { s: 1, dx: 0, dy: 0, o: 1, r: 0 }, "out5");
  panels
    .find((p) => p.kind === "paper")
    .keys.push(
      { t: oBack, x: 1440, y: 492, s: 0.97, r: 1.0, o: 1, e: "lin" },
      { t: oBack + 0.8, x: 2300, y: 620, s: 0.9, r: 6, o: 0, e: "in" },
    );
  sound(oBack, "whoosh_back", 0.3, 0.3);

  // Real: the cursor goes to "New from a format...", the dialog opens, the words are typed.
  const from = ms("click.format", -1000);
  const typedTo = ms("fmt.typed", 350);
  hold(t0, oBack + 0.3, ms("click.format", -1100));
  const oTyped = play(oBack + 0.3, from, typedTo, 1.0, { x: 0.3 });
  const oClick = outOf(ms("click.format"));
  if (oClick !== null) sound(oClick, "click", 0.4);
  const tt = [ms("fmt.open", 400), ms("fmt.typed")];
  const n = dict.formatAbout.length;
  for (let i = 0; i < n; i++) {
    const o = outOf(tt[0] + ((tt[1] - tt[0]) * (i + 0.5)) / n);
    if (o !== null) sound(o, ["tick", "tick2", "tick3"][i % 3], 0.12 + 0.04 * ((i * 5) % 3));
  }
  // Enter: the quick suggestion shows at once; the model's answer comes a few seconds later (cut).
  const asked = ms("fmt.asked");
  const oAsked = play(oTyped, typedTo, asked + 900);
  const suggested = ms("fmt.suggested", 350);
  const oSuggested = play(oAsked, suggested, ms("fmt.list", 350), 1.0, { x: 0.28 });
  camTo(oBack + 0.5, oBack + 1.6, 760, 380, 1.18);
  chapters.push({
    t0: t0 + 0.3,
    t1: 0,
    n: 6,
    text: script.scenes.find((s) => s.id === "formats").chapter,
  });

  const concept = formats[1];
  const sysd = formats[2];
  const oConcept = wordAt("formats-1", "concept") - 0.1;
  const oSystem = wordAt("formats-1", "system") - 0.1;
  // the dialog is open by now
  ring(
    Math.max(oConcept, oTyped - 1.2),
    sent["formats-2"].t0 - 0.2,
    concept,
    "var(--teal)",
    "Concept note",
    "below",
  );
  ring(
    Math.max(oSystem, oTyped - 0.9),
    sent["formats-2"].t0 - 0.2,
    sysd,
    "var(--indigo)",
    "System design note",
    "below",
  );

  // The mouse walks over the formats, then "Create page" gives the page its sections.
  const hoverFrom = ms("fmt.list", 350);
  const createClick = ms("click.create");
  const createdAt = ms("fmt.created", 500);
  const oHover = play(oSuggested, hoverFrom, createClick + 400, 1.6);
  const oCreated = play(oHover, createClick + 400, createdAt, 1.0, { x: 0.3 });
  const oClickCreate = outOf(createClick);
  if (oClickCreate !== null) sound(oClickCreate, "click", 0.4);

  // "plain data": the card with one real format entry slides in while that is said, and the window steps left. When the
  // sentence is over the card leaves, the window comes back and the page is made: its sections are what a format gives.
  const oData = wordAt("formats-2", "plain") - 0.4;
  const oDataOut = sent["formats-2"].t1 + 0.35;
  pose(oData, { s: 1, dx: 0, dy: 0 }, "lin");
  pose(oData + 0.95, { s: 0.7, dx: -440, dy: 30, o: 1, r: -0.5 }, "out5");
  pose(oDataOut, { s: 0.7, dx: -440, dy: 30, o: 1, r: -0.5 }, "lin");
  pose(oDataOut + 0.9, { s: 1, dx: 0, dy: 0, o: 1, r: 0 }, "out5");
  camTo(oData - 0.1, oData + 0.9, 800, 450, 1.0);
  camTo(
    Math.max(oDataOut + 0.5, oCreated - 0.9),
    Math.max(oDataOut + 1.4, oCreated - 0.1),
    700,
    380,
    1.2,
  );
  const lines = [
    { html: `<span class="k">{</span>`, t: 0 },
    { html: `  <span class="k">id:</span> <span class="s">"benchmark"</span>,`, t: 0.2 },
    { html: `  <span class="k">name:</span> <span class="s">"Benchmark note"</span>,`, t: 0.4 },
    {
      html: `  <span class="k">description:</span> <span class="s">"Recording an experiment or benchmark…"</span>,`,
      t: 0.6,
    },
    { html: `  <span class="k">sections:</span> [`, t: 0.8 },
    {
      html: `    { <span class="k">heading:</span> <span class="s">"Goal and hypothesis"</span>, <span class="k">prefer:</span> [<span class="s">"paragraph"</span>] },`,
      t: 1.0,
    },
    {
      html: `    { <span class="k">heading:</span> <span class="s">"Setup"</span>, <span class="k">prefer:</span> [<span class="s">"table"</span>] },`,
      t: 1.2,
    },
    {
      html: `    { <span class="k">heading:</span> <span class="s">"Results"</span>, <span class="k">prefer:</span> [<span class="s">"table"</span>, <span class="s">"chart"</span>] },`,
      t: 1.4,
    },
    { html: `    …`, t: 1.6 },
    { html: `  ],`, t: 1.7 },
    { html: `},`, t: 1.8 },
    {
      html: `<span class="k">{ id:</span> <span class="s">"lab-notebook"</span><span class="k">,</span> …<span class="k"> }</span>   <span class="n">← one more entry</span>`,
      t: wordAt("formats-2", "lab") - oData - 0.2,
      ghost: true,
    },
  ];
  for (const l of lines) l.t += oData + 0.3;
  panels.push({
    kind: "data",
    file: "packages/kit/src/formats/index.ts",
    lines,
    keys: [
      { t: oData, x: 2400, y: 500, s: 0.95, r: 5, o: 0 },
      { t: oData + 0.05, x: 2400, y: 500, s: 0.95, r: 5, o: 1, e: "lin" },
      { t: oData + 1.0, x: 1400, y: 470, s: 0.94, r: 0.8, o: 1, e: "out5" },
      { t: oDataOut, x: 1400, y: 470, s: 0.94, r: 0.8, o: 1, e: "lin" },
      { t: oDataOut + 0.7, x: 2400, y: 500, s: 0.95, r: 5, o: 0, e: "in" },
    ],
  });
  sound(oData, "whoosh", 0.32, 0.4);
  sound(oDataOut, "whoosh_back", 0.28, 0.3);
  sound(wordAt("formats-2", "lab") - 0.1, "pop", 0.26, 0.4);
  bgMood.push({ t: t0 + 1, hue: 22 });
  formatsEnd = Math.max(nEnd + 1.4, oCreated + 1.2);
  scenes.formats = { t0, t1: formatsEnd };
  clock = formatsEnd;
}

// ---------------------------------------------------------------- agents, through MCP
let agentsEnd;
{
  const t0 = clock;
  const nEnd = say("agents", t0 + 0.55);
  // The window goes right and shows the page before and after the agent; the terminal takes the left.
  pose(t0, { s: 1, dx: 0, dy: 0, o: 1, r: 0 }, "lin");
  pose(t0 + 1.0, { s: 0.8, dx: 300, dy: 20, o: 1, r: 0 }, "out5");
  sound(t0, "whoosh", 0.3, 0.2);

  // The mouse goes back to the first page in the sidebar (real), then the agent works on it.
  const oBackClick = play(t0 + 0.1, ms("click.back", -1000), ms("page.back", 300), 1.4);
  const beginSrc = ms("mcp.begin", -150);
  const oListDocs = wordAt("agents-1", "agent") - 0.2;
  const oOutline = wordAt("agents-1", "read") - 0.2;
  const oInsert = wordAt("agents-1", "add", "t0") - 0.1;
  const clickBack = outOf(ms("click.back"));
  if (clickBack !== null) sound(clickBack, "click", 0.38);
  const insertCall = ms("mcp.insert_notes.call");
  // First the page as it was, then the real insert.
  hold(oBackClick, oInsert, beginSrc);
  const oShown = play(oInsert, insertCall - 100, ms("mcp.shown", 400));
  const hist = rects("mcp.shown").historyItems[0];
  ring(
    wordAt("agents-2", "history") - 0.3,
    oShown + 3.0,
    hist,
    "var(--coral)",
    "From the agent",
    "below",
    6,
  );
  camTo(t0, t0 + 1.0, 800, 450, 1.0);

  // the terminal: the real calls, typed as they happen
  const calls = cap.mcp;
  const short = (s, n = 58) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  const lines = [];
  const firstLine = (text, n = 60) => short(text.split("\n")[0], n);
  const at = { list_documents: oListDocs, get_outline: oOutline, insert_notes: oInsert };
  for (const c of calls) {
    const t = at[c.name];
    const args =
      c.name === "insert_notes" ? ` lmd: "${short(c.args.lmd.replace(/\n/g, "\\n"), 40)}"` : "";
    lines.push({ kind: "cmd", t, text: `${c.name}${args}`, cps: 70 });
    const out = c.result.split("\n").filter((l) => l.trim().length > 0);
    if (c.name === "list_documents") {
      lines.push({
        kind: "out",
        t: t + 0.5,
        text: short(out[0].replace(/^[0-9a-f-]{36}\s+\S+\s+/, "page  "), 60),
        cps: 80,
      });
    } else if (c.name === "get_outline") {
      const show = out.slice(0, 6).map((l) => short(l, 62));
      show.forEach((l, i) =>
        lines.push({ kind: "out", t: t + 0.55 + i * 0.16, text: l, cps: 120 }),
      );
      lines.push({ kind: "out", t: t + 0.55 + show.length * 0.16, text: "…", cps: 10 });
    } else {
      lines.push({
        kind: "out",
        t: t + 0.6,
        text: short(out[0].replace(/ New revision.*$/, ""), 62),
        cps: 80,
      });
    }
    lines.push({ kind: "gap", t });
  }
  panels.push({
    kind: "term",
    title: "an MCP client calling Lucid",
    lines,
    keys: [
      { t: t0 + 0.1, x: -420, y: 500, s: 0.95, r: -2, o: 0 },
      { t: t0 + 0.15, x: -420, y: 500, s: 0.95, r: -2, o: 1, e: "lin" },
      { t: t0 + 1.1, x: 395, y: 500, s: 0.93, r: -0.4, o: 1, e: "out5" },
    ],
  });
  for (const l of lines) {
    if (l.kind !== "cmd" && l.kind !== "out") continue;
    const nChars = Math.min(l.text.length, 60);
    for (let i = 0; i < nChars; i += 4)
      sound(l.t + i / (l.cps ?? 60), "tick", 0.07 + 0.03 * ((i / 4) % 3), -0.5);
  }
  sound(outOf(insertCall) ?? oInsert, "pop", 0.26, -0.3);
  sound(oInsert + 0.5, "chime", 0.3);
  chapters.push({
    t0: t0 + 0.3,
    t1: 0,
    n: 7,
    text: script.scenes.find((s) => s.id === "agents").chapter,
  });
  bgMood.push({ t: t0 + 1, hue: -18 });
  agentsEnd = Math.max(nEnd + 1.5, oShown + 3.2);
  scenes.agents = { t0, t1: agentsEnd };
  clock = agentsEnd;
}

// ---------------------------------------------------------------- outro
let total;
{
  const t0 = clock;
  const nEnd = say("outro", t0 + 0.7);
  pose(t0, { s: 0.8, dx: 300, dy: 20, o: 1, r: 0 }, "lin");
  pose(t0 + 0.9, { s: 0.66, dx: 300, dy: 70, o: 0, r: 0 }, "in");
  panels
    .find((p) => p.kind === "term")
    .keys.push(
      { t: t0, x: 395, y: 500, s: 0.93, r: -0.4, o: 1, e: "lin" },
      { t: t0 + 0.8, x: 300, y: 540, s: 0.9, r: -1.5, o: 0, e: "in" },
    );
  const gh = wordAt("outro-2", "GitHub");
  const hero = {
    t0: t0 + 0.5,
    t1: nEnd + 2.4,
    fadeIn: 0.6,
    fadeOut: 0.9,
    markAt: 0.2,
    wordAt: 0.55,
    taglineAt: 1.2,
    tagline2At: 1.85,
    urlAt: gh - (t0 + 0.5) + 0.15,
    word: "Lucid",
    tagline: "Free and open source.",
    tagline2: "Everything runs on your computer.",
    url: "github.com/triggeredcode/lucid",
    markTop: 270,
    wordTop: 422,
    taglineTop: 612,
    tagline2Top: 684,
    urlTop: 770,
  };
  heroes.push(hero);
  sound(t0 + 0.5, "finale", 0.3);
  sound(gh + 0.1, "pop", 0.3);
  bgMood.push({ t: t0 + 1, hue: 0 });
  total = nEnd + 2.4;
  scenes.outro = { t0, t1: total };
  clock = total;
}

// ================================================================ the timeline
const byT = (a, b) => a.t - b.t;
camera.sort(byT);
card.sort(byT);
bgMood.sort(byT);
for (const p of panels) p.keys.sort(byT);
map.sort((a, b) => a.o0 - b.o0);
for (let i = 1; i < map.length; i++) {
  if (map[i].o0 < map[i - 1].o0 - 1e-6) throw new Error("source map is out of order");
}
// Chapter labels last until the next one starts (or the outro).
chapters.sort((a, b) => a.t0 - b.t0);
const ACCENTS = [
  "var(--coral)",
  "var(--indigo)",
  "var(--teal)",
  "var(--amber)",
  "var(--rose)",
  "var(--indigo)",
  "var(--coral)",
];
chapters.forEach((c, i) => {
  c.c = ACCENTS[i % ACCENTS.length];
  c.t1 = (chapters[i + 1]?.t0 ?? scenes.agents.t1) - 0.05;
});
// A pill or ring that was given no end lasts to the end of its scene; none are open-ended here.

/** The captured picture shown at a source time (ms). */
const frameAt = (t) => {
  let best = cap.frames[0];
  for (const f of cap.frames) if (f.t <= t) best = f;
  return best.file;
};
const captions = Object.values(sent).map((s) => ({ t0: s.t0, t1: s.t1, words: s.words }));

// The loudness of the narration, 30 values a second, for the waveform on the title card.
const voiceEnv = new Array(Math.ceil((total + 1) * FPS)).fill(0);
for (const cue of placements) {
  const wav = readWav(join(HERE, ".cache", "narration", cue.file));
  const step = Math.round(48000 / FPS);
  for (let i = 0; i + step <= wav.length; i += step) {
    let sum = 0;
    for (let k = i; k < i + step; k++) sum += wav[k] * wav[k];
    const at = Math.round(cue.t * FPS) + i / step;
    if (at < voiceEnv.length) voiceEnv[at] = Math.min(1, Math.sqrt(sum / step) / 0.085);
  }
}

const timeline = {
  voice: { fps: FPS, env: voiceEnv.map((x) => Math.round(x * 1000) / 1000) },
  fps: FPS,
  width: 1920,
  height: 1080,
  duration: Math.ceil(total * FPS) / FPS,
  chrome: { titleBar: TB, ...(TB === 0 ? { lights: cap.lights ?? { x: 20, y: 18 } } : {}) },
  captionBottom: 34,
  source: { base: "/capture/", frames: cap.frames, viewport: cap.viewport },
  map,
  camera,
  card,
  bgMood,
  rings,
  cursor: cap.cursor,
  clicks: cap.marks
    .filter((m) => m.name.startsWith("click"))
    .map((m) => ({ t: m.t, x: m.x, y: m.y })),
  pills,
  captions,
  chapters,
  heroes,
  panels,
  audio: { narration: placements, sfx, padGain: 0.05 },
  scenes,
  // The 1280 x 640 poster: a real frame of the page with its table and diagram, after the agent has not yet touched it.
  poster: {
    title: "Lucid",
    tagline: "Voice to structured notes, tables and diagrams.",
    chips: [
      ["Speak or type", "var(--coral)"],
      ["Local model", "var(--indigo)"],
      ["PDF and MCP", "var(--teal)"],
    ],
    x: 566,
    y: 92,
    scale: 0.66,
    file: frameAt(ms("page.back", 250)),
  },
};

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "timeline.json"), JSON.stringify(timeline));
console.log(
  `timeline: ${timeline.duration.toFixed(1)} s, ${map.length} source segments, ${rings.length} rings, ${pills.length} pills, ${sfx.length} sounds`,
);
for (const [id, s] of Object.entries(scenes))
  console.log(`  ${id.padEnd(10)} ${s.t0.toFixed(1).padStart(6)} - ${s.t1.toFixed(1).padStart(6)}`);
