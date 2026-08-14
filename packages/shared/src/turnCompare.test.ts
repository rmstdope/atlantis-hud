import { describe, expect, it } from "vitest";
import { comparisonChipLabel, toggleComparison } from "./turnCompare";

describe("toggleComparison", () => {
  it("starts comparing against a different turn", () => {
    expect(toggleComparison(null, 70, 71)).toBe(70);
  });

  it("clicking the compared turn again turns the comparison off", () => {
    expect(toggleComparison(70, 70, 71)).toBe(null);
  });

  it("clicking the working turn is a no-op close", () => {
    expect(toggleComparison(70, 71, 71)).toBe(null);
    expect(toggleComparison(null, 71, 71)).toBe(null);
  });

  it("clicking a third turn switches the comparison to it", () => {
    expect(toggleComparison(70, 69, 71)).toBe(69);
  });
});

describe("comparisonChipLabel", () => {
  it("is just the working turn number when nothing is compared", () => {
    expect(comparisonChipLabel(71, null)).toEqual({ working: "71", compared: null });
  });

  it("splits into working and compared parts when a comparison is on", () => {
    expect(comparisonChipLabel(71, 70)).toEqual({ working: "71", compared: "70" });
  });
});
