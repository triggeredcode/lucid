import { filterSuggestionItems, insertOrUpdateBlockForSlashMenu } from "@blocknote/core";
import { useResolvedPageLook } from "../theme/appearance";
import "@blocknote/core/fonts/inter.css";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";
import {
  BasicTextStyleButton,
  BlockTypeSelect,
  CreateLinkButton,
  DragHandleMenu,
  FormattingToolbar,
  FormattingToolbarController,
  NestBlockButton,
  RemoveBlockItem,
  SideMenu,
  SideMenuController,
  SuggestionMenuController,
  UnnestBlockButton,
  blockTypeSelectItems,
  getDefaultReactSlashMenuItems,
  useBlockNoteEditor,
  useCreateBlockNote,
} from "@blocknote/react";
import { applyPatch, makeRevert, type BlockPatch, type LucidDoc, type Revert } from "@lucid/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { BlockNumbers } from "./BlockNumbers";
import { fromBn, toBn } from "./adapter";
import { applyPatchToEditor } from "./patchEditor";
import { schema } from "./schema";

const TEXT_BLOCKS = new Set([
  "paragraph",
  "heading",
  "bulletListItem",
  "numberedListItem",
  "checkListItem",
  "codeBlock",
]);
const SLASH_KEYS = new Set([
  "paragraph",
  "heading",
  "heading_2",
  "heading_3",
  "bullet_list",
  "numbered_list",
  "check_list",
  "code_block",
]);

function DeleteOnlyMenu() {
  return (
    <DragHandleMenu>
      <RemoveBlockItem>Delete</RemoveBlockItem>
    </DragHandleMenu>
  );
}

function Toolbar() {
  const editor = useBlockNoteEditor();
  const items = blockTypeSelectItems(editor.dictionary).filter(
    (i) =>
      TEXT_BLOCKS.has(i.type) &&
      (i.type !== "heading" ||
        (Number(i.props?.["level"] ?? 1) <= 3 && i.props?.["isToggleable"] !== true)),
  );
  return (
    <FormattingToolbar>
      <BlockTypeSelect key="type" items={items} />
      <BasicTextStyleButton basicTextStyle="bold" key="bold" />
      <BasicTextStyleButton basicTextStyle="italic" key="italic" />
      <BasicTextStyleButton basicTextStyle="underline" key="underline" />
      <BasicTextStyleButton basicTextStyle="strike" key="strike" />
      <BasicTextStyleButton basicTextStyle="code" key="code" />
      <CreateLinkButton key="link" />
      <NestBlockButton key="nest" />
      <UnnestBlockButton key="unnest" />
    </FormattingToolbar>
  );
}

/** What the rest of the app can do with the open page's editor. */
export interface EditorApi {
  /** The document as it is right now. */
  getDoc(): LucidDoc;
  /** The block the cursor is in (it may not be in the saved document yet, e.g. an empty paragraph). */
  cursorBlockId(): string | undefined;
  /** Applies an AI change as ONE undo step. Throws PatchError if a block it needs has gone. Returns the new document. */
  apply(patch: BlockPatch): LucidDoc;
  /** The way back for the last `apply` (once): what takes that change back, and what its blocks looked like after it. */
  takeRevert(): Revert | undefined;
  undo(): void;
  redo(): void;
  focus(): void;
}

interface Props {
  initial: LucidDoc;
  onChange: (doc: LucidDoc) => void;
  onReady?: ((api: EditorApi) => void) | undefined;
  /** By hand: the page can be typed in. Otherwise it only shows what the model made (and can still be changed by it). */
  editable?: boolean | undefined;
}

/** One page's editor. Mounted once per page (keyed by page id); reports the whole document on every edit. */
export function PageEditor({ initial, onChange, onReady, editable = true }: Props) {
  const current = useRef<LucidDoc>(initial);
  // The page as it is now, for the block numbers beside it.
  const [live, setLive] = useState<LucidDoc>(initial);
  const rootRef = useRef<HTMLDivElement>(null);
  const lastRevert = useRef<Revert | undefined>(undefined);
  const look = useResolvedPageLook();
  const first = useMemo(() => toBn(initial), [initial]);
  const editor = useCreateBlockNote(
    {
      schema,
      ...(first.blocks.length > 0 ? { initialContent: first.blocks as never } : {}),
      dictionary: undefined,
    },
    [],
  );

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  useEffect(() => {
    onReadyRef.current?.({
      getDoc: () => current.current,
      cursorBlockId: () => {
        try {
          return editor.getTextCursorPosition().block.id;
        } catch {
          return undefined;
        }
      },
      apply: (patch) => {
        // Check first: if a block the change needs has gone this throws before the editor is touched. The expected
        // result also tells the change handler about flags the editor cannot hold (unprocessed, ...).
        const previous = current.current;
        const expected = applyPatch(previous, patch);
        current.current = expected;
        try {
          applyPatchToEditor(editor, patch);
        } catch (error) {
          current.current = previous;
          throw error;
        }
        // Report what the editor really holds. A change that only touches what the editor does not see (a plain
        // status on a code block, say) would not make it announce anything by itself.
        const actual = fromBn(editor.document, expected);
        current.current = actual;
        setLive(actual);
        lastRevert.current = makeRevert(previous, patch, actual);
        onChangeRef.current(actual);
        return actual;
      },
      takeRevert: () => {
        const revert = lastRevert.current;
        lastRevert.current = undefined;
        return revert;
      },
      undo: () => {
        editor.undo();
      },
      redo: () => {
        editor.redo();
      },
      focus: () => {
        editor.focus();
      },
    });
  }, [editor]);

  const slashItems = (query: string) => {
    const defaults = getDefaultReactSlashMenuItems(editor).filter((i) =>
      SLASH_KEYS.has(String((i as { key?: string }).key)),
    );
    const lucid = [
      {
        title: "Callout",
        subtext: "A highlighted note, key idea, decision or warning",
        aliases: ["note", "callout", "key", "decision", "warning", "tradeoff", "question"],
        group: "Lucid",
        icon: <span className="slash-icon">!</span>,
        onItemClick: () => {
          insertOrUpdateBlockForSlashMenu(editor, { type: "callout", props: { kind: "note" } });
        },
      },
      {
        title: "Math",
        subtext: "A formula written in LaTeX",
        aliases: ["math", "equation", "formula", "latex"],
        group: "Lucid",
        icon: <span className="slash-icon">∑</span>,
        onItemClick: () => {
          insertOrUpdateBlockForSlashMenu(editor, { type: "math" });
        },
      },
    ];
    return Promise.resolve(filterSuggestionItems([...defaults, ...lucid], query));
  };

  return (
    <div className="page-editor" ref={rootRef}>
      <BlockNumbers doc={live} root={rootRef} />
      <BlockNoteView
        editor={editor}
        theme={look}
        editable={editable}
        formattingToolbar={false}
        slashMenu={false}
        sideMenu={false}
        onChange={() => {
          const next = fromBn(editor.document, current.current);
          current.current = next;
          setLive(next);
          onChange(next);
        }}
      >
        <FormattingToolbarController formattingToolbar={Toolbar} />
        <SuggestionMenuController triggerCharacter="/" getItems={slashItems} />
        <SideMenuController sideMenu={() => <SideMenu dragHandleMenu={DeleteOnlyMenu} />} />
      </BlockNoteView>
    </div>
  );
}
