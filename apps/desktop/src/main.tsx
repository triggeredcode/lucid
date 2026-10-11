import "@fontsource/ia-writer-mono/400.css";
import "@fontsource/ia-writer-mono/400-italic.css";
import "@fontsource/ia-writer-mono/700.css";
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { initAppearance } from "./theme/appearance";
import { initBlockNumbers } from "./theme/blockNumbers";
import { initPageZoom, zoomPage } from "./theme/pageZoom";

// The theme and the type are set before anything is drawn, so there is no flash of the wrong one.
initAppearance();
// The page's own zoom (the View menu and a pinch ask for it; the rest of the window keeps its size).
initPageZoom();
initBlockNumbers();
window.lucid.zoom.onAction(zoomPage);

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root element");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
