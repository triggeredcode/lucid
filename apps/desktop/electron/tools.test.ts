import { describe, expect, it } from "vitest";
import { resolveTectonic } from "./tools";

const have = (...paths: string[]) => ({
  exists: (p: string) => paths.includes(p),
});

describe("resolveTectonic", () => {
  it("uses the program the person chose, even if it is not there (so the message names it)", () => {
    expect(resolveTectonic("/custom/tectonic", { resourcesDir: "/app/resources", ...have() })).toBe(
      "/custom/tectonic",
    );
  });

  it("prefers the one that comes with Lucid", () => {
    expect(
      resolveTectonic("", {
        resourcesDir: "/app/resources",
        ...have("/app/resources/bin/tectonic", "/opt/homebrew/bin/tectonic"),
      }),
    ).toBe("/app/resources/bin/tectonic");
  });

  it("then looks in the usual places, then on the PATH", () => {
    expect(
      resolveTectonic("", {
        resourcesDir: "/app/resources",
        ...have("/opt/homebrew/bin/tectonic"),
      }),
    ).toBe("/opt/homebrew/bin/tectonic");
    expect(
      resolveTectonic("", { resourcesDir: "/app/resources", ...have("/usr/local/bin/tectonic") }),
    ).toBe("/usr/local/bin/tectonic");
    expect(
      resolveTectonic("", {
        resourcesDir: "/app/resources",
        pathEnv: "/nope:/home/me/bin",
        ...have("/home/me/bin/tectonic"),
      }),
    ).toBe("/home/me/bin/tectonic");
  });

  it("falls back to the plain name, which says it was not found when the engine is started", () => {
    expect(
      resolveTectonic("", { resourcesDir: "/app/resources", pathEnv: "/nope", ...have() }),
    ).toBe("tectonic");
    expect(resolveTectonic("  ", { ...have() })).toBe("tectonic");
  });
});
