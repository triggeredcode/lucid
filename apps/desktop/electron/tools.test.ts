import { describe, expect, it } from "vitest";
import { programName, resolveTectonic } from "./tools";

const have = (...paths: string[]) => ({
  exists: (p: string) => paths.includes(p),
});
const mac = { platform: "darwin", pathEnv: "" } as const;

describe("resolveTectonic", () => {
  it("uses the program the person chose, even if it is not there (so the message names it)", () => {
    expect(
      resolveTectonic("/custom/tectonic", { resourcesDir: "/app/resources", ...have(), ...mac }),
    ).toBe("/custom/tectonic");
  });

  it("prefers the one that comes with Lucid", () => {
    expect(
      resolveTectonic("", {
        resourcesDir: "/app/resources",
        ...have("/app/resources/bin/tectonic", "/opt/homebrew/bin/tectonic"),
        ...mac,
      }),
    ).toBe("/app/resources/bin/tectonic");
  });

  it("then looks in the usual places, then on the PATH", () => {
    expect(
      resolveTectonic("", {
        resourcesDir: "/app/resources",
        ...have("/opt/homebrew/bin/tectonic"),
        ...mac,
      }),
    ).toBe("/opt/homebrew/bin/tectonic");
    expect(
      resolveTectonic("", {
        resourcesDir: "/app/resources",
        ...have("/usr/local/bin/tectonic"),
        ...mac,
      }),
    ).toBe("/usr/local/bin/tectonic");
    expect(
      resolveTectonic("", {
        ...mac,
        resourcesDir: "/app/resources",
        pathEnv: "/nope:/home/me/bin",
        ...have("/home/me/bin/tectonic"),
      }),
    ).toBe("/home/me/bin/tectonic");
  });

  it("falls back to the plain name, which says it was not found when the engine is started", () => {
    expect(
      resolveTectonic("", {
        ...mac,
        resourcesDir: "/app/resources",
        pathEnv: "/nope",
        ...have(),
      }),
    ).toBe("tectonic");
    expect(resolveTectonic("  ", { ...have(), ...mac })).toBe("tectonic");
  });

  it("on Linux looks in /usr/local/bin and /usr/bin, and uses the program that comes with Lucid first", () => {
    const linux = { platform: "linux", pathEnv: "" } as const;
    expect(
      resolveTectonic("", {
        resourcesDir: "/opt/Lucid/resources",
        ...have("/opt/Lucid/resources/bin/tectonic", "/usr/bin/tectonic"),
        ...linux,
      }),
    ).toBe("/opt/Lucid/resources/bin/tectonic");
    expect(resolveTectonic("", { ...have("/usr/bin/tectonic"), ...linux })).toBe(
      "/usr/bin/tectonic",
    );
    // Homebrew's folder is a Mac thing.
    expect(resolveTectonic("", { ...have("/opt/homebrew/bin/tectonic"), ...linux })).toBe(
      "tectonic",
    );
  });

  it("on Windows looks for tectonic.exe, with Windows paths and a semicolon-separated PATH", () => {
    const win = { platform: "win32" } as const;
    const bundled = "C:\\Users\\a\\AppData\\Local\\Programs\\Lucid\\resources\\bin\\tectonic.exe";
    expect(
      resolveTectonic("", {
        resourcesDir: "C:\\Users\\a\\AppData\\Local\\Programs\\Lucid\\resources",
        ...have(bundled),
        ...win,
      }),
    ).toBe(bundled);
    expect(
      resolveTectonic("", {
        pathEnv: "C:\\Windows;C:\\tools",
        ...have("C:\\tools\\tectonic.exe"),
        ...win,
      }),
    ).toBe("C:\\tools\\tectonic.exe");
  });
});

describe("programName", () => {
  it("adds .exe on Windows only", () => {
    expect(programName("tectonic", "win32")).toBe("tectonic.exe");
    expect(programName("tectonic", "linux")).toBe("tectonic");
    expect(programName("lms", "darwin")).toBe("lms");
  });
});
