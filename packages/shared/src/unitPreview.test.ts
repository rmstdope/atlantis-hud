import { describe, expect, it } from "vitest";
import type {
  OrdersPreviewResponse,
  RegionPreview,
  ReportUnit,
  TransportTargetIssue
} from "@atlantis/core-client";
import { aReportUnit, aUnitSilver } from "@atlantis/core-client";
import {
  changeFor,
  formatItems,
  hasUncertainTransportTarget,
  itemsTooltip,
  mergePreview,
  dissolves,
  mergePreviewAcross,
  originalTooltip,
  transportSentences,
  transportTargetSentence,
  transportTargetUncertain
} from "./unitPreview";
import type { PreviewedUnit } from "./unitPreview";

const unit = (overrides: Partial<ReportUnit>): ReportUnit =>
  aReportUnit({ unitId: "900", name: "Walker", weight: 10, capacity: "0/0/15/0", ...overrides });

const preview = (units: RegionPreview["units"]): RegionPreview => ({
  regionId: "1:1,1",
  units
});

/** One previewed unit, with every field the wire carries defaulted. */
const previewedRow = (
  unitOverrides: Partial<ReportUnit>,
  overrides: Partial<RegionPreview["units"][number]> = {}
): RegionPreview["units"][number] => ({
  unit: unit(unitOverrides),
  status: "present",
  changes: [],
  arrivingFrom: null,
  departingTo: null,
  aboard: null,
  uncounted: [],
  takenUnshown: [],
  produced: [],
  built: [],
  created: [],
  transportSent: [],
  transportReceived: [],
  transportTargetIssues: [],
  dissolvesInto: null,
  formed: false,
  dissolving: false,
  ...overrides
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
          created: [],
          transportSent: [],
          transportReceived: [],
          transportTargetIssues: [],
          dissolvesInto: null,
          formed: false,
          dissolving: false
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
          created: [],
          transportSent: [],
          transportReceived: [],
          transportTargetIssues: [],
          dissolvesInto: null,
          formed: false,
          dissolving: false
        },
        {
          unit: unit({ unitId: "new-1", name: "Recruits" }),
          status: "present",
          changes: [],
          arrivingFrom: null,
          departingTo: null,
          aboard: null,
          uncounted: [],
          takenUnshown: [],
          produced: [],
          built: [],
          created: [],
          transportSent: [],
          transportReceived: [],
          transportTargetIssues: [],
          dissolvesInto: null,
          formed: true,
          dissolving: false
        }
      ])
    );

    expect(rows.map((row) => row.unitId)).toEqual(["900", "777", "new-1"]);
    expect(rows[1].previewStatus).toBe("arriving");
    expect(rows[1].arrivingFrom).toBe("1:0,0");
    expect(rows[2].formed).toBe(true);
    expect(rows[2].previewStatus).toBe("present");
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
          created: [],
          transportSent: [],
          transportReceived: [],
          transportTargetIssues: [],
          dissolvesInto: null,
          formed: false,
          dissolving: false
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
          created: [],
          transportSent: [],
          transportReceived: [],
          transportTargetIssues: [],
          dissolvesInto: null,
          formed: false,
          dissolving: false
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
          created: [],
          transportSent: [],
          transportReceived: [],
          transportTargetIssues: [],
          dissolvesInto: null,
          formed: false,
          dissolving: false
        }
      ])
    );

    expect(rows[0].previewStatus).toBe("departing");
    expect(rows[0].departingTo).toBe("1:2,2");
  });
  it("a dissolving row keeps its status and the unit its goods revert to", () => {
    const rows = mergePreview(
      [unit({})],
      preview([
        previewedRow(
          { unitId: "new-1", name: "new 1" },
          { formed: true, dissolving: true, dissolvesInto: "Tax Collector (1922)" }
        )
      ])
    );

    const dissolving = rows.find((row) => row.unitId === "new-1");
    expect(dissolving?.dissolving).toBe(true);
    expect(dissolving?.formed).toBe(true);
    expect(dissolving?.dissolvesInto).toBe("Tax Collector (1922)");
    expect(dissolves(dissolving as PreviewedUnit)).toBe(true);
    expect(dissolves(rows[0])).toBe(false);
  });
});

describe("mergePreviewAcross", () => {
  const across = (regions: RegionPreview[]): OrdersPreviewResponse => ({ regions });

  it("lists a unit that moves once, on the row the report gave it", () => {
    const mover = unit({ unitId: "5105", name: "MinersA", regionId: "1:36,4" });
    const rows = mergePreviewAcross(
      [mover, unit({ unitId: "8452", name: "Stayer", regionId: "1:36,4" })],
      across([
        {
          regionId: "1:36,4",
          units: [
            previewedRow(
              { unitId: "5105", name: "MinersA", regionId: "1:36,4" },
              { status: "departing", departingTo: "1:35,3" }
            )
          ]
        },
        {
          regionId: "1:35,3",
          units: [
            previewedRow(
              { unitId: "5105", name: "MinersA", regionId: "1:35,3" },
              { status: "arriving", arrivingFrom: "1:36,4" }
            )
          ]
        }
      ])
    );

    const mine = rows.filter((row) => row.unitId === "5105");
    expect(mine).toHaveLength(1);
    expect(mine[0].regionId).toBe("1:36,4");
    expect(mine[0].previewStatus).toBe("departing");
    expect(mine[0].departingTo).toBe("1:35,3");
  });

  it("keeps a departure whose destination the trace could not name", () => {
    const rows = mergePreviewAcross(
      [unit({ unitId: "5105", regionId: "1:36,4" })],
      across([
        {
          regionId: "1:36,4",
          units: [
            previewedRow({ unitId: "5105", regionId: "1:36,4" }, { status: "departing", departingTo: null })
          ]
        }
      ])
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].previewStatus).toBe("departing");
    expect(rows[0].departingTo).toBeNull();
  });

  it("gives each hex its own unit when two hexes form the same alias", () => {
    const rows = mergePreviewAcross(
      [unit({ unitId: "8452", regionId: "1:36,4" })],
      across([
        {
          regionId: "1:36,4",
          units: [
            previewedRow(
              { unitId: "new-1", name: "Unit (new 1)", regionId: "1:36,4" },
              { formed: true }
            )
          ]
        },
        {
          regionId: "1:7,53",
          units: [
            previewedRow(
              { unitId: "new-1", name: "Unit (new 1)", regionId: "1:7,53" },
              { formed: true }
            )
          ]
        }
      ])
    );

    const formed = rows.filter((row) => row.unitId === "new-1");
    expect(formed).toHaveLength(2);
    expect(formed.map((row) => row.regionId).sort()).toEqual(["1:36,4", "1:7,53"]);
  });

  it("appends a unit the report has no row for", () => {
    const rows = mergePreviewAcross(
      [unit({ unitId: "8452", regionId: "1:36,4" })],
      across([
        {
          regionId: "1:36,4",
          units: [
            previewedRow({ unitId: "new-1", name: "Unit (new 1)", regionId: "1:36,4" }, { formed: true })
          ]
        }
      ])
    );

    const formed = rows.find((row) => row.unitId === "new-1");
    expect(formed?.formed).toBe(true);
    expect(formed?.previewStatus).toBe("present");
  });

  it("lists a formed unit that walks away once, on the row it was formed in", () => {
    const rows = mergePreviewAcross(
      [unit({ unitId: "18642", regionId: "1:7,53" })],
      across([
        {
          regionId: "1:7,53",
          units: [
            previewedRow(
              { unitId: "new-1", name: "Unit (new 1)", regionId: "1:7,53" },
              { formed: true, status: "departing", departingTo: "1:7,51" }
            )
          ]
        },
        {
          regionId: "1:7,51",
          units: [
            previewedRow(
              { unitId: "new-1", name: "Unit (new 1)", regionId: "1:7,51" },
              { formed: true, status: "arriving", arrivingFrom: "1:7,53" }
            )
          ]
        }
      ])
    );

    // The arriving twin is dropped like any other, so the unit appears once (`ah-4hux`).
    const formed = rows.filter((row) => row.unitId === "new-1");
    expect(formed).toHaveLength(1);
    expect(formed[0].regionId).toBe("1:7,53");
    expect(formed[0].formed).toBe(true);
    expect(formed[0].previewStatus).toBe("departing");
    expect(formed[0].departingTo).toBe("1:7,51");
  });

  it("folds changes into units in more than one hex", () => {
    const rows = mergePreviewAcross(
      [unit({ unitId: "5105", regionId: "1:36,4" }), unit({ unitId: "2418", regionId: "1:7,53" })],
      across([
        {
          regionId: "1:36,4",
          units: [
            previewedRow(
              { unitId: "5105", regionId: "1:36,4", items: [{ amount: 2, tag: "SILV", name: "silver" }] },
              { changes: [{ field: "items", original: "" }] }
            )
          ]
        },
        {
          regionId: "1:7,53",
          units: [
            previewedRow(
              { unitId: "2418", regionId: "1:7,53", items: [{ amount: 1, tag: "PERF", name: "perfume" }] },
              { changes: [{ field: "items", original: "" }] }
            )
          ]
        }
      ])
    );

    expect(rows.find((row) => row.unitId === "5105")?.previewChanges).toHaveLength(1);
    expect(rows.find((row) => row.unitId === "2418")?.previewChanges).toHaveLength(1);
  });

  it("hands back the very same list when the orders change nothing", () => {
    const units = [unit({}), unit({ unitId: "901" })];

    expect(mergePreviewAcross(units, null)).toBe(units);
    expect(mergePreviewAcross(units, { regions: [] })).toBe(units);
    expect(mergePreviewAcross(units, { regions: [{ regionId: "1:1,1", units: [] }] })).toBe(units);
  });

  it("hands back the very same list when every previewed row is an arrival", () => {
    const units = [unit({ unitId: "5105", regionId: "1:36,4" })];
    const rows = mergePreviewAcross(
      units,
      across([
        {
          regionId: "1:35,3",
          units: [
            previewedRow({ unitId: "7000", regionId: "1:35,3" }, { status: "arriving", arrivingFrom: "1:34,2" })
          ]
        }
      ])
    );

    expect(rows).toBe(units);
  });

  it("a dissolving row reaches All my units, where an arriving one does not", () => {
    const units = [unit({ unitId: "902", regionId: "1:1,1" })];
    const rows = mergePreviewAcross(
      units,
      across([
        {
          regionId: "1:1,1",
          units: [
            previewedRow(
              { unitId: "new-1", name: "new 1", regionId: "1:1,1" },
              { formed: true, dissolving: true, dissolvesInto: "Former (902)" }
            ),
            previewedRow({ unitId: "7000", regionId: "1:1,1" }, { status: "arriving", arrivingFrom: "1:2,2" })
          ]
        }
      ])
    );

    expect(rows.map((row) => row.unitId)).toEqual(["902", "new-1"]);
    expect(dissolves(rows[1])).toBe(true);
  });

  it("leaves an untouched unit as the very same object", () => {
    const bystander = unit({ unitId: "901", name: "Bystander" });
    const rows = mergePreviewAcross(
      [unit({}), bystander],
      across([
        {
          regionId: "1:1,1",
          units: [previewedRow({ name: "Renamed" }, { changes: [{ field: "name", original: "Walker" }] })]
        }
      ])
    );

    expect(rows[1]).toBe(bystander);
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
          created: [],
          transportSent: [],
          transportReceived: [],
          transportTargetIssues: [],
          dissolvesInto: null,
          formed: false,
          dissolving: false
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

  it("says the men left before production, above the materials sentence", () => {
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
      productionCappedBy: "materials",
      productionMenLeft: 3
    });

    expect(itemsTooltip(row, silver)).toBe(
      "was: 5 IRON, 350 SILV\n" +
        "Includes 5 SWOR this unit will produce. Production resolves late, so this unit cannot give them away or sell them this month.\n" +
        "This unit has men for 5 swords: GIVE and TAKE resolve before production, so the men that leave it this month do not work for it.\n" +
        "This unit has materials for 5 swords, not the 8 its skill and tools could make."
    );
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
        "Includes 5 SWOR this unit will produce. Production resolves late, so this unit cannot give them away or sell them this month.\n" +
        "This unit has materials for 5 swords, not the 8 its skill and tools could make."
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
        "Includes 8 SWOR this unit will produce. Production resolves late, so this unit cannot give them away or sell them this month."
    );
  });

  // `ah-6x5u`. The same two lines the SILVER hover shows, in the same words and from the same
  // helper: `rules/produce` says a numbered order attempts exactly the number it names and carries
  // the rest over, and the navigator chose to show that in both places (decision 8).
  it("shows_numbered_production_in_the_items_hover", () => {
    const row = previewedUnit({
      items: [
        { amount: 12, name: "iron", tag: "IRON" },
        { amount: 8, name: "swords", tag: "SWOR" }
      ],
      previewChanges: [{ field: "items", original: "20 IRON" }],
      produced: [{ amount: 8, tag: "SWOR" }]
    });
    const silver = aUnitSilver({
      produced: 8,
      producedName: "sword",
      productionWanted: 8,
      productionRequested: 10,
      productionCappedBy: "workforce"
    });

    expect(itemsTooltip(row, silver)).toBe(
      "was: 20 IRON\n" +
        "Includes 8 SWOR this unit will produce. Production resolves late, so this unit cannot give them away or sell them this month.\n" +
        "Requested: 10 swords. This month: 8.\n" +
        "Limited by skill and tools. The remaining 2 carry over."
    );
  });

  // A numbered order that fits exactly still says so, which is the one case with no cap to explain
  // it - so the hover must not fall silent the way the unnumbered one does.
  it("shows an exact numbered run in the items hover as well", () => {
    const row = previewedUnit({
      items: [{ amount: 3, name: "swords", tag: "SWOR" }],
      previewChanges: [{ field: "items", original: "0 SWOR" }],
      produced: [{ amount: 3, tag: "SWOR" }]
    });
    const silver = aUnitSilver({
      produced: 3,
      producedName: "sword",
      productionWanted: 8,
      productionRequested: 3,
      productionCappedBy: null
    });

    expect(itemsTooltip(row, silver)).toBe(
      "was: 0 SWOR\n" +
        "Includes 3 SWOR this unit will produce. Production resolves late, so this unit cannot give them away or sell them this month.\n" +
        "Requested: 3 swords. This month: 3."
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
      "was: 3 SWOR\nThis unit has materials for 0 catapults, not the 3 its skill and tools could make."
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
          alreadyBought: 0,
          silverAvailable: 356,
          price: 18,
          cappedBy: "silver"
        }
      ]
    });

    expect(itemsTooltip(row, silver)).toBe(
      "was: 0 GRAI\n" +
        "Includes 5 SWOR this unit will produce. Production resolves late, so this unit cannot give them away or sell them this month.\n" +
        "This unit has silver for 19 grain, not the 30 this market offers.\n" +
        "This unit has materials for 5 swords, not the 8 its skill and tools could make."
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

  it("words the hover for a unit helping a formed unit build", () => {
    const row = previewedUnit({
      items: [{ amount: 30, name: "stone", tag: "STON" }],
      built: [
        {
          amount: 30,
          tag: "STON",
          name: "stone",
          place: "Mine",
          founding: true,
          helping: "new-1",
          couldDo: 30,
          cappedBy: null
        }
      ]
    });

    expect(itemsTooltip(row)).toBe(
      "was: 30 STON\nSpends 30 STON helping NEW 1 build a new Mine this month."
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
        "Includes 5 SWOR this unit will produce. Production resolves late, so this unit cannot give them away or sell them this month.\n" +
        "This unit has materials for 5 swords, not the 8 its skill and tools could make.\n" +
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

  // `ah-bxgs`. Every string below is quoted verbatim in the plan and is the navigator's own
  // wording - nothing here is left for the test to word differently.
  it("words the hover for a unit that sends, is refused, and receives", () => {
    const row = previewedUnit({
      items: [
        { amount: 88, name: "silver", tag: "SILV" },
        { amount: 15, name: "stone", tag: "STON" },
        { amount: 2, name: "horses", tag: "HORS" },
        { amount: 5, name: "fur", tag: "FUR" }
      ],
      previewChanges: [{ field: "items", original: "88 SILV, 15 STON, 2 HORS, 5 FUR" }],
      transportReceived: [{ amount: 12, tag: "SPEA", from: "5530" }],
      transportSent: [
        { amount: 30, tag: "STON", to: "16340", toUnshown: false, refused: false, orderIndex: 0 },
        { amount: 0, tag: "HORS", to: "", toUnshown: false, refused: true, orderIndex: 0 },
        { amount: 5, tag: "FUR", to: "4670", toUnshown: true, refused: false, orderIndex: 0 }
      ]
    });

    expect(itemsTooltip(row)).toBe(
      "was: 88 SILV, 15 STON, 2 HORS, 5 FUR\n" +
        "Includes 12 SPEA transported from unit 5530. Transport resolves last, so they cannot be spent this month.\n" +
        "Sends 30 STON to unit 16340.\n" +
        "The game will not transport HORS, so they stay with this unit.\n" +
        "Sends 5 FUR to unit 4670, which your report does not show."
    );
  });

  it("puts an arrival with the other Includes lines and a departure after them", () => {
    const row = previewedUnit({
      items: [
        { amount: 5, name: "iron", tag: "IRON" },
        { amount: 15, name: "wood", tag: "WOOD" },
        { amount: 30, name: "stone", tag: "STON" }
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
      ],
      transportReceived: [{ amount: 30, tag: "STON", from: "6857" }],
      transportSent: [{ amount: 5, tag: "IRON", to: "6857", toUnshown: false, refused: false, orderIndex: 0 }]
    });
    const silver = aUnitSilver({
      produced: 5,
      producedName: "sword",
      productionWanted: 8,
      productionCappedBy: "materials"
    });

    expect(itemsTooltip(row, silver)).toBe(
      "was: 5 IRON, 30 WOOD\n" +
        "Includes 5 SWOR this unit will produce. Production resolves late, so this unit cannot give them away or sell them this month.\n" +
        "Includes 30 STON transported from unit 6857. Transport resolves last, so they cannot be spent this month.\n" +
        "This unit has materials for 5 swords, not the 8 its skill and tools could make.\n" +
        "Spends 15 WOOD on Building 4 this month.\n" +
        "This unit has wood for 15 units of work, not the 30 its men could do.\n" +
        "Sends 5 IRON to unit 6857."
    );
  });
});

// `ah-64wm`. Every sentence below is the navigator's own wording, chosen against
// `docs/ui/ah-64wm-transport-targets.html`; nothing here is left for the test to word differently.
describe("a transport target the report cannot show receiving", () => {
  const previewedUnit = (overrides: Partial<PreviewedUnit>): PreviewedUnit =>
    ({ ...unit({}), previewChanges: [], uncounted: [], takenUnshown: [], ...overrides }) as PreviewedUnit;

  const stone = [{ amount: 40, name: "stone", tag: "STON" }];

  it("says an own target is no quartermaster and the goods stay", () => {
    expect(
      transportTargetSentence({ to: "7001", amount: 5, tag: "STON", reason: "notQuartermaster", orderIndex: 0 })
    ).toBe("Unit 7001 is not a quartermaster, so 5 STON stay with this unit.");
  });

  it("says a target owns no Caravanserai and the goods stay", () => {
    expect(
      transportTargetSentence({
        to: "7002",
        amount: 5,
        tag: "STON",
        reason: "notCaravanseraiOwner",
        orderIndex: 0
      })
    ).toBe("Unit 7002 does not own a Caravanserai, so 5 STON stay with this unit.");
  });

  it("says the report cannot show whether an unseen target is eligible", () => {
    expect(
      transportTargetSentence({ to: "99999", amount: 5, tag: "STON", reason: "eligibilityUnknown", orderIndex: 0 })
    ).toBe(
      "Could not count 5 STON for unit 99999 because your report does not show whether it is an eligible transport target."
    );
  });

  it("says the report cannot show whether a foreign faction accepts transports", () => {
    expect(
      transportTargetSentence({ to: "7003", amount: 5, tag: "STON", reason: "acceptanceUnknown", orderIndex: 0 })
    ).toBe(
      "Could not count 5 STON for unit 7003 because your report does not show whether its faction accepts transports from yours."
    );
  });

  // The order named goods the game would not carry anyway, so there is no per-tag claim to make:
  // the target gate is what stopped the order, and the sentence says only that.
  it("speaks of the order alone when it has no per-tag claim to make", () => {
    expect(
      transportTargetSentence({ to: "7001", amount: 0, tag: "", reason: "notQuartermaster", orderIndex: 0 })
    ).toBe("Unit 7001 is not a quartermaster, so this TRANSPORT moves nothing.");
    expect(
      transportTargetSentence({ to: "7002", amount: 0, tag: "", reason: "notCaravanseraiOwner", orderIndex: 0 })
    ).toBe("Unit 7002 does not own a Caravanserai, so this TRANSPORT moves nothing.");
    expect(
      transportTargetSentence({ to: "99999", amount: 0, tag: "", reason: "eligibilityUnknown", orderIndex: 0 })
    ).toBe(
      "Could not count this TRANSPORT for unit 99999 because your report does not show whether it is an eligible transport target."
    );
  });

  it("counts a missing-evidence reason as uncertain and a proven one as certain", () => {
    const issue = (reason: TransportTargetIssue["reason"]): TransportTargetIssue => ({
      to: "7001",
      amount: 5,
      tag: "STON",
      reason,
      orderIndex: 0
    });

    expect(transportTargetUncertain(issue("eligibilityUnknown"))).toBe(true);
    expect(transportTargetUncertain(issue("acceptanceUnknown"))).toBe(true);
    expect(transportTargetUncertain(issue("notQuartermaster"))).toBe(false);
    expect(transportTargetUncertain(issue("notCaravanseraiOwner"))).toBe(false);
  });

  it("marks a row uncertain only when one of its transports could not be settled", () => {
    expect(
      hasUncertainTransportTarget(
        previewedUnit({
          transportTargetIssues: [
            { to: "7001", amount: 5, tag: "STON", reason: "notQuartermaster", orderIndex: 0 }
          ]
        })
      )
    ).toBe(false);
    expect(
      hasUncertainTransportTarget(
        previewedUnit({
          transportTargetIssues: [
            { to: "7001", amount: 5, tag: "STON", reason: "notQuartermaster", orderIndex: 0 },
            { to: "99999", amount: 5, tag: "FUR", reason: "eligibilityUnknown", orderIndex: 0 }
          ]
        })
      )
    ).toBe(true);
    expect(hasUncertainTransportTarget(previewedUnit({}))).toBe(false);
    expect(hasUncertainTransportTarget(undefined)).toBe(false);
  });

  // The mockup's mixed card: the block reads in the order it was written.
  it("puts a refused target after a send written before it", () => {
    const row = previewedUnit({
      items: [
        { amount: 10, name: "stone", tag: "STON" },
        { amount: 5, name: "fur", tag: "FUR" }
      ],
      previewChanges: [{ field: "items", original: "40 STON, 5 FUR" }],
      transportSent: [
        { amount: 30, tag: "STON", to: "6857", toUnshown: false, refused: false, orderIndex: 0 }
      ],
      transportTargetIssues: [
        { to: "7001", amount: 5, tag: "FUR", reason: "notQuartermaster", orderIndex: 1 }
      ]
    });

    expect(itemsTooltip(row)).toBe(
      "was: 40 STON, 5 FUR\n" +
        "Sends 30 STON to unit 6857.\n" +
        "Unit 7001 is not a quartermaster, so 5 FUR stay with this unit."
    );
  });

  // The half the two lists cannot state on their own: the refused order was written *first*, and
  // reading the sends before the issues would put the block backwards (`ah-64wm`).
  it("puts a refused target before a send written after it", () => {
    const row = previewedUnit({
      items: [
        { amount: 10, name: "stone", tag: "STON" },
        { amount: 5, name: "fur", tag: "FUR" }
      ],
      previewChanges: [{ field: "items", original: "40 STON, 5 FUR" }],
      transportSent: [
        { amount: 30, tag: "STON", to: "6857", toUnshown: false, refused: false, orderIndex: 1 }
      ],
      transportTargetIssues: [
        { to: "7001", amount: 5, tag: "FUR", reason: "notQuartermaster", orderIndex: 0 }
      ]
    });

    expect(itemsTooltip(row)).toBe(
      "was: 40 STON, 5 FUR\n" +
        "Unit 7001 is not a quartermaster, so 5 FUR stay with this unit.\n" +
        "Sends 30 STON to unit 6857."
    );
  });

  // Every line one order writes shares that order's place, so the pair stays together and an
  // order written after them still follows both.
  it("keeps the lines of one order together and in the order the core wrote them", () => {
    expect(
      transportSentences(
        [
          { amount: 30, tag: "STON", to: "6857", toUnshown: false, refused: false, orderIndex: 1 },
          { amount: 0, tag: "HORS", to: "", toUnshown: false, refused: true, orderIndex: 1 }
        ],
        [{ to: "99999", amount: 5, tag: "FUR", reason: "eligibilityUnknown", orderIndex: 0 }]
      )
    ).toEqual([
      "Could not count 5 FUR for unit 99999 because your report does not show whether it is an eligible transport target.",
      "Sends 30 STON to unit 6857.",
      "The game will not transport HORS, so they stay with this unit."
    ]);
  });

  // Nothing was projected - the goods never moved - so the hover still opens on the report's own
  // list, exactly as it does for an order that could not be counted.
  it("words the hover for a row whose only transport was refused", () => {
    const row = previewedUnit({
      items: stone,
      transportTargetIssues: [
        { to: "99999", amount: 5, tag: "STON", reason: "eligibilityUnknown", orderIndex: 0 }
      ]
    });

    expect(itemsTooltip(row)).toBe(
      "was: 40 STON\n" +
        "Could not count 5 STON for unit 99999 because your report does not show whether it is an eligible transport target."
    );
  });

  it("says nothing about a row with no target issue", () => {
    expect(itemsTooltip(previewedUnit({ items: stone }))).toBeUndefined();
  });
});
