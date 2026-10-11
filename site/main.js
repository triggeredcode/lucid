// The Lucid site. Everything here is optional: without it the page reads fine, every system's download is shown, and the links
// go to the releases page.
import { SYSTEMS, detectSystem, megabytes, pickAssets } from "./downloads.js";

const REPO = "triggeredcode/lucid";
const root = document.documentElement;

// ---- light / dark: follows the system until the visitor chooses ----
const toggle = document.getElementById("theme");
if (toggle) {
  toggle.addEventListener("click", () => {
    const dark = root.dataset.theme
      ? root.dataset.theme === "dark"
      : window.matchMedia("(prefers-color-scheme: dark)").matches;
    const next = dark ? "light" : "dark";
    root.dataset.theme = next;
    try {
      localStorage.setItem("lucid-theme", next);
    } catch {
      /* storage can be blocked */
    }
  });
}

// ---- blocks rise into view ----
const reveals = document.querySelectorAll(".reveal");
const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
if ("IntersectionObserver" in window && !reduce) {
  const seen = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add("in");
          seen.unobserve(e.target);
        }
      }
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
  );
  reveals.forEach((el) => {
    seen.observe(el);
  });
} else {
  reveals.forEach((el) => {
    el.classList.add("in");
  });
}

// ---- copy buttons ----
function wireCopy(button) {
  button.addEventListener("click", () => {
    const text = button.getAttribute("data-copy") || "";
    if (!navigator.clipboard || !navigator.clipboard.writeText) return;
    navigator.clipboard.writeText(text).then(
      () => {
        const was = button.textContent;
        button.textContent = "Copied";
        setTimeout(() => {
          button.textContent = was;
        }, 1500);
      },
      () => undefined,
    );
  });
}
document.querySelectorAll("[data-copy]").forEach(wireCopy);

// ---- the download card: one tab per system, the visitor's own first ----
const mine = detectSystem(navigator);
const tabs = [...document.querySelectorAll(".tabs [data-system]")];
const panels = [...document.querySelectorAll(".panel[data-system]")];
const sideDetails = [...document.querySelectorAll(".dl-side details[data-system]")];

function show(system) {
  for (const t of tabs) t.setAttribute("aria-selected", String(t.dataset.system === system));
  for (const t of tabs) t.tabIndex = t.dataset.system === system ? 0 : -1;
  for (const el of [...panels, ...sideDetails]) el.hidden = el.dataset.system !== system;
}
if (tabs.length > 0) {
  root.classList.add("js-tabs");
  show(mine === "other" ? "mac" : mine);
  if (mine !== "other") {
    const here = document.querySelector(`#tab-${mine} .here`);
    if (here) here.hidden = false;
  }
  for (const tab of tabs) {
    tab.addEventListener("click", () => {
      show(tab.dataset.system);
    });
    tab.addEventListener("keydown", (e) => {
      const i = tabs.indexOf(tab);
      const next =
        e.key === "ArrowRight"
          ? tabs[(i + 1) % tabs.length]
          : e.key === "ArrowLeft"
            ? tabs[(i + tabs.length - 1) % tabs.length]
            : undefined;
      if (next) {
        e.preventDefault();
        next.focus();
        show(next.dataset.system);
      }
    });
  }
}

// ---- the latest release: version, date, sizes and direct links, for each system ----
function fill(release) {
  const files = pickAssets(release);
  const version = String(release.tag_name || "").replace(/^v/, "");
  for (const a of document.querySelectorAll("[data-dl]")) {
    const [system, which] = (a.getAttribute("data-dl") || "").split(".");
    const file = system === "sums" ? files.sums : files[system] && files[system][which];
    const size = a.querySelector(".size");
    if (file) {
      a.href = file.url;
      a.removeAttribute("aria-disabled");
      if (size) size.textContent = megabytes(file.size);
    } else if (system !== "sums") {
      // This release has no such file (an older release has no Windows or Linux build): say so instead of sending the visitor away.
      a.setAttribute("aria-disabled", "true");
      a.removeAttribute("href");
      if (size) size.textContent = "";
    }
  }
  for (const panel of panels) {
    const f = files[panel.dataset.system];
    const note = panel.querySelector(".dl-note");
    if (note) {
      const missing = !f.primary && !f.secondary;
      note.hidden = !missing;
      if (missing)
        note.innerHTML = `Version ${version} has no ${SYSTEMS[panel.dataset.system].name} build. It comes with the next release; until then you can <a href="https://github.com/${REPO}#build-from-source">build it from the source</a>.`;
    }
  }
  // The Linux commands name the file that was released.
  const deb = files.linux.primary;
  const appimage = files.linux.secondary;
  for (const button of document.querySelectorAll("[data-copy-deb]")) {
    if (deb) {
      button.setAttribute("data-copy", `sudo apt install ./${deb.name}`);
      button.parentElement.querySelector("code").textContent = `sudo apt install ./${deb.name}`;
    }
  }
  for (const button of document.querySelectorAll("[data-copy-appimage]")) {
    if (appimage) {
      button.setAttribute("data-copy", `chmod +x ${appimage.name} && ./${appimage.name}`);
      button.parentElement.querySelector("code").textContent =
        `chmod +x ${appimage.name}\n./${appimage.name}`;
    }
  }
  for (const el of document.querySelectorAll("[data-version]"))
    if (version) el.textContent = el.closest(".dl-title") ? `v${version}` : `v${version} · `;
  const date = release.published_at ? new Date(release.published_at) : undefined;
  for (const el of document.querySelectorAll("[data-date]")) {
    if (date && !Number.isNaN(date.getTime()))
      el.textContent = `released ${date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}`;
  }
  // The button at the top offers the visitor's own system.
  const cta = document.querySelector("[data-cta]");
  const ctaText = document.querySelector("[data-cta-text]");
  const note = document.querySelector("[data-cta-note]");
  const own = mine === "other" ? undefined : files[mine].primary;
  if (cta && ctaText && own) {
    cta.setAttribute("href", own.url);
    ctaText.textContent = `Download for ${SYSTEMS[mine].name}`;
    if (note)
      note.textContent = `v${version} · ${megabytes(own.size)} · also for ${Object.values(SYSTEMS)
        .filter((s) => s.key !== mine)
        .map((s) => s.name)
        .join(" and ")}`;
  } else if (note && version) {
    note.textContent = `v${version} · macOS, Windows and Linux · free, MIT licence`;
  }
}

const KEY = "lucid-release";
function readCache() {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) || "null");
  } catch {
    return null;
  }
}
const cached = readCache();
if (cached && Date.now() - cached.at < 10 * 60 * 1000) {
  fill(cached.release);
} else if (window.fetch) {
  fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json" },
  })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((release) => {
      fill(release);
      try {
        sessionStorage.setItem(KEY, JSON.stringify({ at: Date.now(), release }));
      } catch {
        /* storage can be blocked */
      }
    })
    .catch(() => {
      /* the links stay pointed at the releases page */
    });
}
