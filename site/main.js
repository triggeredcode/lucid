// The Lucid site. Everything here is optional: without it the page reads fine and the download links go to the releases page.
(function () {
  "use strict";
  var REPO = "triggeredcode/lucid";
  var root = document.documentElement;

  // ---- light / dark: follows the system until the visitor chooses ----
  var toggle = document.getElementById("theme");
  if (toggle) {
    toggle.addEventListener("click", function () {
      var dark = root.dataset.theme
        ? root.dataset.theme === "dark"
        : window.matchMedia("(prefers-color-scheme: dark)").matches;
      var next = dark ? "light" : "dark";
      root.dataset.theme = next;
      try {
        localStorage.setItem("lucid-theme", next);
      } catch {
        /* storage can be blocked */
      }
    });
  }

  // ---- blocks rise into view ----
  var reveals = document.querySelectorAll(".reveal");
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if ("IntersectionObserver" in window && !reduce) {
    var seen = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            seen.unobserve(e.target);
          }
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );
    reveals.forEach(function (el) {
      seen.observe(el);
    });
  } else {
    reveals.forEach(function (el) {
      el.classList.add("in");
    });
  }

  // ---- copy buttons ----
  document.querySelectorAll("[data-copy]").forEach(function (button) {
    button.addEventListener("click", function () {
      var text = button.getAttribute("data-copy") || "";
      var done = function () {
        var was = button.textContent;
        button.textContent = "Copied";
        setTimeout(function () {
          button.textContent = was;
        }, 1500);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () {});
      }
    });
  });

  // ---- the latest release: version, date, sizes and direct links ----
  function megabytes(bytes) {
    return Math.round(bytes / 1e6) + " MB"; // as Finder counts: 1 MB = 1,000,000 bytes
  }
  function fill(release) {
    var assets = release.assets || [];
    var by = {
      dmg: assets.find(function (a) {
        return /\.dmg$/.test(a.name);
      }),
      zip: assets.find(function (a) {
        return /\.zip$/.test(a.name);
      }),
      sums: assets.find(function (a) {
        return a.name === "SHA256SUMS";
      }),
    };
    document.querySelectorAll("[data-dl]").forEach(function (a) {
      var asset = by[a.getAttribute("data-dl")];
      if (asset) a.href = asset.browser_download_url;
    });
    document.querySelectorAll("[data-size]").forEach(function (el) {
      var asset = by[el.getAttribute("data-size")];
      if (asset) el.textContent = megabytes(asset.size);
    });
    var version = String(release.tag_name || "").replace(/^v/, "");
    document.querySelectorAll("[data-version]").forEach(function (el) {
      if (version)
        el.textContent = el.closest(".dl-title")
          ? "v" + version
          : "v" + version + " · Apple Silicon";
    });
    var date = release.published_at ? new Date(release.published_at) : null;
    document.querySelectorAll("[data-date]").forEach(function (el) {
      if (date && !isNaN(date)) {
        el.textContent =
          "released " +
          date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
      }
    });
  }
  var KEY = "lucid-release";
  function readCache() {
    try {
      return JSON.parse(sessionStorage.getItem(KEY) || "null");
    } catch {
      return null;
    }
  }
  var cached = readCache();
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) {
    fill(cached.release);
  } else if (window.fetch) {
    fetch("https://api.github.com/repos/" + REPO + "/releases/latest", {
      headers: { Accept: "application/vnd.github+json" },
    })
      .then(function (r) {
        return r.ok ? r.json() : Promise.reject(new Error(String(r.status)));
      })
      .then(function (release) {
        fill(release);
        try {
          sessionStorage.setItem(KEY, JSON.stringify({ at: Date.now(), release: release }));
        } catch {
          /* storage can be blocked */
        }
      })
      .catch(function () {
        /* the links stay pointed at the releases page */
      });
  }
})();
