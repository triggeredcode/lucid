import { describe, expect, it } from "vitest";
import { defaultLmsPath, findLmStudio } from "./studio";

describe("findLmStudio", () => {
  const has =
    (...paths: string[]) =>
    (p: string) =>
      paths.includes(p);

  it("finds it in Applications, or in the person's own Applications", () => {
    expect(findLmStudio({}, has("/Applications/LM Studio.app"), "/Users/a", "darwin")).toBe(
      "/Applications/LM Studio.app",
    );
    expect(findLmStudio({}, has("/Users/a/Applications/LM Studio.app"), "/Users/a", "darwin")).toBe(
      "/Users/a/Applications/LM Studio.app",
    );
  });

  it("is undefined when it is not installed", () => {
    expect(findLmStudio({}, has(), "/Users/a", "darwin")).toBeUndefined();
    expect(findLmStudio({}, has(), "/home/a", "linux")).toBeUndefined();
    expect(findLmStudio({}, has(), "C:\\Users\\a", "win32")).toBeUndefined();
  });

  it("looks only where it is told when an address is given (for tests)", () => {
    expect(
      findLmStudio(
        { LUCID_LMSTUDIO_APP: "/x/LM.app" },
        has("/Applications/LM Studio.app", "/x/LM.app"),
        "/Users/a",
        "darwin",
      ),
    ).toBe("/x/LM.app");
    expect(
      findLmStudio(
        { LUCID_LMSTUDIO_APP: "/nowhere" },
        has("/Applications/LM Studio.app"),
        "/Users/a",
        "darwin",
      ),
    ).toBeUndefined();
  });

  it("on Windows looks in the person's programs folder, then in Program Files", () => {
    const local = "C:\\Users\\a\\AppData\\Local\\Programs\\LM Studio\\LM Studio.exe";
    expect(
      findLmStudio(
        { LOCALAPPDATA: "C:\\Users\\a\\AppData\\Local" },
        has(local),
        "C:\\Users\\a",
        "win32",
      ),
    ).toBe(local);
    expect(
      findLmStudio(
        { ProgramFiles: "D:\\Programs" },
        has("D:\\Programs\\LM Studio\\LM Studio.exe"),
        "C:\\Users\\a",
        "win32",
      ),
    ).toBe("D:\\Programs\\LM Studio\\LM Studio.exe");
  });

  it("on Linux looks in the usual install folders and on the PATH", () => {
    expect(findLmStudio({}, has("/opt/lm-studio/lm-studio"), "/home/a", "linux")).toBe(
      "/opt/lm-studio/lm-studio",
    );
    expect(
      findLmStudio(
        { PATH: "/usr/games:/home/a/bin" },
        has("/home/a/bin/lm-studio"),
        "/home/a",
        "linux",
      ),
    ).toBe("/home/a/bin/lm-studio");
  });
});

describe("defaultLmsPath", () => {
  it("is the lms tool in LM Studio's folder in the home folder, with .exe on Windows", () => {
    expect(defaultLmsPath("/Users/a", "darwin")).toBe("/Users/a/.lmstudio/bin/lms");
    expect(defaultLmsPath("/home/a", "linux")).toBe("/home/a/.lmstudio/bin/lms");
    expect(defaultLmsPath("C:\\Users\\a", "win32")).toBe("C:\\Users\\a\\.lmstudio\\bin\\lms.exe");
  });
});
