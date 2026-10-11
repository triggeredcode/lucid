import { describe, expect, it } from "vitest";
import { findLmStudio } from "./studio";

describe("findLmStudio", () => {
  const has =
    (...paths: string[]) =>
    (p: string) =>
      paths.includes(p);

  it("finds it in Applications, or in the person's own Applications", () => {
    expect(findLmStudio({}, has("/Applications/LM Studio.app"), "/Users/a")).toBe(
      "/Applications/LM Studio.app",
    );
    expect(findLmStudio({}, has("/Users/a/Applications/LM Studio.app"), "/Users/a")).toBe(
      "/Users/a/Applications/LM Studio.app",
    );
  });

  it("is undefined when it is not installed", () => {
    expect(findLmStudio({}, has(), "/Users/a")).toBeUndefined();
  });

  it("looks only where it is told when an address is given (for tests)", () => {
    expect(
      findLmStudio(
        { LUCID_LMSTUDIO_APP: "/x/LM.app" },
        has("/Applications/LM Studio.app", "/x/LM.app"),
      ),
    ).toBe("/x/LM.app");
    expect(
      findLmStudio({ LUCID_LMSTUDIO_APP: "/nowhere" }, has("/Applications/LM Studio.app")),
    ).toBeUndefined();
  });
});
