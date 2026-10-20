import { buildDocumentContextIndex } from "@lucid/core";
import { buildDocumentContext, buildOutline } from "@lucid/kit";
import type { ContextStrategy, ContextStrategyResult } from "./types";

const planned = (
  text: string,
  selection: ReturnType<typeof buildDocumentContext>["selection"],
): ContextStrategyResult => ({
  text,
  selectedIds: selection.selectedBlockIds,
  scope: selection.scope,
  missingRefs: selection.missingRefs,
  ambiguityKinds: selection.ambiguities.map(({ kind }) => kind),
});

export const currentContextStrategy: ContextStrategy = {
  id: "current",
  select(testCase, doc) {
    const result = buildDocumentContext({
      doc,
      utterance: testCase.utterance,
      cursorBlockId: testCase.cursorBlockId,
      recentTouched: testCase.recentTouched,
    });
    return planned(result.text, result.selection);
  },
};

/**
 * Experiment-only R1 candidate. Resolution stays with Lucid's existing planner; once the target is
 * unambiguous, an agent read contains the resolved blocks and their section headings rather than
 * every block in those sections.
 */
export const focusedContextStrategy: ContextStrategy = {
  id: "focused",
  select(testCase, doc) {
    const result = buildDocumentContext({
      doc,
      utterance: testCase.utterance,
      cursorBlockId: testCase.cursorBlockId,
      recentTouched: testCase.recentTouched,
    });
    const unresolved =
      result.selection.missingRefs.length > 0 || result.selection.ambiguities.length > 0;
    if (result.selection.scope === "document" || unresolved)
      return planned(result.text, result.selection);

    const index = buildDocumentContextIndex(doc, testCase.recentTouched);
    const include = new Set(result.selection.fullBlockIds);
    for (const id of result.selection.fullBlockIds) {
      const sectionId = index.blocks.find((block) => block.id === id)?.sectionId;
      const headingId = index.sections.find((section) => section.id === sectionId)?.headingId;
      if (headingId) include.add(headingId);
    }
    const selectedIds = index.blocks.filter(({ id }) => include.has(id)).map(({ id }) => id);
    const outline = buildOutline(doc, {
      include: selectedIds,
      full: result.selection.fullBlockIds,
      maxChars: 24_000,
    });
    return {
      text: outline.text,
      selectedIds,
      scope: result.selection.scope,
      missingRefs: result.selection.missingRefs,
      ambiguityKinds: [],
    };
  },
};
