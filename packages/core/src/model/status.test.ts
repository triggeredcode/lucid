import { describe, expect, it } from "vitest";
import { STATUSES, StatusSchema, isStatus } from "./status";

describe("status", () => {
  it("has exactly normal, struck and chosen", () => {
    expect([...STATUSES]).toEqual(["normal", "struck", "chosen"]);
  });

  it("validates with zod and with the type guard", () => {
    expect(StatusSchema.parse("struck")).toBe("struck");
    expect(() => StatusSchema.parse("hidden")).toThrow();
    expect(isStatus("chosen")).toBe(true);
    expect(isStatus("crossed")).toBe(false);
    expect(isStatus(undefined)).toBe(false);
  });
});
