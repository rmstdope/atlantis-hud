import { describe, expect, it } from "vitest";

import { compareUnitIds, idNumber } from "./unitOrder";

describe("compareUnitIds", () => {
  it("orders ids as numbers, so nine comes before ten", () => {
    expect(["10", "9", "100"].sort(compareUnitIds)).toEqual(["9", "10", "100"]);
  });

  it("puts a formed unit's placeholder id after every numbered one", () => {
    expect(["new-2", "10", "new-1", "9"].sort(compareUnitIds)).toEqual([
      "9",
      "10",
      "new-1",
      "new-2"
    ]);
  });

  it("orders two placeholders by the string, so the report's order never shows through", () => {
    expect(["new-2", "new-10"].sort(compareUnitIds)).toEqual(["new-10", "new-2"]);
  });
});

describe("idNumber", () => {
  it("reads a decimal id as a number and everything else as null", () => {
    expect(idNumber("0042")).toBe(42);
    expect(idNumber("")).toBeNull();
    expect(idNumber("   ")).toBeNull();
    expect(idNumber("new-1")).toBeNull();
    expect(idNumber(null)).toBeNull();
  });
});
