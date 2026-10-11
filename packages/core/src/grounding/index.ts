import { aliasKey, normaliseTerm } from "./aliases";
import { contentWords, stem } from "./words";

export { aliasKey, normaliseTerm, sameTerm } from "./aliases";
export { diagramLabels, plainTextOfBlocks } from "./text";
export { contentWords, stem } from "./words";

export interface Coverage {
  /** Share of the speaker's content words that appear in the output, 0 to 1 (1 when there is nothing to cover). */
  ratio: number;
  missing: string[];
}

/**
 * How much of what the user said survives in the notes. Aliases count as the same word, so
 * "post gress" in the utterance is covered by "PostgreSQL" in the output.
 */
export function coverage(utterance: string, output: string): Coverage {
  const wanted = contentWords(utterance);
  if (wanted.length === 0) return { ratio: 1, missing: [] };
  const have = new Set(contentWords(output));
  const haveAliases = new Set([...have].map((w) => aliasKey(w)));
  const text = normaliseTerm(output);
  const missing = wanted.filter(
    (w) => !have.has(w) && !haveAliases.has(aliasKey(w)) && !text.includes(normaliseTerm(w)),
  );
  return { ratio: (wanted.length - missing.length) / wanted.length, missing };
}

const NUMBER_WORDS =
  /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|half|double|triple|dozen)\b/i;

/** Digits with an optional magnitude suffix ("100M", "5k"), written the same way however they were typed. */
const numbersIn = (text: string): string[] =>
  (
    text.match(
      /(?<![\p{L}\p{N}_.])\d+(?:[.,]\d+)*(?:[kmb](?![\p{L}\p{N}_]))?(?![\p{L}\p{N}_])/giu,
    ) ?? []
  ).map((n) =>
    n
      .toLowerCase()
      .replace(/,/g, "")
      .replace(/(\.\d*?)0+(?=[kmb]?$)/, "$1")
      .replace(/\.(?=[kmb]?$)/, ""),
  );

/**
 * Numbers in the output that the user never said.
 * Spoken numbers ("a hundred million") cannot be compared reliably with digits, so when the utterance contains
 * number words the check passes.
 */
export function inventedNumbers(output: string, sources: readonly string[]): string[] {
  if (sources.some((s) => NUMBER_WORDS.test(s))) return [];
  const known = new Set(sources.flatMap(numbersIn));
  return [...new Set(numbersIn(output).filter((n) => !known.has(n)))];
}

/** Every one-, two- and three-word window of a text, as alias keys: "red is" and "Redis" meet at the same key. */
function aliasWindows(text: string): Set<string> {
  const words = normaliseTerm(text).split(" ").filter(Boolean);
  const keys = new Set<string>();
  for (let n = 1; n <= 3; n++) {
    for (let i = 0; i + n <= words.length; i++) keys.add(aliasKey(words.slice(i, i + n).join(" ")));
  }
  return keys;
}

/** Diagram labels (or any terms) that appear in none of the sources, matching aliases and word forms. */
export function ungroundedTerms(terms: readonly string[], sources: readonly string[]): string[] {
  const joined = sources.join("\n");
  const haystack = normaliseTerm(joined);
  const stems = new Set(contentWords(joined));
  const windows = aliasWindows(joined);
  return terms.filter((term) => {
    const t = normaliseTerm(term);
    if (t.length === 0 || haystack.includes(t) || windows.has(aliasKey(term))) return false;
    const words = t.split(" ").filter(Boolean);
    // Every word of a multi-word label must have been said, in some form ("Web Server" for "web servers").
    return !words.every(
      (w) => stems.has(stem(w)) || windows.has(aliasKey(w)) || contentWords(w).length === 0,
    );
  });
}
