/** What reading one utterance can come to, shared by the diagram and the table builders. */
export interface AskOption<D> {
  label: string;
  draft: D;
  echo: string[];
}

export type Step<D> =
  | { kind: "applied"; draft: D; echo: string[] }
  /** Understood, nothing to change (already there, nothing to undo...). */
  | { kind: "nothing"; echo: string[] }
  | { kind: "undo" }
  | { kind: "done" }
  | { kind: "cancel" }
  /** Think: draw the notes with the model. */
  | { kind: "draw"; text: string }
  | { kind: "ask"; question: string; options: AskOption<D>[] }
  /** The grammar cannot read this; the model may. */
  | { kind: "unknown"; text: string };

/** The words that mean the same in every builder: take a step back, insert, throw away. */
export function sharedCommand(low: string): "undo" | "done" | "cancel" | undefined {
  if (
    /^(?:undo|scratch that|take that back|go back|undo that|undo the last (?:one|step|thing))$/.test(
      low,
    )
  )
    return "undo";
  if (
    /^(?:done|finish(?:ed)?|that'?s it|that is it|insert(?: it| the diagram| the table| this)?|looks good|all done|i'?m done)$/.test(
      low,
    )
  )
    return "done";
  if (/^(?:cancel|discard|never ?mind|forget it)(?: this| the diagram| the table| it)?$/.test(low))
    return "cancel";
  return undefined;
}
