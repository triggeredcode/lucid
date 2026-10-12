// The stage engine. `stage.seek(t)` makes the page look exactly as it should at time t (seconds): the window with the
// captured frame of the real app, the camera, the rings, the cursor, the captions and the title cards. It reads
// everything from /timeline.json (made by plan.mjs). Nothing here depends on a clock, so the render is repeatable.

const W = 1920;
const H = 1080;
/** The window at rest is 1600 x 900 CSS pixels of the app, shown at this scale. */
const S0 = 0.96;
const FOCUS_Y = 500; // where on the screen the camera's focus point sits
const CARD_TOP = 34;

// ---------------------------------------------------------------- easing and sampling
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, p) => a + (b - a) * p;
const E = {
  lin: (t) => t,
  in: (t) => t * t * t,
  out: (t) => 1 - (1 - t) ** 3,
  out5: (t) => 1 - (1 - t) ** 5,
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  smooth: (t) => t * t * (3 - 2 * t),
  back: (t) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
  },
};
const ease = (name, p) => (E[name] ?? E.inOut)(clamp(p));

/** Values of the keyframe list at time t. Each key holds the value at its time; `e` names the easing INTO that key. */
function sample(keys, t) {
  if (keys.length === 0) return {};
  if (t <= keys[0].t) return keys[0];
  const last = keys[keys.length - 1];
  if (t >= last.t) return last;
  let i = 0;
  while (keys[i + 1].t <= t) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const p = ease(b.e ?? "inOut", (t - a.t) / (b.t - a.t));
  const out = {};
  for (const f of Object.keys(b)) {
    if (f === "t" || f === "e") continue;
    out[f] = typeof b[f] === "number" && typeof a[f] === "number" ? lerp(a[f], b[f], p) : b[f];
  }
  return out;
}

/** 0 before t0, then rises to 1 over `dur` seconds. */
const rise = (t, t0, dur, name = "out") => ease(name, (t - t0) / dur);
/** 1 between t0 and t1, with a fade in at the start and a fade out at the end. */
function window01(t, t0, t1, fadeIn = 0.3, fadeOut = 0.3) {
  return Math.min(rise(t, t0, fadeIn, "smooth"), 1 - rise(t, t1 - fadeOut, fadeOut, "smooth"));
}

// ---------------------------------------------------------------- state
let T;
const stage = document.getElementById("stage");
const el = {};
const rings = [];
const pillEls = [];
const captionEls = [];
const heroEls = [];
const panelEls = [];
const chapterEls = [];
let framesT = [];
let TB = 0; // title bar height of the window, CSS px

const h = (tag, cls, parent, styles) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (styles) Object.assign(node.style, styles);
  if (parent) parent.appendChild(node);
  return node;
};

/** The app's own icon (apps/desktop/resources/icon.svg), drawn inline. */
const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect x="96" y="96" width="832" height="832" rx="188" fill="#ffffff" stroke="#191919" stroke-width="48"/><path d="M396 290v444h250" fill="none" stroke="#191919" stroke-width="104" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const CURSOR = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 26 26"><path d="M3 2 L3 20 L8 15.5 L11.6 23 L15 21.5 L11.4 14.2 L18 14 Z" fill="#fff" stroke="#1d1d1b" stroke-width="1.6" stroke-linejoin="round"/></svg>`;

// ---------------------------------------------------------------- building the page
function build() {
  TB = T.chrome?.titleBar ?? 0;
  stage.innerHTML = "";
  el.bg = h("div", "", stage);
  el.bg.id = "bg";

  // The world: the window and what is attached to it. The camera moves and scales this layer.
  el.world = h("div", "layer", stage);
  el.card = h("div", "card", el.world, { width: "1600px", height: `${900 + TB}px` });
  const clip = h("div", "clip", el.card);
  if (TB > 0) {
    const bar = h("div", "titlebar", clip, { height: `${TB}px` });
    const lights = h("div", "lights", bar, { left: "16px", top: `${(TB - 12) / 2}px` });
    for (let i = 0; i < 3; i++) h("i", "", lights);
  }
  el.screen = h("div", "screen", clip, { top: `${TB}px` });
  el.imgA = h("img", "", el.screen);
  el.imgB = h("img", "", el.screen, { opacity: "0" });
  if (TB === 0 && T.chrome?.lights) {
    const lights = h("div", "lights", clip, {
      left: `${T.chrome.lights.x}px`,
      top: `${T.chrome.lights.y}px`,
    });
    for (let i = 0; i < 3; i++) h("i", "", lights);
  }
  el.over = h("div", "over", el.card, { top: `${TB}px` });

  for (const r of T.rings ?? []) {
    const node = h("div", "ring", el.over);
    node.style.setProperty("--c", r.c ?? "var(--indigo)");
    const tag = r.label ? h("div", `tag ${r.pos ?? ""}`, node) : null;
    if (tag) tag.textContent = r.label;
    rings.push({ r, node });
  }
  el.cursor = h("div", "cursor", el.over);
  el.cursor.innerHTML = CURSOR;
  el.ripples = (T.clicks ?? []).map(() => h("div", "ripple", el.over));

  // Screen-space things.
  el.top = h("div", "layer", stage, { width: `${W}px`, height: `${H}px` });
  for (const p of T.pills ?? []) {
    const parent = p.space === "card" ? el.over : el.top;
    const node = h("div", `pill ${p.tone ?? "light"}${p.small ? " small" : ""}`, parent);
    if (p.c) node.style.setProperty("--c", p.c);
    if (p.dot) h("span", "dot", node);
    const text = h("span", "", node);
    text.textContent = p.text;
    if (p.sub) {
      const sub = h("span", "sub", node);
      sub.textContent = p.sub;
    }
    node.style.left = `${p.x}px`;
    node.style.top = `${p.y}px`;
    pillEls.push({ p, node });
  }

  for (const hero of T.heroes ?? []) {
    const root = h("div", "", el.top);
    root.id = "hero";
    root.style.pointerEvents = "none";
    const mark = h("div", "mark", root);
    mark.innerHTML = ICON;
    const word = h("div", "word", root);
    const letters = [...hero.word].map((c) => {
      const s = h("span", "", word);
      s.textContent = c;
      return s;
    });
    let wave = null;
    if (hero.wave) {
      const box = h("div", "wave", root);
      wave = { box, bars: Array.from({ length: 31 }, () => h("i", "", box)) };
    }
    const tagline = h("div", "tagline", root);
    tagline.textContent = hero.tagline ?? "";
    const tagline2 = h("div", "tagline2", root);
    tagline2.textContent = hero.tagline2 ?? "";
    const url = h("div", "url", root);
    if (hero.url) {
      const pill = h("div", "pill dark", url);
      pill.textContent = hero.url;
    }
    heroEls.push({ hero, root, mark, word, letters, tagline, tagline2, url, wave });
  }

  for (const panel of T.panels ?? []) {
    const root = h("div", `panel ${PANEL_CLASS[panel.kind] ?? panel.kind}`, el.top);
    if (panel.kind === "term") buildTerm(panel, root);
    if (panel.kind === "paper") {
      const img = h("img", "", root);
      img.src = panel.src;
      img.decoding = "sync";
    }
    if (panel.kind === "data") buildData(panel, root);
    panelEls.push({ panel, root });
  }

  for (const c of T.captions ?? []) {
    const wrap = h("div", "", el.top);
    wrap.id = "caption";
    wrap.style.bottom = `${T.captionBottom ?? 36}px`;
    const box = h("div", "box", wrap);
    const words = c.words.map((w, i) => {
      const s = h("span", "", box);
      s.textContent = w.w;
      if (i < c.words.length - 1) box.appendChild(document.createTextNode(" "));
      return s;
    });
    captionEls.push({ c, wrap, box, words });
  }

  for (const ch of T.chapters ?? []) {
    const root = h("div", "", el.top);
    root.id = "chapter";
    root.style.setProperty("--c", ch.c ?? "var(--ink)");
    const n = h("span", "n", root);
    n.textContent = String(ch.n).padStart(2, "0");
    const text = h("span", "", root);
    text.textContent = ch.text;
    const bar = h("span", "bar", root);
    const fill = h("i", "", bar);
    chapterEls.push({ ch, root, fill });
  }
  framesT = T.source.frames.map((f) => f.t);
}

function buildTerm(panel, root) {
  const bar = h("div", "bar", root);
  for (let i = 0; i < 3; i++) h("i", "", bar);
  const title = h("b", "", bar);
  title.textContent = panel.title ?? "MCP client";
  const body = h("div", "body", root);
  panel.nodes = panel.lines.map((line) => {
    const node = h("div", line.kind === "gap" ? "gap" : line.kind, body);
    return node;
  });
}

function buildData(panel, root) {
  const file = h("div", "file", root);
  file.textContent = panel.file;
  panel.nodes = panel.lines.map((line) => {
    const node = h("div", line.ghost ? "ghost" : "", root);
    node.innerHTML = line.html;
    return node;
  });
}

// ---------------------------------------------------------------- one frame
function drawBg(t, fx, fy) {
  const P = (x, y, ax, ay, w, ph) => [
    x + ax * Math.sin(t * w + ph),
    y + ay * Math.cos(t * w * 0.83 + ph * 1.7),
  ];
  const blobs = [
    ["255,196,168", ...P(0.12, 0.18, 0.1, 0.1, 0.21, 0.0), 0.95, 980],
    ["198,190,255", ...P(0.88, 0.14, 0.09, 0.12, 0.17, 1.9), 0.95, 1000],
    ["170,218,255", ...P(0.84, 0.88, 0.1, 0.08, 0.19, 3.1), 0.9, 960],
    ["176,232,205", ...P(0.1, 0.9, 0.08, 0.1, 0.23, 4.4), 0.85, 900],
    ["255,200,222", ...P(0.5, 0.52, 0.16, 0.1, 0.13, 2.6), 0.55, 820],
  ];
  const mood = T.bgMood ? sample(T.bgMood, t) : { hue: 0 };
  const layers = blobs.map(([c, x, y, a, r]) => {
    const px = (x * 100).toFixed(2);
    const py = (y * 100).toFixed(2);
    return `radial-gradient(circle ${r}px at ${px}% ${py}%, rgba(${c},${a}) 0%, rgba(${c},0) 100%)`;
  });
  el.bg.style.background = `${layers.join(",")}, linear-gradient(135deg, #f8f4ee 0%, #f3f0fa 100%)`;
  el.bg.style.filter = mood.hue ? `hue-rotate(${mood.hue.toFixed(1)}deg)` : "";
  el.bg.style.transform = `translate(${(-fx * 0.03).toFixed(2)}px, ${(-fy * 0.03).toFixed(2)}px)`;
}

/** The source time for output time t, and the earlier picture to blend from while a cut dissolves. */
function sourceAt(t) {
  const map = T.map;
  let idx = -1;
  for (let i = 0; i < map.length; i++) if (map[i].o0 <= t) idx = i;
  if (idx < 0) return { s: map[0].s0, prev: null, alpha: 1 };
  const seg = map[idx];
  const span = seg.o1 - seg.o0;
  const p = span > 0 ? clamp((t - seg.o0) / span) : 1;
  const s = seg.s0 + (seg.s1 - seg.s0) * p;
  if (seg.x && idx > 0 && t - seg.o0 < seg.x) {
    return { s, prev: map[idx - 1].s1, alpha: ease("smooth", (t - seg.o0) / seg.x) };
  }
  return { s, prev: null, alpha: 1 };
}

function frameFile(ms) {
  let lo = 0;
  let hi = framesT.length - 1;
  let best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (framesT[mid] <= ms) {
      best = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return T.source.frames[best].file;
}

async function setImage(img, file) {
  if (img.dataset.file === file) return;
  img.dataset.file = file;
  img.src = `${T.source.base}${file}`;
  await img.decode();
}

/** How loud the narration is at time t (0 to 1), a little smoothed: it drives the waveform on the title card. */
function voiceAt(t) {
  const v = T.voice;
  if (!v) return 0;
  const i = Math.floor(t * v.fps);
  let sum = 0;
  let n = 0;
  for (let k = i - 2; k <= i + 2; k++) {
    if (k >= 0 && k < v.env.length) {
      sum += v.env[k];
      n++;
    }
  }
  return n > 0 ? sum / n : 0;
}

/** Cursor position (app CSS px) at source time ms, and how visible it is. */
function cursorAt(ms) {
  const track = T.cursor ?? [];
  if (track.length === 0) return { o: 0, u: 0, v: 0 };
  // last sample at or before ms
  let lo = 0;
  let hi = track.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (track[mid].t <= ms) {
      best = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  const next = track[best + 1];
  if (best < 0) {
    // before a movement starts: appear a moment earlier, at its first position
    const first = track[0];
    return { o: ease("smooth", (ms - (first.t - 250)) / 250), u: first.x, v: first.y };
  }
  const here = track[best];
  const idle = ms - here.t;
  let o = 1 - ease("smooth", (idle - 900) / 600);
  let u = here.x;
  let v = here.y;
  if (next && next.t - here.t < 400) {
    // inside a movement
    const p = (ms - here.t) / (next.t - here.t);
    u = lerp(here.x, next.x, p);
    v = lerp(here.y, next.y, p);
    o = 1;
  } else if (next && next.t - ms < 250) {
    // a new movement is about to begin
    o = Math.max(o, 1 - (next.t - ms) / 250);
    u = next.x;
    v = next.y;
    if (next.t - here.t >= 400) {
      u = lerp(here.x, next.x, 1 - (next.t - ms) / 250);
      v = lerp(here.y, next.y, 1 - (next.t - ms) / 250);
    }
  }
  return { o, u, v };
}

function layoutPill(node, p, t) {
  const a = rise(t, p.t0, p.pop ?? 0.38, "back");
  const out = 1 - rise(t, p.t1 - 0.25, 0.25, "smooth");
  const o = Math.min(clamp(a * 1.4), out);
  if (o <= 0.001) {
    node.style.display = "none";
    return;
  }
  node.style.display = "flex";
  const sc = p.space === "card" ? 1 : 1;
  const tx = p.anchor === "l" ? "0%" : p.anchor === "r" ? "-100%" : "-50%";
  node.style.opacity = o.toFixed(3);
  node.style.transform = `translate(${tx}, -50%) scale(${(lerp(0.7, 1, a) * sc).toFixed(4)})`;
}

async function seek(t) {
  // Camera and window.
  const cam = sample(T.camera, t);
  const pose = sample(T.card, t);
  const z = cam.z ?? 1;
  const cw = 1600 * S0;
  const ch = (900 + TB) * S0;
  const cardX0 = (W - cw) / 2;
  const cardY0 = CARD_TOP;
  const fx = cardX0 + (cam.u ?? 800) * S0;
  const fy = cardY0 + (TB + (cam.v ?? 450)) * S0;
  const ax = W / 2;
  const ay = FOCUS_Y;
  el.world.style.transform = `translate(${(ax - z * fx).toFixed(3)}px, ${(ay - z * fy).toFixed(3)}px) scale(${z.toFixed(5)})`;

  const ps = pose.s ?? 1;
  const cx = cardX0 + cw / 2 + (pose.dx ?? 0);
  const cy = cardY0 + ch / 2 + (pose.dy ?? 0);
  el.card.style.transform = `translate(${(cx - (cw * ps) / 2).toFixed(3)}px, ${(cy - (ch * ps) / 2).toFixed(3)}px) rotate(${(pose.r ?? 0).toFixed(3)}deg) scale(${(S0 * ps).toFixed(5)})`;
  const o = pose.o ?? 1;
  el.world.style.opacity = o.toFixed(3);
  el.world.style.display = o <= 0.001 ? "none" : "block";

  drawBg(t, fx - W / 2, fy - FOCUS_Y);

  // The captured frame (with a dissolve while a cut happens).
  const src = sourceAt(t);
  const loads = [setImage(el.imgA, frameFile(src.s))];
  if (src.prev !== null && src.alpha < 1) {
    // A is the new picture underneath; B is the old one on top, fading out.
    loads.push(setImage(el.imgB, frameFile(src.prev)));
    el.imgB.style.opacity = (1 - src.alpha).toFixed(3);
  } else {
    el.imgB.style.opacity = "0";
  }
  await Promise.all(loads);

  // Rings.
  for (const { r, node } of rings) {
    const a = rise(t, r.t0, 0.42, "back");
    const out = 1 - rise(t, r.t1, 0.3, "smooth");
    const op = Math.min(clamp(a * 1.5), out);
    if (op <= 0.001) {
      node.style.display = "none";
      continue;
    }
    const pad = r.pad ?? 9;
    node.style.display = "block";
    node.style.left = `${r.u - pad}px`;
    node.style.top = `${r.v - pad}px`;
    node.style.width = `${r.w + pad * 2}px`;
    node.style.height = `${r.h + pad * 2}px`;
    node.style.opacity = op.toFixed(3);
    const pulse = 1 + 0.006 * Math.sin((t - r.t0) * 3.2);
    node.style.transform = `scale(${(lerp(1.05, 1, a) * pulse).toFixed(4)})`;
    node.style.boxShadow = `0 0 0 ${(4 + 2 * Math.sin((t - r.t0) * 3.2)).toFixed(2)}px color-mix(in srgb, ${r.c ?? "var(--indigo)"} 14%, transparent)`;
  }

  // Cursor and click ripples follow the source time, so they stay with the picture.
  const cur = cursorAt(src.s);
  el.cursor.style.opacity = cur.o.toFixed(3);
  el.cursor.style.transform = `translate(${cur.u.toFixed(2)}px, ${cur.v.toFixed(2)}px)`;
  (T.clicks ?? []).forEach((c, i) => {
    const p = (src.s - c.t) / 520;
    const node = el.ripples[i];
    if (p < 0 || p > 1) {
      node.style.display = "none";
      return;
    }
    node.style.display = "block";
    node.style.left = `${c.x}px`;
    node.style.top = `${c.y}px`;
    node.style.opacity = (1 - E.out(p)).toFixed(3);
    node.style.transform = `scale(${lerp(0.6, 2.6, E.out(p)).toFixed(3)})`;
  });

  // Pills.
  for (const { p, node } of pillEls) layoutPill(node, p, t);

  // Hero cards.
  for (const { hero, root, mark, letters, word, tagline, tagline2, url, wave } of heroEls) {
    const vis = window01(t, hero.t0, hero.t1, hero.fadeIn ?? 0.5, hero.fadeOut ?? 0.5);
    if (vis <= 0.001) {
      root.style.display = "none";
      continue;
    }
    root.style.display = "block";
    root.style.opacity = vis.toFixed(3);
    const m = rise(t, hero.t0 + (hero.markAt ?? 0.1), 0.8, "back");
    mark.style.opacity = clamp(m * 1.6).toFixed(3);
    mark.style.transform = `translateY(${((1 - m) * 24).toFixed(2)}px) scale(${lerp(0.6, 1, m).toFixed(4)})`;
    mark.style.top = `${hero.markTop ?? 300}px`;
    word.style.top = `${hero.wordTop ?? 452}px`;
    letters.forEach((s, i) => {
      const p = rise(t, hero.t0 + (hero.wordAt ?? 0.5) + i * 0.07, 0.7, "out5");
      s.style.opacity = clamp(p * 1.4).toFixed(3);
      s.style.transform = `translateY(${((1 - p) * 38).toFixed(2)}px)`;
    });
    if (wave) {
      const w = window01(t, hero.wave.t0, hero.wave.t1, 0.5, 0.35);
      wave.box.style.opacity = w.toFixed(3);
      wave.box.style.top = `${hero.wave.top}px`;
      const level = Math.min(1, voiceAt(t) ** 0.75 * 1.1);
      wave.bars.forEach((bar, i) => {
        const x = (i - 15) / 15;
        const shape = 0.25 + 0.75 * Math.cos((x * Math.PI) / 2) ** 2;
        const wobble = 0.72 + 0.28 * Math.sin(t * 9.5 + i * 0.83) * Math.sin(t * 4.1 - i * 0.37);
        const height = 8 + 118 * level * shape * wobble;
        bar.style.height = `${height.toFixed(1)}px`;
      });
    }
    const tg = rise(t, hero.t0 + (hero.taglineAt ?? 1.6), 0.8, "out");
    tagline.style.opacity = tg.toFixed(3);
    tagline.style.transform = `translateY(${((1 - tg) * 16).toFixed(2)}px)`;
    tagline.style.top = `${hero.taglineTop ?? 640}px`;
    const t2 = rise(t, hero.t0 + (hero.tagline2At ?? 2.2), 0.8, "out");
    tagline2.style.opacity = t2.toFixed(3);
    tagline2.style.transform = `translateY(${((1 - t2) * 14).toFixed(2)}px)`;
    tagline2.style.top = `${hero.tagline2Top ?? 712}px`;
    const u = rise(t, hero.t0 + (hero.urlAt ?? 2.6), 0.7, "back");
    url.style.opacity = clamp(u * 1.5).toFixed(3);
    url.style.transform = `translateY(${((1 - u) * 18).toFixed(2)}px) scale(${lerp(0.9, 1, u).toFixed(4)})`;
    url.style.top = `${hero.urlTop ?? 790}px`;
  }

  // Panels (terminal, paper, data card).
  for (const { panel, root } of panelEls) {
    const k = sample(panel.keys, t);
    const op = k.o ?? 0;
    if (op <= 0.001) {
      root.style.display = "none";
      continue;
    }
    root.style.display = "block";
    root.style.opacity = op.toFixed(3);
    const w = parseFloat(getComputedStyle(root).width);
    const hgt = parseFloat(getComputedStyle(root).height);
    root.style.transform = `translate(${((k.x ?? 0) - w / 2).toFixed(2)}px, ${((k.y ?? 0) - hgt / 2).toFixed(2)}px) rotate(${(k.r ?? 0).toFixed(3)}deg) scale(${(k.s ?? 1).toFixed(4)})`;
    if (panel.kind === "term") {
      panel.lines.forEach((line, i) => {
        const node = panel.nodes[i];
        if (line.kind === "gap") return;
        const n = Math.floor(clamp((t - line.t) * (line.cps ?? 60), 0, line.text.length + 1));
        if (t < line.t) {
          node.style.display = "none";
          return;
        }
        node.style.display = "block";
        const shown = line.text.slice(0, n);
        if (line.kind === "cmd") {
          const m = /^(\S+)(.*)$/s.exec(shown);
          node.innerHTML = `<span class="p">&#9656; </span><span class="name">${esc(m ? m[1] : "")}</span>${esc(m ? m[2] : "")}`;
        } else node.textContent = shown;
      });
    }
    if (panel.kind === "data") {
      panel.lines.forEach((line, i) => {
        const a = rise(t, line.t ?? 0, 0.4, "out");
        panel.nodes[i].style.opacity = a.toFixed(3);
        panel.nodes[i].style.transform = `translateY(${((1 - a) * 10).toFixed(2)}px)`;
      });
    }
  }

  // Captions.
  for (const { c, wrap, box, words } of captionEls) {
    const a = window01(t, c.t0 - 0.1, c.t1 + 0.12, 0.2, 0.18);
    if (a <= 0.001) {
      wrap.style.display = "none";
      continue;
    }
    wrap.style.display = "flex";
    wrap.style.opacity = a.toFixed(3);
    box.style.transform = `translateY(${((1 - a) * 14).toFixed(2)}px)`;
    box.classList.toggle("light", c.plain === true);
    words.forEach((s, i) => {
      const w = c.words[i];
      const spoken = rise(t, w.t0 - 0.04, 0.16, "smooth");
      s.style.opacity = lerp(0.34, 1, spoken).toFixed(3);
    });
  }

  // Chapter label.
  for (const { ch, root, fill } of chapterEls) {
    const a = window01(t, ch.t0, ch.t1, 0.5, 0.4);
    if (a <= 0.001) {
      root.style.display = "none";
      continue;
    }
    root.style.display = "flex";
    root.style.opacity = a.toFixed(3);
    root.style.transform = `translateX(${((a - 1) * 18).toFixed(2)}px)`;
    fill.style.width = `${(clamp((t - ch.t0) / (ch.t1 - ch.t0)) * 100).toFixed(1)}%`;
  }
}

const PANEL_CLASS = { term: "term", paper: "paper", data: "datacard" };
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * The poster (a 1280 x 640 social-preview image): the same gradient and type as the video, the title and one line about
 * what Lucid does, and a real captured frame of the app bleeding off the right and bottom edges.
 */
async function poster() {
  const P = T.poster;
  stage.innerHTML = "";
  stage.classList.add("poster");
  TB = T.chrome?.titleBar ?? 0;
  el.bg = h("div", "", stage);
  el.bg.id = "bg";
  // a still of the same gradient, at the video's phase of 14 s
  const t = P.phase ?? 14;
  const blobs = [
    ["255,196,168", 0.1, 0.12, 700],
    ["198,190,255", 0.92, 0.1, 720],
    ["170,218,255", 0.88, 0.95, 680],
    ["176,232,205", 0.05, 0.98, 640],
    ["255,200,222", 0.45, 0.5, 520],
  ];
  const layers = blobs.map(([c, x, y, r], i) => {
    const px = ((x + 0.03 * Math.sin(t * 0.2 + i)) * 100).toFixed(2);
    const py = ((y + 0.03 * Math.cos(t * 0.2 + i)) * 100).toFixed(2);
    return `radial-gradient(circle ${r}px at ${px}% ${py}%, rgba(${c},0.95) 0%, rgba(${c},0) 100%)`;
  });
  el.bg.style.background = `${layers.join(",")}, linear-gradient(135deg, #f8f4ee 0%, #f3f0fa 100%)`;

  const left = h("div", "", stage, {
    position: "absolute",
    left: "64px",
    top: "70px",
    width: "520px",
  });
  const mark = h("div", "", left, {
    width: "84px",
    height: "84px",
    filter: "drop-shadow(0 12px 22px rgb(40 30 90 / 26%))",
  });
  mark.innerHTML = ICON;
  h("div", "", left, {
    marginTop: "26px",
    fontWeight: "700",
    fontSize: "112px",
    lineHeight: "1",
    letterSpacing: "-0.02em",
  }).textContent = P.title;
  h("div", "", left, {
    marginTop: "26px",
    fontSize: "31px",
    lineHeight: "1.32",
    color: "#2f2e2b",
  }).textContent = P.tagline;
  const chips = h("div", "", left, {
    marginTop: "30px",
    display: "flex",
    gap: "10px",
    flexWrap: "wrap",
  });
  for (const [text, c] of P.chips) {
    const chip = h("div", "pill light small", chips, {
      position: "static",
      fontSize: "15px",
      padding: "7px 13px 8px",
    });
    chip.style.setProperty("--c", c);
    h("span", "dot", chip);
    h("span", "", chip).textContent = text;
  }

  const S = P.scale ?? 0.66;
  const card = h("div", "card", stage, {
    width: "1600px",
    height: `${900 + TB}px`,
    transform: `translate(${P.x}px, ${P.y}px) scale(${S})`,
  });
  const clip = h("div", "clip", card);
  if (TB > 0) {
    const bar = h("div", "titlebar", clip, { height: `${TB}px` });
    const lights = h("div", "lights", bar, { left: "16px", top: `${(TB - 12) / 2}px` });
    for (let i = 0; i < 3; i++) h("i", "", lights);
  }
  const screen = h("div", "screen", clip, { top: `${TB}px` });
  const img = h("img", "", screen);
  const file = P.file;
  img.src = `${T.source.base}${file}`;
  if (TB === 0 && T.chrome?.lights) {
    const lights = h("div", "lights", clip, {
      left: `${T.chrome.lights.x}px`,
      top: `${T.chrome.lights.y}px`,
    });
    for (let i = 0; i < 3; i++) h("i", "", lights);
  }
  await document.fonts.load('700 40px "iA Writer Mono"');
  await document.fonts.load('400 40px "iA Writer Mono"');
  await document.fonts.ready;
  await img.decode();
}

async function init() {
  T = await (await fetch("/timeline.json")).json();
  if (new URLSearchParams(location.search).has("poster")) {
    await poster();
    return { poster: true };
  }
  build();
  await document.fonts.load('700 40px "iA Writer Mono"');
  await document.fonts.load('400 40px "iA Writer Mono"');
  await document.fonts.ready;
  for (const { panel, root } of panelEls) {
    if (panel.kind === "paper") {
      const img = root.querySelector("img");
      if (img) await img.decode();
    }
  }
  await seek(0);
  return { duration: T.duration, fps: T.fps };
}

window.stage = { init, seek };
