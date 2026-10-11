import { describeBlocks, type BlockInfo } from "@lucid/kit";
import type { LucidDoc } from "@lucid/core";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useBlockNumbers } from "../theme/blockNumbers";
import { usePageZoom } from "../theme/pageZoom";

/** What to say to name a part, for the little help under a block's parts. */
const SAY: Record<string, string> = {
  list: "item 2 of block N",
  table: "row 2 of block N · column 3 of block N",
  diagram: "node 2 of block N · connection 1 of block N",
};

const MORE = 14;

/**
 * A light number in the left margin by each block: B1, B2, B3... A list is one block, a table is one, a diagram is one, and a
 * block has parts (the items of a list, the rows and columns of a table, the parts and connections of a diagram). The numbers are
 * what the model calls the blocks, so "in block 3, add a row" or "node 2 of block 5" means the same to the person and the model.
 * A click on a number shows the parts of that block. It is a picture laid beside the page: the page itself is not changed.
 */
export function BlockNumbers({
  doc,
  root,
}: {
  doc: LucidDoc;
  root: React.RefObject<HTMLDivElement | null>;
}) {
  const shown = useBlockNumbers();
  const zoom = usePageZoom();
  const infos = useMemo(() => describeBlocks(doc), [doc]);
  const [tops, setTops] = useState<number[]>([]);
  const [narrow, setNarrow] = useState(false);
  const [open, setOpen] = useState<number | undefined>();
  const layer = useRef<HTMLDivElement>(null);

  // Where each block is, measured from the page: the first row of its blocks, relative to the top of the editor.
  const measure = useCallback(() => {
    const el = root.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    setTops((was) => {
      const next = infos.map((info) => {
        const first = info.ids[0];
        const block = first
          ? el.querySelector<HTMLElement>(`.bn-block-outer[data-id="${CSS.escape(first)}"]`)
          : null;
        // The first line of the block (its content), not the space around it.
        const content = block?.querySelector<HTMLElement>(".bn-block-content") ?? block;
        return content ? Math.round(content.getBoundingClientRect().top - box.top) : -1;
      });
      return next.length === was.length && next.every((t, i) => t === was[i]) ? was : next;
    });
    const scroll = el.closest(".editor-scroll");
    setNarrow(scroll ? box.left - scroll.getBoundingClientRect().left < 40 : false);
  }, [infos, root]);

  useLayoutEffect(() => {
    measure();
  }, [measure, zoom, shown]);

  useEffect(() => {
    const el = root.current;
    if (!el || !shown) return;
    let frame = 0;
    const later = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const resize = new ResizeObserver(later);
    resize.observe(el);
    // Diagrams and tables draw after the page does, and change its height: look again when anything is added or removed.
    const mutation = new MutationObserver(later);
    mutation.observe(el, { childList: true, subtree: true });
    window.addEventListener("resize", later);
    void document.fonts.ready.then(later);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutation.disconnect();
      window.removeEventListener("resize", later);
    };
  }, [measure, root, shown]);

  // Esc, or a click anywhere else, closes the parts.
  useEffect(() => {
    if (open === undefined) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(undefined);
    };
    const onDown = (e: MouseEvent) => {
      if (!layer.current?.contains(e.target as Node)) setOpen(undefined);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  if (!shown || narrow) return null;
  return (
    <div className="block-numbers" ref={layer} role="group" aria-label="Block numbers">
      {infos.map((info, i) => {
        const top = tops[i];
        if (top === undefined || top < 0) return null;
        return (
          <div key={info.ref} className="block-no-row" style={{ top }}>
            <button
              type="button"
              className="block-no"
              data-kind={info.kind}
              aria-expanded={open === i}
              aria-label={`Block ${String(info.n)}: ${info.kind}${info.label ? ` ${info.label}` : ""}`}
              title={`Block ${String(info.n)}: ${info.kind}. Click to see its parts.`}
              onClick={() => {
                setOpen(open === i ? undefined : i);
              }}
            >
              B{info.n}
            </button>
            {open === i && <Parts info={info} />}
          </div>
        );
      })}
    </div>
  );
}

function Parts({ info }: { info: BlockInfo }) {
  const groups = info.groups.filter((g) => g.items.length > 0);
  return (
    <div className="block-parts" role="dialog" aria-label={`Parts of block ${String(info.n)}`}>
      <p className="block-parts-head">
        <b>Block {info.n}</b> · {info.kind}
        {info.label ? ` · ${info.label}` : ""}
      </p>
      {groups.length === 0 && <p className="block-parts-none">One piece. Say “block {info.n}”.</p>}
      {groups.map((g) => (
        <div key={g.title} className="block-parts-group">
          <h4>{g.title}</h4>
          <ol>
            {g.items.slice(0, MORE).map((p) => (
              <li key={`${p.n}-${p.ref ?? p.id ?? ""}`}>
                <span className="block-part-n">{p.n}</span> {p.label || "(empty)"}
              </li>
            ))}
          </ol>
          {g.items.length > MORE && (
            <p className="block-parts-none">and {g.items.length - MORE} more</p>
          )}
        </div>
      ))}
      {SAY[info.kind] && (
        <p className="block-parts-say">Say: “{SAY[info.kind]?.replaceAll("N", String(info.n))}”</p>
      )}
    </div>
  );
}
