// Which system a visitor is on, and which file of a release belongs to each system. Plain functions (no page needed), so they can be
// tested: see apps/desktop/electron/site.test.ts.

/** The systems Lucid is built for, as the page shows them. */
export const SYSTEMS = {
  mac: { key: "mac", name: "macOS" },
  windows: { key: "windows", name: "Windows" },
  linux: { key: "linux", name: "Linux" },
};

/**
 * "mac", "windows" or "linux" for a computer, and "other" for a phone, a tablet or anything else (where the page shows all three
 * systems and says the download is for a computer). Takes the browser's `navigator`, or something shaped like it.
 */
export function detectSystem(nav) {
  const agent = nav.userAgent || "";
  const platform = (nav.userAgentData && nav.userAgentData.platform) || nav.platform || "";
  if (/iPhone|iPad|iPod|Android/i.test(agent)) return "other";
  // An iPad that asks for the desktop site says it is a Mac, but it has a touch screen.
  if (/mac/i.test(platform) && (nav.maxTouchPoints || 0) > 1) return "other";
  if (/win/i.test(platform) || /Windows/.test(agent)) return "windows";
  if (/mac/i.test(platform) || /Macintosh|Mac OS X/.test(agent)) return "mac";
  if (/linux|x11|cros/i.test(platform) || /Linux|X11/.test(agent)) return "linux";
  return "other";
}

const FILES = {
  mac: {
    primary: { label: ".dmg", match: /\.dmg$/ },
    secondary: { label: ".zip", match: /(?:^|-)(?:mac-)?arm64\.zip$/ },
  },
  windows: {
    primary: { label: "Installer (.exe)", match: /\.exe$/ },
    secondary: { label: "Portable (.zip)", match: /-win-[^/]*\.zip$/ },
  },
  linux: {
    primary: { label: ".deb", match: /\.deb$/ },
    secondary: { label: ".AppImage", match: /\.AppImage$/ },
  },
};

/**
 * The files of a GitHub release (its `assets`) for each system: `{ mac: { primary, secondary }, windows: …, linux: …, sums }`, each
 * entry `{ name, url, size, label }` or undefined when the release has no such file (an older release has no Windows or Linux build).
 */
export function pickAssets(release) {
  const assets = (release && release.assets) || [];
  const find = (match) => assets.find((a) => match.test(a.name));
  const entry = (asset, label) =>
    asset
      ? { name: asset.name, url: asset.browser_download_url, size: asset.size, label }
      : undefined;
  const out = {};
  for (const [system, files] of Object.entries(FILES)) {
    out[system] = {
      primary: entry(find(files.primary.match), files.primary.label),
      secondary: entry(find(files.secondary.match), files.secondary.label),
    };
  }
  out.sums = entry(
    assets.find((a) => a.name === "SHA256SUMS"),
    "SHA256SUMS",
  );
  return out;
}

/** 143 MB, counted as Finder and Explorer count (1 MB = 1,000,000 bytes). */
export function megabytes(bytes) {
  return Math.round(bytes / 1e6) + " MB";
}
