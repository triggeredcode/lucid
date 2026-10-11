import { join } from "node:path";
import { BrowserWindow, Menu, app, shell, type MenuItemConstructorOptions } from "electron";
import { IPC, type MenuAction, type PageZoomAction } from "./ipc/types";

/** Where the project lives, for the Help menu and the About window. */
export const REPOSITORY = "https://github.com/triggeredcode/lucid";

/** A file that comes with the app: in its resources when packaged, in the project's docs (or root) in development. */
export function bundledFile(name: string): string {
  if (app.isPackaged) return join(process.resourcesPath, name);
  return name === "guide.html"
    ? join(app.getAppPath(), "..", "..", "docs", name)
    : join(app.getAppPath(), "..", "..", name);
}

/**
 * The application menu. It is Electron's usual one, except that View → Zoom In / Zoom Out / Actual Size do not scale the whole
 * window (the pages list, the input box and the History panel would grow with the page): they ask the window to zoom the page
 * alone. The keys are the usual ones: ⌘+, ⌘− and ⌘0 (⌘= too, which is the same key as + without Shift).
 */
export function buildMenu(
  send: (channel: string, action: PageZoomAction | MenuAction) => void = sendToWindow,
): MenuItemConstructorOptions[] {
  const zoom = (action: PageZoomAction) => () => {
    send(IPC.pageZoom, action);
  };
  const note = (action: MenuAction) => () => {
    send(IPC.menuAction, action);
  };
  const isMac = process.platform === "darwin";
  return [
    ...(isMac ? [{ role: "appMenu" } as const] : []),
    {
      label: "File",
      submenu: [
        {
          id: "import-note",
          label: "Import Note…",
          accelerator: "CommandOrControl+O",
          click: note("import-note"),
        },
        {
          id: "export-note",
          label: "Export Note…",
          accelerator: "Shift+CommandOrControl+E",
          click: note("export-note"),
        },
        { type: "separator" },
        { role: isMac ? "close" : "quit" },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        {
          id: "zoom-reset",
          label: "Actual Size",
          accelerator: "CommandOrControl+0",
          click: zoom("reset"),
        },
        {
          id: "zoom-in",
          label: "Zoom In",
          accelerator: "CommandOrControl+Plus",
          click: zoom("in"),
        },
        // The + key without Shift is "=": the same zoom in, not listed twice.
        {
          id: "zoom-in-equals",
          label: "Zoom In",
          accelerator: "CommandOrControl+=",
          visible: false,
          click: zoom("in"),
        },
        {
          id: "zoom-out",
          label: "Zoom Out",
          accelerator: "CommandOrControl+-",
          click: zoom("out"),
        },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        {
          id: "help-guide",
          label: "Lucid Guide",
          click: () => {
            void shell.openPath(bundledFile("guide.html"));
          },
        },
        { type: "separator" },
        {
          id: "help-issue",
          label: "Report an Issue…",
          click: () => {
            void shell.openExternal(`${REPOSITORY}/issues/new/choose`);
          },
        },
        {
          id: "help-releases",
          label: "Check for Updates…",
          click: () => {
            void shell.openExternal(`${REPOSITORY}/releases/latest`);
          },
        },
        {
          id: "help-source",
          label: "Lucid on GitHub",
          click: () => {
            void shell.openExternal(REPOSITORY);
          },
        },
        {
          id: "help-licenses",
          label: "Licences of the Software Lucid Uses",
          click: () => {
            void shell.openPath(bundledFile("THIRD_PARTY_NOTICES.md"));
          },
        },
      ],
    },
  ];
}

function sendToWindow(channel: string, action: PageZoomAction | MenuAction): void {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  if (win && !win.isDestroyed()) win.webContents.send(channel, action);
}

export function installMenu(): void {
  app.setAboutPanelOptions({
    applicationName: "Lucid",
    applicationVersion: app.getVersion(),
    copyright: "© 2026 Omkar Tripathi. MIT licence.",
    website: REPOSITORY,
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildMenu()));
}
