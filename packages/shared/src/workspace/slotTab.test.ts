import { describe, expect, it } from "vitest";
import { slotTabToShow } from "./slotTab";

describe("slotTabToShow", () => {
  it("shows the unit tab when nobody has asked", () => {
    expect(slotTabToShow(null, true)).toBe("unit");
  });

  it("shows what was asked for", () => {
    expect(slotTabToShow("movement", true)).toBe("movement");
    expect(slotTabToShow("unit", true)).toBe("unit");
  });

  it("has no movement tab to show when the planner is off", () => {
    // The Movement tab is not rendered behind a switched-off flag, so nothing may resolve to it.
    expect(slotTabToShow("movement", false)).toBe("unit");
    expect(slotTabToShow(null, false)).toBe("unit");
  });
});
