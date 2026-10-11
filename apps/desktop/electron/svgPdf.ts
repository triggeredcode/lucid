import { BrowserWindow } from "electron";
import { svgSize } from "./svgSize";

/**
 * One SVG drawing to a vector PDF page of the drawing's own size, with Electron's own Chromium (the page is printed, so
 * lines stay lines and text stays text with its font embedded). No program outside the app is needed. The drawing comes from
 * Lucid itself (Mermaid), and is shown in a window with no scripts, no network and no way to navigate away.
 */
export async function svgToPdf(svg: string): Promise<Uint8Array> {
  const { width, height } = svgSize(svg);
  const win = new BrowserWindow({
    show: false,
    width: Math.ceil(width),
    height: Math.ceil(height),
    webPreferences: { sandbox: true, javascript: false, webSecurity: true, images: true },
  });
  try {
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (event) => {
      event.preventDefault();
    });
    const html =
      `<!doctype html><meta charset="utf-8">` +
      `<style>@page{size:${String(width)}px ${String(height)}px;margin:0}` +
      `html,body{margin:0;padding:0;background:transparent}` +
      `svg{display:block;width:${String(width)}px;height:${String(height)}px}</style>${svg}`;
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const pdf = await win.webContents.printToPDF({
      preferCSSPageSize: true,
      printBackground: true,
    });
    return new Uint8Array(pdf);
  } finally {
    win.destroy();
  }
}
