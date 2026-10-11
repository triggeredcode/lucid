/** Words that carry no content: they may be dropped or added freely. */
const STOP = new Set(
  (
    "a an the and or but if then so than that this these those it its it's is are was were be been being am do does did " +
    "have has had having of to in on at by for with from as into onto over under about after before between through " +
    "up down out off just very really quite also too can could should would will shall may might must not no yes " +
    "i you we they he she them us our your their my me his her there here when while where which who whom what how why " +
    "um uh er ah like basically actually literally kind sort you know mean okay ok right well yeah " +
    "some any all each every more most much many few lot lots one ones thing things stuff get gets got make makes made " +
    "let lets let's going gonna wanna need needs want wants say says said talk talking mention add put " +
    // Words about the notes themselves ("create a table with three columns"): instructions, not content.
    "create creating make making build show write note notes table tables column columns row rows diagram list lists bullet bullets " +
    "heading headings section chart plot comparison compare underneath below above first second third next last " +
    // Spoken numbers: the digits in the output are what the numbers check looks at.
    "zero two three four five six seven eight nine ten eleven twelve twenty thirty forty fifty hundred thousand million billion"
  ).split(" "),
);

/** Light stemming: enough to treat "servers" and "server", "caching" and "cache" as one word. */
export function stem(word: string): string {
  let w = word.toLowerCase();
  if (w.length > 4 && w.endsWith("ies")) w = `${w.slice(0, -3)}y`;
  else if (w.length > 4 && /(sses|shes|ches|xes)$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
  if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
  if (w.length > 4 && w.endsWith("e")) w = w.slice(0, -1);
  if (w.length > 3 && w.at(-1) === w.at(-2)) w = w.slice(0, -1);
  return w;
}

/** Content words of a text: lowercase, no stop words or fillers, stemmed, in order, without repeats. */
export function contentWords(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) ?? []) {
    const word = raw.replace(/^['-]+|['-]+$/g, "");
    if (word.length < 2 || STOP.has(word)) continue;
    const s = stem(word);
    if (!seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}
