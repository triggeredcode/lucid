import elkLayouts from "@mermaid-js/layout-elk";
import mermaid from "mermaid";
import {
  GOOD_SCALE,
  chooseLayout,
  fitScale,
  flipDirection,
  svgSize,
  type Box,
  type Layout,
} from "./fit";

/**
 * Mermaid settings: no HTML labels (they break PDF conversion), seeded hand-drawn
 * look so a re-render never jitters, and one shared render queue (mermaid is not re-entrant).
 *
 * Three looks: `pdf` is the house style that goes into the PDF (and is what an agent's PDF uses); `light` and `dark` are
 * the black-and-white looks of the page on screen, in the colours of the app.
 */
export type Look = "pdf" | "light" | "dark";

/**
 * The text on a connection must stay readable where the line runs under it. Mermaid draws the labels after the lines, but
 * gives their background half transparency, so the line shows through the words. An opaque background in the page's
 * colour hides the line behind the label, and a margin round it keeps the line from touching the letters. The rules are
 * part of the SVG, so the PDF gets them too.
 */
const labelCss = (page: string): string =>
  `.edgeLabel rect,.relationshipLabelBox{opacity:1;fill:${page};stroke:${page};stroke-width:6px;}.edgeLabel{background-color:${page};}`;
export const LABEL_CSS = labelCss("#fff");

const SANS = "Helvetica, Arial, sans-serif";
const MONO = '"iA Writer Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace';

/** The colours of a chart: the axes and text in the ink colour, the bars in greys. */
const chart = (ink: string, page: string, bars: string): Record<string, string> => ({
  backgroundColor: page,
  titleColor: ink,
  xAxisLabelColor: ink,
  xAxisTitleColor: ink,
  xAxisTickColor: ink,
  xAxisLineColor: ink,
  yAxisLabelColor: ink,
  yAxisTitleColor: ink,
  yAxisTickColor: ink,
  yAxisLineColor: ink,
  plotColorPalette: bars,
});

const LOOKS: Record<
  Look,
  { vars: Record<string, string | boolean | Record<string, string>>; css: string }
> = {
  pdf: { vars: { fontFamily: SANS }, css: LABEL_CSS },
  light: {
    vars: {
      fontFamily: MONO,
      primaryColor: "#f9f8f7",
      primaryBorderColor: "#a19e99",
      primaryTextColor: "#2c2c2b",
      secondaryColor: "#f0efed",
      tertiaryColor: "#ffffff",
      lineColor: "#7d7a75",
      textColor: "#2c2c2b",
      edgeLabelBackground: "#ffffff",
      background: "#ffffff",
      clusterBkg: "#f9f8f7",
      clusterBorder: "#e6e5e3",
      xyChart: chart("#2c2c2b", "#ffffff", "#5f5e59,#a19e99,#bcbab6"),
    },
    css: labelCss("#ffffff"),
  },
  dark: {
    vars: {
      darkMode: true,
      fontFamily: MONO,
      primaryColor: "#2c2c2b",
      primaryBorderColor: "#7d7a75",
      primaryTextColor: "#f0efed",
      secondaryColor: "#383836",
      tertiaryColor: "#202020",
      lineColor: "#a19e99",
      textColor: "#f0efed",
      edgeLabelBackground: "#191919",
      background: "#191919",
      clusterBkg: "#202020",
      clusterBorder: "#383836",
      xyChart: chart("#f0efed", "#191919", "#ada9a3,#7d7a75,#5f5e59"),
    },
    css: labelCss("#191919"),
  },
};

let ready = false;
let current: Look | undefined;
let queue: Promise<unknown> = Promise.resolve();
const cache = new Map<string, string>();
let counter = 0;

function configure(look: Look): void {
  if (!ready) {
    mermaid.registerLayoutLoaders(elkLayouts);
    ready = true;
  }
  if (current === look) return;
  const { vars, css } = LOOKS[look];
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    look: "classic",
    layout: "elk",
    htmlLabels: false,
    handDrawnSeed: 1,
    // Mono letters are wide: the on-screen looks let a label run longer before it is wrapped (a word is never cut in two).
    flowchart: { htmlLabels: false, ...(look === "pdf" ? {} : { wrappingWidth: 360 }) },
    themeVariables: vars,
    themeCSS: css,
  });
  current = look;
}

/** The few colours the model of the page puts in the source (a cache node, the chosen one) become the on-screen look's. */
function recolour(source: string, look: Look): string {
  if (look === "pdf") return source;
  const dark = look === "dark";
  return source
    .replaceAll(
      "fill:#FEF3C7,stroke:#B7791F",
      dark ? "fill:#383836,stroke:#a19e99" : "fill:#f0efed,stroke:#7d7a75",
    )
    .replaceAll(
      "stroke-width:3px,stroke:#2F855A",
      dark ? "stroke-width:3px,stroke:#f0efed" : "stroke-width:3px,stroke:#2c2c2b",
    );
}

/**
 * Draws the text on the connections last. Mermaid paints the lines, then the labels, then the boxes, so a box that
 * stands where a label was placed hides part of its words. With the labels on top (on their opaque background) the words
 * are always whole, whatever the layout did.
 */
export function labelsOnTop(svg: string): string {
  if (typeof DOMParser === "undefined") return svg;
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  if (doc.querySelector("parsererror")) return svg;
  const labels = doc.querySelector("g.edgeLabels");
  const nodes = doc.querySelector("g.nodes");
  if (!labels || !nodes?.parentNode || labels.parentNode !== nodes.parentNode) return svg;
  nodes.parentNode.insertBefore(labels, nodes.nextSibling);
  return new XMLSerializer().serializeToString(doc.documentElement);
}

/** SVG text for Mermaid source in a look. Results are cached by look and source text. */
export function renderMermaid(source: string, look: Look = "pdf"): Promise<string> {
  const key = `${look}\n${source}`;
  const hit = cache.get(key);
  if (hit !== undefined) return Promise.resolve(hit);
  const run = queue.then(async () => {
    // Text is measured in the font it will be drawn in, so the web font has to be there first.
    if (look !== "pdf" && typeof document !== "undefined") {
      await document.fonts.load('16px "iA Writer Mono"').catch(() => undefined);
    }
    configure(look);
    counter += 1;
    const rendered = await mermaid.render(`lucid-fig-${String(counter)}`, recolour(source, look));
    const svg = labelsOnTop(rendered.svg);
    cache.set(key, svg);
    return svg;
  });
  queue = run.catch(() => undefined);
  return run;
}

/**
 * A flowchart drawn so that it is readable in `box`: in its stored direction when that fits comfortably, else also the other
 * way round, whichever is shrunk less. Both drawings are cached, so asking again for another width costs nothing.
 */
export async function renderFitted(source: string, look: Look, box: Box): Promise<Layout> {
  const make = async (text: string, flipped: boolean): Promise<Layout | undefined> => {
    const svg = await renderMermaid(text, look);
    const size = svgSize(svg);
    return size ? { svg, size, scale: fitScale(size, box), flipped } : undefined;
  };
  const stored = await make(source, false);
  if (!stored)
    return {
      svg: await renderMermaid(source, look),
      scale: 1,
      size: { width: 0, height: 0 },
      flipped: false,
    };
  if (stored.scale >= GOOD_SCALE) return stored;
  const other = flipDirection(source);
  const flipped = other === undefined ? undefined : await make(other, true);
  return chooseLayout(stored, flipped);
}
