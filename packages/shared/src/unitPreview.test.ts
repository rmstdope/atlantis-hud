import { describe, expect, it } from "vitest";
import type { RegionPreview, ReportUnit } from "@atlantis/core-client";
import { aReportUnit } from "@atlantis/core-client";
import { changeFor, mergePreview, originalTooltip } from "./unitPreview";

const unit = (overrides: Partial<ReportUnit>): ReportUnit =>
  aReportUnit({ unitId: "900", name: "Walker", weight: 10, capacity: "0/0/15/0", ...overrides });

const preview = (units: RegionPreview["units"]): RegionPreview => ({
  regionId: "1:1,1",
  units
});

describe("mergePreview", () => {
  it("replaces a changed unit's row with its predicted state, marks kept", () => {
    const rows = mergePreview(
      [unit({}), unit({ unitId: "901", name: "Bystander" })],
      preview([
        {
          unit: unit({ name: "Renamed" }),
          status: "present",
          changes: [{ field: "name", original: "Walker" }],
          arrivingFrom: null,
          departingTo: null
        }
      ])
    );

    expect(rows).toHaveLength(2);
    expect(rows[0].name).toBe("Renamed");
    expect(rows[0].previewStatus).toBe("present");
    expect(rows[0].previewChanges).toEqual([{ field: "name", original: "Walker" }]);
  });

  it("leaves untouched units as the very same objects, so memoized rows survive", () => {
    const untouched = unit({ unitId: "901", name: "Bystander" });
    const rows = mergePreview([unit({}), untouched], null);

    expect(rows[1]).toBe(untouched);
  });

  it("appends arriving and formed units the report has no rows for", () => {
    const rows = mergePreview(
      [unit({})],
      preview([
        {
          unit: unit({ unitId: "777", name: "Newcomer", regionId: "1:1,1" }),
          status: "arriving",
          changes: [],
          arrivingFrom: "1:0,0",
          departingTo: null
        },
        {
          unit: unit({ unitId: "new-1", name: "Recruits" }),
          status: "formed",
          changes: [],
          arrivingFrom: null,
          departingTo: null
        }
      ])
    );

    expect(rows.map((row) => row.unitId)).toEqual(["900", "777", "new-1"]);
    expect(rows[1].previewStatus).toBe("arriving");
    expect(rows[1].arrivingFrom).toBe("1:0,0");
    expect(rows[2].previewStatus).toBe("formed");
  });

  it("carries a departing unit's destination onto its row", () => {
    const rows = mergePreview(
      [unit({})],
      preview([
        {
          unit: unit({}),
          status: "departing",
          changes: [],
          arrivingFrom: null,
          departingTo: "1:2,2"
        }
      ])
    );

    expect(rows[0].previewStatus).toBe("departing");
    expect(rows[0].departingTo).toBe("1:2,2");
  });
});

describe("changeFor and originalTooltip", () => {
  it("finds the change for a field and words the tooltip", () => {
    const rows = mergePreview(
      [unit({})],
      preview([
        {
          unit: unit({ name: "Renamed", structureId: "4" }),
          status: "present",
          changes: [
            { field: "name", original: "Walker" },
            { field: "structureId", original: "" }
          ],
          arrivingFrom: null,
          departingTo: null
        }
      ])
    );

    const name = changeFor(rows[0], "name");
    expect(name).toEqual({ field: "name", original: "Walker" });
    expect(originalTooltip(name)).toBe("was: Walker");
    // An original the report never had reads as absence rather than as an empty string.
    expect(originalTooltip(changeFor(rows[0], "structureId"))).toBe("was: —");
    expect(changeFor(rows[0], "men")).toBeUndefined();
  });
});
