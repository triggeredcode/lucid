import { useEffect, useState, type RefObject } from "react";

/** The width of an element, in steps of 24 px (so dragging the window does not redraw on every pixel); 0 until it is known. */
export function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = (w: number) => {
      setWidth(Math.max(0, Math.floor(w / 24) * 24));
    };
    read(el.clientWidth);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) read(entry.contentRect.width);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [ref]);
  return width;
}
