import { describe, expect, it } from "vitest";
import type { RegionPreview, ReportUnit } from "@atlantis/core-client";
import { aReportUnit, aUnitSilver } from "@atlantis/core-client";
import { changeFor, formatItems, itemsTooltip, mergePreview, originalTooltip } from "./unitPreview";
import type { PreviewedUnit } from "./unitPreview";

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
          departingTo: null,
          aboard: null,
          uncounted: [],
          takenUnshown: [],
          produced: []
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
          departingTo: null,
          aboard: null,
          uncounted: [],
          takenUnshown: [],
          produced: []
        },
        {
          unit: unit({ unitId: "new-1", name: "Recruits" }),
          status: "formed",
          changes: [],
          arrivingFrom: null,
          departingTo: null,
          aboard: null,
          uncounted: [],
          takenUnshown: [],
          produced: []
        }
      ])
    );

    expect(rows.map((row) => row.unitId)).toEqual(["900", "777", "new-1"]);
    expect(rows[1].previewStatus).toBe("arriving");
    expect(rows[1].arrivingFrom).toBe("1:0,0");
    expect(rows[2].previewStatus).toBe("formed");
  });

  it("carries the aboard marker through to the row, on the replaced row and the appended one", () => {
    const rows = mergePreview(
      [unit({})],
      preview([
        {
          unit: unit({}),
          status: "departing",
          changes: [],
          arrivingFrom: null,
          departingTo: "1:2,2",
          aboard: "Wavecrest [329]",
          uncounted: [],
          takenUnshown: [],
          produced: []
        },
        {
          unit: unit({ unitId: "901", name: "Passengers" }),
          status: "departing",
          changes: [],
          arrivingFrom: null,
          departingTo: "1:2,2",
          aboard: "Wavecrest [329]",
          uncounted: [],
          takenUnshown: [],
          produced: []
        }
      ])
    );

    expect(rows[0].aboard).toBe("Wavecrest [329]");
    expect(rows[1].aboard).toBe("Wavecrest [329]");
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
          departingTo: "1:2,2",
          aboard: null,
          uncounted: [],
          takenUnshown: [],
          produced: []
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
          departingTo: null,
          aboard: null,
          uncounted: [],
          takenUnshown: [],
          produced: []
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

describe("formatItems and itemsTooltip", () => {
  // `ah-agbm`. Every string below is quoted verbatim in the plan and is the navigator's own
  // wording - nothing here is left for the test to word differently.
  const previewedUnit = (overrides: Partial<PreviewedUnit>): PreviewedUnit =>
    ({ ...unit({}), previewChanges: [], uncounted: [], takenUnshown: [], ...overrides }) as PreviewedUnit;

  it("formats an item list the same way the report does", () => {
    expect(
      formatItems([
        { amount: 20, name: "silver", tag: "SILV" },
        { amount: 6, name: "herbs", tag: "HERB" }
      ])
    ).toBe("20 SILV, 6 HERB");
  });

  it("words the hover for a unit that took from an unshown source and could not count an order", () => {
    const row = previewedUnit({
      items: [{ amount: 25, name: "silver", tag: "SILV" }, { amount: 6, name: "herbs", tag: "HERB" }],
      previewChanges: [{ field: "items", original: "20 SILV, 6 HERB" }],
      takenUnshown: [{ amount: 5, tag: "GRAI", from: "999" }],
      uncounted: ["buy all HORS"]
    });

    expect(itemsTooltip(row)).toBe(
      "was: 20 SILV, 6 HERB\n" +
        "Includes 5 GRAI taken from unit 999, which your report does not show here.\n" +
        "and more that cannot be counted: buy all HORS"
    );
  });

  it("words the hover for a unit whose only order cannot be counted", () => {
    const row = previewedUnit({
      items: [{ amount: 20, name: "silver", tag: "SILV" }, { amount: 6, name: "herbs", tag: "HERB" }],
      uncounted: ["buy all HORS"]
    });

    expect(itemsTooltip(row)).toBe(
      "was: 20 SILV, 6 HERB\nand more that cannot be counted: buy all HORS"
    );
  });

  it("says nothing for a unit the orders left alone", () => {
    const row = previewedUnit({ items: [{ amount: 3, name: "swords", tag: "SWOR" }] });

    expect(itemsTooltip(row)).toBeUndefined();
  });

  it("says nothing for no unit at all", () => {
    expect(itemsTooltip(undefined)).toBeUndefined();
  });

  it("words the hover for a producing unit whose run was capped", () => {
    const row = previewedUnit({
      items: [
        { amount: 5, name: "iron", tag: "IRON" },
        { amount: 350, name: "silver", tag: "SILV" }
      ],
      previewChanges: [{ field: "items", original: "5 IRON, 350 SILV" }],
      produced: [{ amount: 5, tag: "SWOR" }]
    });
    const silver = aUnitSilver({
      produced: 5,
      producedName: "sword",
      productionWanted: 8,
      productionCappedBy: "materials"
    });

    expect(itemsTooltip(row, silver)).toBe(
      "was: 5 IRON, 350 SILV\n" +
        "Includes 5 SWOR this unit will produce. Production resolves last, so they cannot be spent this month.\n" +
        "This unit has materials for 5 swords, not the 8 its men could make."
    );
  });

  it("words the hover for a producing unit at full rate", () => {
    const row = previewedUnit({
      items: [{ amount: 8, name: "swords", tag: "SWOR" }],
      previewChanges: [{ field: "items", original: "0 SWOR" }],
      produced: [{ amount: 8, tag: "SWOR" }]
    });
    const silver = aUnitSilver({
      produced: 8,
      producedName: "sword",
      productionWanted: 8,
      productionCappedBy: null
    });

    expect(itemsTooltip(row, silver)).toBe(
      "was: 0 SWOR\n" +
        "Includes 8 SWOR this unit will produce. Production resolves last, so they cannot be spent this month."
    );
  });

  it("words the hover for a unit that produces nothing at all", () => {
    const row = previewedUnit({ items: [{ amount: 3, name: "swords", tag: "SWOR" }] });
    const silver = aUnitSilver({
      produced: 0,
      producedName: "catapult",
      productionWanted: 3,
      productionCappedBy: "materials"
    });

    expect(itemsTooltip(row, silver)).toBe(
      "was: 3 SWOR\nThis unit has materials for 0 catapults, not the 3 its men could make."
    );
  });
});
