import { aReportUnit } from "@atlantis/core-client";
import { describe, expect, it } from "vitest";
import { isCursorRow, unitAtCursor, unitCursor } from "./unitCursor";

const here = { regionId: "1:6,52", unitId: "new-1" };
const there = { regionId: "1:8,53", unitId: "new-1" };

describe("unitCursor", () => {
  it("is the pair, or nothing at all", () => {
    expect(unitCursor({ selectedUnitId: "new-1", selectedUnitRegionId: "1:6,52" })).toEqual(here);
    expect(unitCursor({ selectedUnitId: null, selectedUnitRegionId: "1:6,52" })).toBeNull();
    expect(unitCursor({ selectedUnitId: "new-1", selectedUnitRegionId: null })).toBeNull();
  });
});

describe("isCursorRow", () => {
  it("tells two hexes' same-numbered units apart", () => {
    expect(isCursorRow(there, "1:8,53", "new-1")).toBe(true);
    expect(isCursorRow(there, "1:6,52", "new-1")).toBe(false);
    expect(isCursorRow(there, "1:8,53", "new-2")).toBe(false);
    expect(isCursorRow(null, "1:8,53", "new-1")).toBe(false);
  });
});

describe("unitAtCursor", () => {
  const reported = aReportUnit({ unitId: "new-1", regionId: "1:6,52", name: "Reported" });
  const previewed = aReportUnit({ unitId: "new-1", regionId: "1:6,52", name: "Previewed" });

  it("draws nothing when the cursor is standing in another hex", () => {
    expect(unitAtCursor(there, "1:6,52", [reported], [previewed])).toBeNull();
  });

  it("prefers the reported unit in the cursor's own hex", () => {
    expect(unitAtCursor(here, "1:6,52", [reported], [previewed])).toBe(reported);
  });

  it("falls back to the previewed unit for one only arriving here", () => {
    expect(unitAtCursor(here, "1:6,52", [], [previewed])).toBe(previewed);
  });

  it("draws nothing without a cursor", () => {
    expect(unitAtCursor(null, "1:6,52", [reported], [previewed])).toBeNull();
  });
});
