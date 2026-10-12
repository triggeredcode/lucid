// Records the real Lucid window as a sequence of stills with timestamps, plus the named moments ("marks") and the mouse
// path that the composition needs. The page is photographed in a loop (about 24 frames a second at 2x); a frame that is
// identical to the one before it is not stored, so a quiet window costs nothing.
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export class Recorder {
  /**
   * @param {import("playwright").Page} page
   * @param {string} dir where frames/ and manifest.json go
   */
  constructor(page, dir, { quality = 90 } = {}) {
    this.page = page;
    this.dir = dir;
    this.quality = quality;
    this.frames = [];
    this.marks = [];
    this.cursor = [];
    this.t0 = 0;
    this.running = false;
    this.last = "";
    this.count = 0;
  }

  now() {
    return Math.round(performance.now() - this.t0);
  }

  start() {
    rmSync(this.dir, { recursive: true, force: true });
    mkdirSync(join(this.dir, "frames"), { recursive: true });
    this.t0 = performance.now();
    this.running = true;
    this.loop = this.#run();
  }

  async #run() {
    while (this.running) {
      const before = performance.now();
      let buf;
      try {
        buf = await this.page.screenshot({ type: "jpeg", quality: this.quality, caret: "initial" });
      } catch {
        if (!this.running) break;
        continue;
      }
      const after = performance.now();
      const hash = createHash("sha1").update(buf).digest("hex");
      if (hash === this.last) continue;
      this.last = hash;
      this.count += 1;
      const file = `frames/f${String(this.count).padStart(5, "0")}.jpg`;
      writeFileSync(join(this.dir, file), buf);
      // The picture shows the page as it was somewhere inside the call; the middle is the best guess.
      this.frames.push({ t: Math.round((before + after) / 2 - this.t0), file });
    }
  }

  /** A named moment, with anything the composition needs to know about it (rectangles, text). */
  mark(name, data = {}) {
    const mark = { name, t: this.now(), ...data };
    this.marks.push(mark);
    return mark;
  }

  /** Moves the real mouse to (x, y) in CSS pixels, with easing, and records the path. */
  async moveTo(x, y, ms = 700, from) {
    const start = from ?? this.pos ?? { x: x - 120, y: y + 80 };
    const steps = Math.max(2, Math.round(ms / 16));
    const t0 = performance.now();
    for (let i = 1; i <= steps; i++) {
      const p = i / steps;
      const e = p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2;
      const px = start.x + (x - start.x) * e;
      const py = start.y + (y - start.y) * e;
      await this.page.mouse.move(px, py);
      this.cursor.push({ t: this.now(), x: Math.round(px * 10) / 10, y: Math.round(py * 10) / 10 });
      const wait = t0 + (ms * i) / steps - performance.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
    this.pos = { x, y };
  }

  /** Moves to the middle of the element, presses and releases. Returns the click time. */
  async click(locator, { ms = 700, name = "click" } = {}) {
    const box = await locator.boundingBox();
    if (!box) throw new Error("nothing to click");
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await this.moveTo(x, y, ms);
    await new Promise((r) => setTimeout(r, 120));
    const mark = this.mark(name, { x, y });
    await this.page.mouse.down();
    await new Promise((r) => setTimeout(r, 70));
    await this.page.mouse.up();
    return mark;
  }

  async stop() {
    this.running = false;
    await this.loop;
  }

  manifest(extra = {}) {
    return {
      duration: this.now(),
      frames: this.frames,
      marks: this.marks,
      cursor: this.cursor,
      ...extra,
    };
  }
}
