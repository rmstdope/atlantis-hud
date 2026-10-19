import { describe, expect, it } from "vitest";
import { cutTitle, isCut } from "./cutToFit";

/**
 * ah-sgvo: a piece of the orders status line that is cut short shows its full text on hover, and a
 * piece that fits is shown exactly as before - no tooltip.
 */
describe("isCut", () => {
  it("is not cut when the text fits its box exactly", () => {
    expect(isCut(120, 120)).toBe(false);
  });

  it("is cut when the text is a pixel wider than its box", () => {
    expect(isCut(121, 120)).toBe(true);
  });

  it("is not cut when there is nothing to measure", () => {
    expect(isCut(0, 0)).toBe(false);
  });
});

describe("cutTitle", () => {
  it("is the full, uncut text while the piece is cut", () => {
    expect(cutTitle("saved 9:52:25 PM", true)).toBe("saved 9:52:25 PM");
  });

  it("is absent while the piece fits", () => {
    expect(cutTitle("6 elsewhere", false)).toBeUndefined();
  });
});
