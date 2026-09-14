import { aReportUnit } from "@atlantis/core-client";
import { describe, expect, it } from "vitest";
import { isCursorRow, previewAtCursor, unitAtCursor, unitCursor } from "./unitCursor";

const here = { regionId: "1:6,52", unitId: "new-1", arrivingFrom: null };
const there = { regionId: "1:8,53", unitId: "new-1", arrivingFrom: null };

describe("unitCursor", () => {
  it("is the pair, or nothing at all", () => {
    expect(
      unitCursor({ selectedUnitId: "new-1", selectedUnitRegionId: "1:6,52", selectedUnitArrivingFrom: null })
    ).toEqual(here);
    expect(
      unitCursor({ selectedUnitId: null, selectedUnitRegionId: "1:6,52", selectedUnitArrivingFrom: null })
    ).toBeNull();
    expect(
      unitCursor({ selectedUnitId: "new-1", selectedUnitRegionId: null, selectedUnitArrivingFrom: null })
    ).toBeNull();
  });

  it("carries the hex an arrival row set out from", () => {
    expect(
      unitCursor({ selectedUnitId: "new-1", selectedUnitRegionId: "1:6,52", selectedUnitArrivingFrom: "1:7,53" })
    ).toEqual({ ...here, arrivingFrom: "1:7,53" });
  });
});

describe("isCursorRow", () => {
  it("tells two hexes' same-numbered units apart", () => {
    expect(isCursorRow(there, { regionId: "1:8,53", unitId: "new-1" })).toBe(true);
    expect(isCursorRow(there, { regionId: "1:6,52", unitId: "new-1" })).toBe(false);
    expect(isCursorRow(there, { regionId: "1:8,53", unitId: "new-2" })).toBe(false);
    expect(isCursorRow(null, { regionId: "1:8,53", unitId: "new-1" })).toBe(false);
  });

  it("tells an arrival row from the same-numbered unit formed in its hex", () => {
    const arriving = { ...here, arrivingFrom: "1:7,53" };

    expect(isCursorRow(arriving, { regionId: "1:6,52", unitId: "new-1", arrivingFrom: "1:7,53" })).toBe(true);
    expect(isCursorRow(arriving, { regionId: "1:6,52", unitId: "new-1", arrivingFrom: null })).toBe(false);
    expect(isCursorRow(here, { regionId: "1:6,52", unitId: "new-1", arrivingFrom: "1:7,53" })).toBe(false);
  });
});

describe("unitAtCursor", () => {
  const reported = aReportUnit({ unitId: "new-1", regionId: "1:6,52", name: "Reported" });
  const previewed = aReportUnit({ unitId: "new-1", regionId: "1:6,52", name: "Previewed" });

  it("draws nothing when the cursor is standing in another hex", () => {
    expect(unitAtCursor(there, "1:6,52", [reported], [{ unit: previewed, arrivingFrom: null }])).toBeNull();
  });

  it("prefers the reported unit in the cursor's own hex", () => {
    expect(unitAtCursor(here, "1:6,52", [reported], [{ unit: previewed, arrivingFrom: null }])).toBe(reported);
  });

  it("finds the previewed unit for a row only arriving here", () => {
    expect(
      unitAtCursor({ ...here, arrivingFrom: "1:5,51" }, "1:6,52", [], [{ unit: previewed, arrivingFrom: "1:5,51" }])
    ).toBe(previewed);
  });

  it("draws nothing without a cursor", () => {
    expect(unitAtCursor(null, "1:6,52", [reported], [{ unit: previewed, arrivingFrom: null }])).toBeNull();
  });

  it("draws the arriving unit, not the one formed where it arrives", () => {
    const arriving = { ...here, arrivingFrom: "1:7,53" };
    const a = { unit: aReportUnit({ unitId: "new-1", regionId: "1:6,52", name: "Arriving" }), arrivingFrom: "1:7,53" };
    const b = { unit: aReportUnit({ unitId: "new-1", regionId: "1:6,52", name: "Formed here" }), arrivingFrom: null };

    expect(unitAtCursor(arriving, "1:6,52", [], [b, a])).toBe(a.unit);
    expect(unitAtCursor(here, "1:6,52", [], [b, a])).toBe(b.unit);
    expect(previewAtCursor(arriving, "1:6,52", [b, a])).toBe(a);
  });
});
