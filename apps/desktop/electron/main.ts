import { existsSync } from "node:fs";
import { join } from "node:path";
import { app, BrowserWindow, dialog, nativeImage, screen, shell } from "electron";
import { registerIpc } from "./ipc";
import { trafficLightPosition } from "./chrome";
import { installMenu } from "./menu";
import { boundsToOpen, readWindowState, writeWindowState } from "./windowState";

/** The app's icon: a white tile with a black frame and an L, in the black and white of the rest. */
const ICON = join(__dirname, "../../resources/icon.png");

function createWindow(): BrowserWindow {
  // Open at the size and place the window was left (when that place is still on a screen).
  const stateFile = join(app.getPath("userData"), "window-state.json");
  const saved = readWindowState(stateFile);
  const opened = boundsToOpen(
    saved,
    screen.getAllDisplays().map((d) => d.workArea),
    { width: 1280, height: 800 },
  );
  const mac = process.platform === "darwin";
  const win = new BrowserWindow({
    // The name is for the Window menu and the Dock, and for screen readers; on a Mac it is not drawn in the window.
    title: "Lucid",
    ...opened,
    // On a Mac the window has no title bar of its own: the top row of the page takes its place, with the three round buttons
    // in it (the page leaves room for them: `.is-mac` in styles.css).
    ...(mac
      ? {
          titleBarStyle: "hidden" as const,
          trafficLightPosition: trafficLightPosition(opened.width ?? 1280),
        }
      : {}),
    minWidth: 820,
    minHeight: 560,
    show: false,
    ...(existsSync(ICON) ? { icon: ICON } : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // The whole window never zooms (not with pinch, not with a zoom level Chromium remembered from an earlier run): the page
  // zooms by itself, from the View menu and from a pinch, and everything else keeps its size.
  void win.webContents.setVisualZoomLevelLimits(1, 1);
  win.webContents.on("did-finish-load", () => {
    win.webContents.setZoomLevel(0);
  });

  // The window's save failed and the person closes it: say so, and let them stay and try again or quit anyway.
  win.webContents.on("will-prevent-unload", (event) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: "warning",
      buttons: ["Stay", "Quit anyway"],
      defaultId: 0,
      cancelId: 0,
      message: "Lucid couldn’t save your latest changes.",
      detail: "If you quit now they are lost. Stay to let Lucid try saving again.",
    });
    if (choice === 1) event.preventDefault(); // ignore the page's objection: close
  });

  const remember = () => {
    if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
    writeWindowState(stateFile, { ...win.getNormalBounds(), maximized: win.isMaximized() });
  };
  let later: ReturnType<typeof setTimeout> | undefined;
  const soon = () => {
    clearTimeout(later);
    later = setTimeout(remember, 600);
  };
  // The buttons stay in the middle of the top row, which grows with the window.
  const placeButtons = () => {
    if (mac && !win.isDestroyed())
      win.setWindowButtonPosition(trafficLightPosition(win.getContentSize()[0] ?? 1280));
  };
  win.on("resize", placeButtons);
  win.on("resize", soon);
  win.on("move", soon);
  win.on("close", remember);

  win.once("ready-to-show", () => {
    if (saved?.maximized) win.maximize();
    win.show();
  });

  // Links in notes open in the user's browser, never inside the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  const devUrl = process.env["ELECTRON_RENDERER_URL"];
  if (devUrl) void win.loadURL(devUrl);
  else void win.loadFile(join(__dirname, "../renderer/index.html"));
  return win;
}

// A custom library (tests, a second profile) also gets its own browser storage, so the divider position and
// zoom level of one never leak into another.
const customHome = process.env["LUCID_HOME"];
if (customHome) app.setPath("userData", join(customHome, ".lucid", "electron"));

// One Lucid at a time: a second one would share the notes folder and the agent socket. Opening Lucid again brings the first to the front.
const first = app.requestSingleInstanceLock();
if (!first) app.quit();
app.on("second-instance", () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

void app.whenReady().then(() => {
  if (!first) return;
  // The Dock shows Electron's own icon until told otherwise (a packaged app brings its own).
  if (process.platform === "darwin" && existsSync(ICON))
    app.dock?.setIcon(nativeImage.createFromPath(ICON));
  installMenu();
  registerIpc();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
