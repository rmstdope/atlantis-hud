import { describe, expect, it } from "vitest";
import { nextOwnUnit } from "./unitCycle";

const UNITS = ["100", "200", "300"] as const;

describe("nextOwnUnit", () => {
  it("steps forward through the faction's units in their given order", () => {
    expect(nextOwnUnit(UNITS, "100", 1)).toBe("200");
    expect(nextOwnUnit(UNITS, "200", 1)).toBe("300");
  });

  it("steps backward the same way", () => {
    expect(nextOwnUnit(UNITS, "300", -1)).toBe("200");
  });

  it("wraps at both ends, so the walk never dead-ends", () => {
    expect(nextOwnUnit(UNITS, "300", 1)).toBe("100");
    expect(nextOwnUnit(UNITS, "100", -1)).toBe("300");
  });

  it("starts from the first or last unit when nothing is selected", () => {
    expect(nextOwnUnit(UNITS, null, 1)).toBe("100");
    expect(nextOwnUnit(UNITS, null, -1)).toBe("300");
  });

  it("treats a selected unit outside the list - a foreign unit - like no selection", () => {
    expect(nextOwnUnit(UNITS, "999", 1)).toBe("100");
    expect(nextOwnUnit(UNITS, "999", -1)).toBe("300");
  });

  it("answers null with no units to walk", () => {
    expect(nextOwnUnit([], "100", 1)).toBeNull();
    expect(nextOwnUnit([], null, -1)).toBeNull();
  });

  it("stands still in a faction of one", () => {
    expect(nextOwnUnit(["100"], "100", 1)).toBe("100");
  });
});
