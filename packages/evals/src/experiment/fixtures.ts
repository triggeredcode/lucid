import type { Block, LucidDoc } from "@lucid/core";
import { SAMPLE_DOC } from "@lucid/kit";
import { fixture } from "../fixtures";
import type { ContextFixtureName } from "./types";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const text = (value: string) => [{ type: "text" as const, text: value, styles: {} }];

function largeSections(): LucidDoc {
  const blocks: Block[] = [];
  for (let section = 1; section <= 8; section += 1) {
    blocks.push({
      id: `section-${String(section)}`,
      type: "heading",
      props: { level: 2 },
      content: text(`Topic ${String(section)}`),
    });
    for (let paragraph = 1; paragraph <= 8; paragraph += 1) {
      blocks.push({
        id: `topic-${String(section)}-${String(paragraph)}`,
        type: "paragraph",
        props: {},
        content: text(
          section === 6 && paragraph === 4
            ? "Quasar retention keeps audit events for ninety days."
            : `Background note ${String(section)}.${String(paragraph)} about the architecture and its operating constraints.`,
        ),
      });
    }
  }
  return { blocks };
}

export function contextFixture(name: ContextFixtureName): LucidDoc {
  if (name === "sample") return clone(SAMPLE_DOC);
  if (name === "two-tables") return fixture("two-tables");
  return largeSections();
}
