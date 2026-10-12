// Small text helpers for checking what the voice said against what it was asked to say, and for giving every word of the
// on-screen caption a time.

/** "Wispr Flow, OpenWhispr" -> "wispr flow openwhispr": lower case, letters and digits only, one space. */
export function normalize(text) {
  return text
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function levenshtein(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length];
}

/** 1 for identical, towards 0 for unrelated. */
export function similarity(a, b) {
  if (a.length === 0 && b.length === 0) return 1;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

/**
 * How close the transcript is to the text that was to be spoken, ignoring case, punctuation and spaces (so "M C P" and
 * "MCP" are the same). 1 is exact.
 */
export function spokenSimilarity(expected, heard) {
  return similarity(normalize(expected).replace(/ /g, ""), normalize(heard).replace(/ /g, ""));
}

/**
 * Gives each word of the caption text a start and end, from the words the speech recogniser heard with their times.
 *
 * The two are aligned letter by letter (an edit-distance alignment), not word by word: a recogniser may hear "Whisperflow"
 * where the caption says "Wispr Flow", or split "OpenWhispr" in two. Each heard word's letters are spread over its time,
 * and a caption word takes the time span of the letters it lines up with. A word with no partner gets a time between its
 * neighbours.
 *
 * @param {string[]} words caption words, as they are shown
 * @param {{w: string, start: number, end: number}[]} heard
 * @returns {{w: string, start: number, end: number}[]}
 */
export function timeWords(words, heard) {
  const A = [];
  words.forEach((word, wi) => {
    for (const ch of normalize(word).replace(/ /g, "")) A.push({ ch, wi });
  });
  const B = [];
  for (const h of heard) {
    const chars = [...normalize(h.w).replace(/ /g, "")];
    const len = chars.length || 1;
    chars.forEach((ch, i) =>
      B.push({
        ch,
        t0: h.start + ((h.end - h.start) * i) / len,
        t1: h.start + ((h.end - h.start) * (i + 1)) / len,
      }),
    );
  }
  const n = A.length;
  const m = B.length;
  const cost = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) cost[i][0] = i;
  for (let j = 1; j <= m; j++) cost[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const sub = cost[i - 1][j - 1] + (A[i - 1].ch === B[j - 1].ch ? 0 : 1);
      cost[i][j] = Math.min(sub, cost[i - 1][j] + 1, cost[i][j - 1] + 1);
    }
  }
  const span = words.map(() => ({ t0: Infinity, t1: -Infinity }));
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const diagonal = cost[i - 1][j - 1] + (A[i - 1].ch === B[j - 1].ch ? 0 : 1);
    if (cost[i][j] === diagonal) {
      const s = span[A[i - 1].wi];
      s.t0 = Math.min(s.t0, B[j - 1].t0);
      s.t1 = Math.max(s.t1, B[j - 1].t1);
      i--;
      j--;
    } else if (cost[i][j] === cost[i - 1][j] + 1) i--;
    else j--;
  }
  const out = words.map((w, k) => ({
    w,
    start: Number.isFinite(span[k].t0) ? span[k].t0 : NaN,
    end: Number.isFinite(span[k].t1) ? span[k].t1 : NaN,
  }));
  // Fill the gaps between known words evenly.
  const first = heard.length > 0 ? heard[0].start : 0;
  const last = heard.length > 0 ? heard[heard.length - 1].end : 0;
  let k = 0;
  while (k < words.length) {
    if (!Number.isNaN(out[k].start)) {
      k++;
      continue;
    }
    let e = k;
    while (e < words.length && Number.isNaN(out[e].start)) e++;
    const from = k === 0 ? first : out[k - 1].end;
    const to = e === words.length ? last : out[e].start;
    const step = (to - from) / (e - k);
    for (let q = k; q < e; q++) {
      out[q].start = from + step * (q - k);
      out[q].end = from + step * (q - k + 1);
    }
    k = e;
  }
  // Times only go forward.
  for (let q = 1; q < out.length; q++) {
    if (out[q].start < out[q - 1].start) out[q].start = out[q - 1].start;
    if (out[q].end < out[q].start) out[q].end = out[q].start;
  }
  return out;
}
