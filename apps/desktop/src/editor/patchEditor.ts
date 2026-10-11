import type { BlockPatch, PatchStep } from "@lucid/core";
import { blockToBn } from "./adapter";
import type { LucidEditor } from "./schema";

/**
 * Carries out a BlockPatch on the live editor inside one transaction, so the whole AI change is a single undo step.
 * BlockNote's own types are generic over the schema; the adapter's blocks are checked by the
 * adapter tests, so they are handed over as-is.
 */
export function applyPatchToEditor(editor: LucidEditor, patch: BlockPatch): void {
  const insertAt = (
    parentId: string | null,
    afterId: string | null,
    blocks: ReturnType<typeof blockToBn>[],
  ) => {
    const list = blocks as never[];
    if (afterId !== null) {
      editor.insertBlocks(list, afterId, "after");
    } else if (parentId === null) {
      const first = editor.document[0];
      if (first) editor.insertBlocks(list, first, "before");
      else editor.replaceBlocks(editor.document, list);
    } else {
      const parent = editor.getBlock(parentId);
      if (!parent) throw new Error(`Block ${parentId} is no longer in the document.`);
      editor.updateBlock(parent, { children: [...list, ...parent.children] as never[] });
    }
  };

  const run = (step: PatchStep) => {
    switch (step.kind) {
      case "insert":
        insertAt(step.parentId, step.afterId, step.blocks.map(blockToBn));
        break;
      case "update": {
        const bn = blockToBn(step.block);
        editor.updateBlock(step.id, {
          type: bn.type,
          props: bn.props,
          ...(bn.content === undefined ? {} : { content: bn.content }),
          children: bn.children,
        } as never);
        break;
      }
      case "remove":
        editor.removeBlocks([step.id]);
        break;
      case "move": {
        const block = editor.getBlock(step.id);
        if (!block) throw new Error(`Block ${step.id} is no longer in the document.`);
        editor.removeBlocks([step.id]);
        insertAt(step.parentId, step.afterId, [block]);
        break;
      }
    }
  };

  editor.transact(() => {
    for (const step of patch.steps) run(step);
  });
}
