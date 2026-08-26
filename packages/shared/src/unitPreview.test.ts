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
          produced: [],
          built: [],
          created: []
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
          produced: [],
          built: [],
          created: []
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
          produced: [],
          built: [],
          created: []
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
          produced: [],
          built: [],
          created: []
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
          produced: [],
          built: [],
          created: []
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
          produced: [],
          built: [],
          created: []
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
          produced: [],
          built: [],
          created: []
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

  // `ah-jown`. Positioned after a `produced` line and before a production cap sentence, for the
  // same turn-order reason the core settles a `BUY ALL` before the market's own PRODUCE phase.
  it("says what a BUY ALL bought and what stopped it", () => {
    const row = previewedUnit({
      items: [{ amount: 19, name: "grain", tag: "GRAI" }],
      previewChanges: [{ field: "items", original: "0 GRAI" }],
      produced: [{ amount: 5, tag: "SWOR" }]
    });
    const silver = aUnitSilver({
      produced: 5,
      producedName: "sword",
      productionWanted: 8,
      productionCappedBy: "materials",
      buyAll: [
        {
          boughtNamed: "19 grain",
          marketNamed: "30 grain",
          bought: 19,
          affordable: 19,
          available: 30,
          marketHas: 30,
          silverAvailable: 356,
          price: 18,
          cappedBy: "silver"
        }
      ]
    });

    expect(itemsTooltip(row, silver)).toBe(
      "was: 0 GRAI\n" +
        "Includes 5 SWOR this unit will produce. Production resolves last, so they cannot be spent this month.\n" +
        "This unit has silver for 19 grain, not the 30 this market offers.\n" +
        "This unit has materials for 5 swords, not the 8 its men could make."
    );
  });

  // `ah-ofpb.2`. Every string below is quoted verbatim in the plan and is the navigator's own
  // wording - nothing here is left for the test to word differently.

  it("words the hover for a unit building at full rate", () => {
    const row = previewedUnit({
      items: [
        { amount: 10, name: "humans", tag: "HUMN" },
        { amount: 120, name: "wood", tag: "WOOD" }
      ],
      built: [
        {
          amount: 30,
          tag: "WOOD",
          name: "wood",
          place: "Building 4",
          founding: false,
          helping: null,
          couldDo: 30,
          cappedBy: null
        }
      ]
    });

    expect(itemsTooltip(row)).toBe(
      "was: 10 HUMN, 120 WOOD\nSpends 30 WOOD on Building 4 this month."
    );
  });

  it("words the hover for a builder short of material", () => {
    const row = previewedUnit({
      items: [{ amount: 15, name: "wood", tag: "WOOD" }],
      built: [
        {
          amount: 15,
          tag: "WOOD",
          name: "wood",
          place: "Building 4",
          founding: false,
          helping: null,
          couldDo: 30,
          cappedBy: "materials"
        }
      ]
    });

    expect(itemsTooltip(row)).toBe(
      "was: 15 WOOD\n" +
        "Spends 15 WOOD on Building 4 this month.\n" +
        "This unit has wood for 15 units of work, not the 30 its men could do."
    );
  });

  it("words the hover for a builder on a nearly finished structure", () => {
    const row = previewedUnit({
      items: [{ amount: 120, name: "wood", tag: "WOOD" }],
      built: [
        {
          amount: 6,
          tag: "WOOD",
          name: "wood",
          place: "Guild Hall",
          founding: false,
          helping: null,
          couldDo: 30,
          cappedBy: "needs"
        }
      ]
    });

    expect(itemsTooltip(row)).toBe(
      "was: 120 WOOD\n" +
        "Spends 6 WOOD on Guild Hall this month.\n" +
        "Guild Hall needs 6 more units of work, not the 30 its men could do."
    );
  });

  it("words the hover for a unit founding a structure", () => {
    const row = previewedUnit({
      items: [{ amount: 120, name: "wood", tag: "WOOD" }],
      built: [
        {
          amount: 30,
          tag: "WOOD",
          name: "wood",
          place: "Stockade",
          founding: true,
          helping: null,
          couldDo: 30,
          cappedBy: null
        }
      ]
    });

    expect(itemsTooltip(row)).toBe(
      "was: 120 WOOD\nSpends 30 WOOD on a new Stockade this month."
    );
  });

  it("words the hover for a unit founding a structure it cannot finish this month", () => {
    const row = previewedUnit({
      items: [{ amount: 120, name: "stone", tag: "STON" }],
      built: [
        {
          amount: 10,
          tag: "STON",
          name: "stone",
          place: "Tower",
          founding: true,
          helping: null,
          couldDo: 30,
          cappedBy: "needs"
        }
      ]
    });

    expect(itemsTooltip(row)).toBe(
      "was: 120 STON\n" +
        "Spends 10 STON on a new Tower this month.\n" +
        "A new Tower needs 10 units of work, not the 30 its men could do."
    );
  });

  it("words the hover for a unit helping another build", () => {
    const row = previewedUnit({
      items: [{ amount: 120, name: "wood", tag: "WOOD" }],
      built: [
        {
          amount: 30,
          tag: "WOOD",
          name: "wood",
          place: "Building 4",
          founding: false,
          helping: "5541",
          couldDo: 30,
          cappedBy: null
        }
      ]
    });

    expect(itemsTooltip(row)).toBe(
      "was: 120 WOOD\nSpends 30 WOOD helping unit 5541 build Building 4 this month."
    );
  });

  it("words the hover for a unit helping another found a structure", () => {
    const row = previewedUnit({
      items: [{ amount: 120, name: "wood", tag: "WOOD" }],
      built: [
        {
          amount: 30,
          tag: "WOOD",
          name: "wood",
          place: "Tower",
          founding: true,
          helping: "5541",
          couldDo: 30,
          cappedBy: null
        }
      ]
    });

    expect(itemsTooltip(row)).toBe(
      "was: 120 WOOD\nSpends 30 WOOD helping unit 5541 build a new Tower this month."
    );
  });

  it("puts the build lines after the production lines", () => {
    const row = previewedUnit({
      items: [
        { amount: 5, name: "iron", tag: "IRON" },
        { amount: 15, name: "wood", tag: "WOOD" }
      ],
      previewChanges: [{ field: "items", original: "5 IRON, 30 WOOD" }],
      produced: [{ amount: 5, tag: "SWOR" }],
      built: [
        {
          amount: 15,
          tag: "WOOD",
          name: "wood",
          place: "Building 4",
          founding: false,
          helping: null,
          couldDo: 30,
          cappedBy: "materials"
        }
      ]
    });
    const silver = aUnitSilver({
      produced: 5,
      producedName: "sword",
      productionWanted: 8,
      productionCappedBy: "materials"
    });

    expect(itemsTooltip(row, silver)).toBe(
      "was: 5 IRON, 30 WOOD\n" +
        "Includes 5 SWOR this unit will produce. Production resolves last, so they cannot be spent this month.\n" +
        "This unit has materials for 5 swords, not the 8 its men could make.\n" +
        "Spends 15 WOOD on Building 4 this month.\n" +
        "This unit has wood for 15 units of work, not the 30 its men could do."
    );
  });

  // `ah-ofpb.5`: a CAST's chance creation shows as a range, merged into whatever the unit already
  // holds - round 1's Q1 and Q4.
  it("shows a chance creation as a range", () => {
    expect(
      formatItems(
        [{ amount: 3, name: "runesword", tag: "RUNE" }],
        [{ fewest: 2, most: 3, tag: "RUNE", summoned: false }]
      )
    ).toBe("2-3 RUNE");
  });

  it("merges a range into a stock already held", () => {
    expect(
      formatItems(
        [{ amount: 5, name: "runesword", tag: "RUNE" }],
        [{ fewest: 2, most: 3, tag: "RUNE", summoned: false }]
      )
    ).toBe("4-5 RUNE");
  });

  it("shows a certain creation as one number", () => {
    expect(
      formatItems(
        [{ amount: 15, name: "mithril sword", tag: "MSWO" }],
        [{ fewest: 15, most: 15, tag: "MSWO", summoned: false }]
      )
    ).toBe("15 MSWO");
  });

  // Round 2's Q6, V3, quoted verbatim.
  it("words the hover for a casting unit", () => {
    const row = previewedUnit({
      items: [{ amount: 15, name: "mithril sword", tag: "MSWO" }],
      previewChanges: [{ field: "items", original: "0 MSWO" }],
      created: [{ fewest: 15, most: 15, tag: "MSWO", summoned: false }]
    });

    expect(itemsTooltip(row)).toBe(
      "was: 0 MSWO\n" +
        "Includes 15 MSWO this unit will create by casting. Casting resolves after GIVE, so they " +
        "cannot be given away this month."
    );
  });

  // Round 3's Q11, S2, quoted verbatim.
  it("words the hover for a summoning unit", () => {
    const row = previewedUnit({
      items: [{ amount: 12, name: "wolf", tag: "WOLF" }],
      previewChanges: [{ field: "items", original: "0 WOLF" }],
      created: [{ fewest: 1, most: 12, tag: "WOLF", summoned: true }]
    });

    expect(itemsTooltip(row)).toBe(
      "was: 0 WOLF\n" +
        "Includes 1-12 WOLF this unit will summon. Casting resolves after GIVE, so they cannot be " +
        "given away this month."
    );
  });

  // `ah-ofpb.1`'s K1, extended to casts by `ah-ofpb.5`'s round 3 Q12: the ITEMS hover repeats the
  // same cap sentence the SILVER hover already gives.
  it("repeats the cast cap sentence in the ITEMS hover", () => {
    const row = previewedUnit({
      items: [{ amount: 6, name: "wolf", tag: "WOLF" }],
      previewChanges: [{ field: "items", original: "30 WOLF" }]
    });
    const silver = aUnitSilver({
      castMade: 6,
      castMadeNamed: "6 wolves",
      castWanted: 12,
      castCappedBy: "room",
      castSummons: true
    });

    expect(itemsTooltip(row, silver)).toBe(
      "was: 30 WOLF\nThis unit has room for 6 wolves, not the 12 its level could summon."
    );
  });
});
