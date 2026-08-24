import type { Coordinate, ParsedReport, ReportRegion, ReportUnit } from "@atlantis/core-client";
import { aParsedReport, aReportHeaderInfo, aReportRegion, aReportUnit } from "@atlantis/core-client";
import { describe, expect, it } from "vitest";
import { regionIdOf } from "./hexMapModel";
import { diffOrders, diffTurns } from "./turnDiff";

const at = (x: number, y: number, z = 1): Coordinate => ({ x, y, z });

const unit = (overrides: Partial<ReportUnit> = {}): ReportUnit => aReportUnit(overrides);

function foreignUnit(overrides: Partial<ReportUnit> = {}): ReportUnit {
  return unit({
    unitId: "999",
    name: "Raiders",
    factionId: "32",
    factionName: "Elder Tree Forests",
    own: false,
    ...overrides
  });
}

const region = (coordinate: Coordinate, overrides: Partial<ReportRegion> = {}): ReportRegion =>
  aReportRegion({ coordinate, ...overrides });

const report = (regions: ReportRegion[], turnNumber: number | null = 71): ParsedReport =>
  aParsedReport({ header: aReportHeaderInfo({ turnNumber }), regions });

describe("diffTurns: units", () => {
  it("diffing a report against itself reports nothing", () => {
    const same = report([region(at(7, 53), { units: [unit(), foreignUnit()] })]);

    const diff = diffTurns(same, same);

    expect(diff.units).toEqual({ added: [], removed: [], changed: [] });
  });

  it("an own unit present only in the newer turn is added", () => {
    const older = report([region(at(7, 53), { units: [] })]);
    const newer = report([region(at(7, 53), { units: [unit()] })]);

    const diff = diffTurns(older, newer);

    expect(diff.units.added).toEqual([unit()]);
    expect(diff.units.removed).toEqual([]);
  });

  it("an own unit present only in the older turn is removed", () => {
    const older = report([region(at(7, 53), { units: [unit()] })]);
    const newer = report([region(at(7, 53), { units: [] })]);

    const diff = diffTurns(older, newer);

    expect(diff.units.removed).toEqual([unit()]);
    expect(diff.units.added).toEqual([]);
  });

  it("swapping the arguments swaps added and removed", () => {
    const older = report([region(at(7, 53), { units: [unit({ unitId: "1" })] })]);
    const newer = report([region(at(7, 53), { units: [unit({ unitId: "2" })] })]);

    const forward = diffTurns(older, newer);
    const backward = diffTurns(newer, older);

    expect(backward.units.added).toEqual(forward.units.removed);
    expect(backward.units.removed).toEqual(forward.units.added);
  });

  it("an own unit in a different region is one moved unit, not an add and a remove", () => {
    const older = report([
      region(at(7, 53), { units: [unit({ regionId: regionIdOf(at(7, 53)) })] })
    ]);
    const newer = report([
      region(at(9, 53), { units: [unit({ regionId: regionIdOf(at(9, 53)) })] })
    ]);

    const diff = diffTurns(older, newer);

    expect(diff.units.added).toEqual([]);
    expect(diff.units.removed).toEqual([]);
    expect(diff.units.changed).toEqual([
      {
        unitId: "1",
        name: "Scouts",
        changes: [],
        movedFrom: regionIdOf(at(7, 53)),
        movedTo: regionIdOf(at(9, 53))
      }
    ]);
  });

  it("a unit's men change names the field with both values", () => {
    const older = report([region(at(7, 53), { units: [unit({ men: 10 })] })]);
    const newer = report([region(at(7, 53), { units: [unit({ men: 12 })] })]);

    const diff = diffTurns(older, newer);

    expect(diff.units.changed).toEqual([
      {
        unitId: "1",
        name: "Scouts",
        changes: [{ field: "men", before: "10", after: "12" }],
        movedFrom: null,
        movedTo: null
      }
    ]);
  });

  it("an item gained names items with before and after lists", () => {
    const older = report([
      region(at(7, 53), { units: [unit({ items: [{ amount: 1, name: "sword", tag: "SWOR" }] })] })
    ]);
    const newer = report([
      region(at(7, 53), {
        units: [
          unit({
            items: [
              { amount: 1, name: "sword", tag: "SWOR" },
              { amount: 2, name: "horses", tag: "HORS" }
            ]
          })
        ]
      })
    ]);

    const diff = diffTurns(older, newer);

    expect(diff.units.changed).toEqual([
      {
        unitId: "1",
        name: "Scouts",
        changes: [{ field: "items", before: "1 sword", after: "2 horses, 1 sword" }],
        movedFrom: null,
        movedTo: null
      }
    ]);
  });

  it("reordered items are not a change", () => {
    const items = [
      { amount: 2, name: "horses", tag: "HORS" },
      { amount: 1, name: "sword", tag: "SWOR" }
    ];
    const reordered = [items[1], items[0]];
    const older = report([region(at(7, 53), { units: [unit({ items })] })]);
    const newer = report([region(at(7, 53), { units: [unit({ items: reordered })] })]);

    const diff = diffTurns(older, newer);

    expect(diff.units.changed).toEqual([]);
  });

  it("a foreign unit in a region unseen in the other turn is not reported", () => {
    // The region only exists in the older report, so the newer report simply has no knowledge of
    // it - the foreign unit's absence there is not a fact about the world.
    const older = report([region(at(7, 53), { units: [foreignUnit()] })]);
    const newer = report([region(at(9, 53), { units: [] })]);

    const diff = diffTurns(older, newer);

    expect(diff.units.removed).toEqual([]);
    expect(diff.units.added).toEqual([]);
    expect(diff.units.changed).toEqual([]);
  });

  it("a foreign unit gone from a region seen in both turns is removed", () => {
    const older = report([region(at(7, 53), { units: [foreignUnit()] })]);
    const newer = report([region(at(7, 53), { units: [] })]);

    const diff = diffTurns(older, newer);

    expect(diff.units.removed).toEqual([foreignUnit()]);
  });

  it("a unit captured (foreign in one turn, own in the other) is one changed unit, not an add and a remove", () => {
    // A unit that changes ownership between turns must still be diffed as a single unit by
    // unitId, whichever pass (own-only vs region-restricted-foreign) it falls into on either
    // side - otherwise it is reported as removed from one bucket and added to the other.
    const captured = foreignUnit({ unitId: "42", regionId: regionIdOf(at(7, 53)) });
    const older = report([region(at(7, 53), { units: [captured] })]);
    const newer = report([
      region(at(7, 53), { units: [unit({ ...captured, own: true, factionId: "95" })] })
    ]);

    const diff = diffTurns(older, newer);

    expect(diff.units.added).toEqual([]);
    expect(diff.units.removed).toEqual([]);
    const change = diff.units.changed.find((c) => c.unitId === "42");
    expect(change?.changes).toContainEqual({ field: "own", before: "false", after: "true" });
  });
});

describe("diffTurns: regions", () => {
  it("diffing a report against itself reports nothing", () => {
    const same = report([region(at(7, 53), { population: 100 })]);

    const diff = diffTurns(same, same);

    expect(diff.regions).toEqual({ onlyInNewer: [], onlyInOlder: [], changed: [] });
  });

  it("a region seen only in the newer turn is onlyInNewer and has no field changes", () => {
    const older = report([]);
    const newer = report([region(at(7, 53))]);

    const diff = diffTurns(older, newer);

    expect(diff.regions.onlyInNewer).toEqual([regionIdOf(at(7, 53))]);
    expect(diff.regions.onlyInOlder).toEqual([]);
    expect(diff.regions.changed).toEqual([]);
  });

  it("a region seen in both turns with a population change is changed with the field named", () => {
    const older = report([region(at(7, 53), { population: 100 })]);
    const newer = report([region(at(7, 53), { population: 120 })]);

    const diff = diffTurns(older, newer);

    expect(diff.regions.changed).toEqual([
      {
        regionId: regionIdOf(at(7, 53)),
        changes: [{ field: "population", before: "100", after: "120" }]
      }
    ]);
  });

  it("a price change in forSale names the market field", () => {
    const older = report([
      region(at(7, 53), { forSale: [{ amount: 10, name: "grain", tag: "GRAI", price: 5 }] })
    ]);
    const newer = report([
      region(at(7, 53), { forSale: [{ amount: 10, name: "grain", tag: "GRAI", price: 6 }] })
    ]);

    const diff = diffTurns(older, newer);

    expect(diff.regions.changed).toEqual([
      {
        regionId: regionIdOf(at(7, 53)),
        changes: [{ field: "forSale", before: "10 grain @ 5", after: "10 grain @ 6" }]
      }
    ]);
  });

  it("a structure present only in the newer turn's region is a structures change", () => {
    const older = report([region(at(7, 53), { structures: [] })]);
    const newer = report([
      region(at(7, 53), {
        structures: [
          { structureId: "1", name: "Tower", kind: "tower", baseKind: "tower", qualifiers: [], vessels: [], description: null, needs: null }
        ]
      })
    ]);

    const diff = diffTurns(older, newer);

    expect(diff.regions.changed).toEqual([
      {
        regionId: regionIdOf(at(7, 53)),
        changes: [{ field: "structures", before: "—", after: "Tower (1)" }]
      }
    ]);
  });
});

describe("diffOrders", () => {
  const document = (unitLines: string) =>
    ['#atlantis 95 "secret"', "", ";*** mountain (7,53) in Inhead ***", "", unitLines, "#end"].join(
      "\n"
    );

  it("a draft reflowed with blank lines and comments is not a change", () => {
    const older = document(["unit 1", "@claim 50", "@study obse"].join("\n"));
    const newer = document(
      ["unit 1", "; a note to self", "", "@claim 50", "", "@study obse", ""].join("\n")
    );

    const diff = diffOrders(older, newer);

    expect(diff.changed).toEqual([]);
  });

  it("keeps a repeating @; order as a real command, not a dropped comment", () => {
    const older = document(["unit 1", "@claim 50"].join("\n"));
    const newer = document(["unit 1", "@claim 50", "@;study obse"].join("\n"));

    const diff = diffOrders(older, newer);

    expect(diff.changed).toEqual([
      { unitId: "1", before: ["@claim 50"], after: ["@claim 50", "@;study obse"] }
    ]);
  });

  it("a changed order line reports the unit with before and after commands", () => {
    const older = document(["unit 1", "@claim 50"].join("\n"));
    const newer = document(["unit 1", "@claim 60"].join("\n"));

    const diff = diffOrders(older, newer);

    expect(diff.changed).toEqual([{ unitId: "1", before: ["@claim 50"], after: ["@claim 60"] }]);
  });

  it("a unit with orders in only one draft is onlyIn*", () => {
    const older = document(["unit 1", "@claim 50"].join("\n"));
    const newer = document(["unit 2", "@claim 50"].join("\n"));

    const diff = diffOrders(older, newer);

    expect(diff.onlyInOlder).toEqual(["1"]);
    expect(diff.onlyInNewer).toEqual(["2"]);
    expect(diff.changed).toEqual([]);
  });
});
