import { keys } from "../platform";
import { usePageZoom, zoomPage } from "../theme/pageZoom";

/** Shown only while the page is not at 100%: the size, and a click puts it back. */
export function ZoomChip() {
  const zoom = usePageZoom();
  if (Math.abs(zoom - 1) < 0.005) return null;
  return (
    <button
      type="button"
      className="ghost small zoom-chip"
      title={keys("Page zoom: click for 100% (⌘0). ⌘+ and ⌘− zoom, or pinch.")}
      onClick={() => {
        zoomPage("reset");
      }}
    >
      {String(Math.round(zoom * 100))}%
    </button>
  );
}
