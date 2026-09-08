import { describe, expect, it } from "vitest";

import { skillWords } from "./skillReading";

describe("skillWords", () => {
  it("words a standing as the level with its points closed up", () => {
    expect(skillWords({ level: 4, points: 325 })).toBe("4(325)");
    expect(skillWords({ level: 0, points: 0 })).toBe("0(0)");
  });

  it("rounds points for display", () => {
    expect(skillWords({ level: 2, points: 122.5 })).toBe("2(123)");
    expect(skillWords({ level: 2, points: 133.33333333333334 })).toBe("2(133)");
  });

  it("says the level alone when the report printed no points", () => {
    expect(skillWords({ level: 3, points: null })).toBe("3");
  });

  it("draws an arrow to a second reading", () => {
    expect(skillWords({ level: 3, points: 270 }, { level: 4, points: 300 })).toBe("3(270) → 4(300)");
  });

  it("collapses to one reading when the month does not move it", () => {
    expect(skillWords({ level: 4, points: 325 }, { level: 4, points: 325 })).toBe("4(325)");
    expect(skillWords({ level: 4, points: 325 }, { level: 4, points: 325.4 })).toBe("4(325)");
  });

  it("draws the arrow when only the level moved", () => {
    expect(skillWords({ level: 1, points: 30 }, { level: 2, points: 30 })).toBe("1(30) → 2(30)");
  });

  it("words a held reading when ends is absent or null", () => {
    const held = { level: 4, points: 325 };
    expect(skillWords(held)).toBe("4(325)");
    expect(skillWords(held, null)).toBe("4(325)");
  });
});
