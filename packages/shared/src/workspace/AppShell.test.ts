import { describe, expect, it } from "vitest";
import { isOlderTurn } from "./AppShell";

describe("isOlderTurn", () => {
  it("is older when the incoming turn is behind what is on screen", () => {
    expect(isOlderTurn(71, 2)).toBe(true);
  });

  it("is not older when the incoming turn is the same or ahead", () => {
    expect(isOlderTurn(71, 71)).toBe(false);
    expect(isOlderTurn(71, 72)).toBe(false);
  });

  it("is not older when either turn number is unknown", () => {
    expect(isOlderTurn(null, 2)).toBe(false);
    expect(isOlderTurn(71, null)).toBe(false);
    expect(isOlderTurn(undefined, 2)).toBe(false);
    expect(isOlderTurn(71, undefined)).toBe(false);
  });
});

