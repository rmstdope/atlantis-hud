import type { Coordinate, ParsedReport, ReportRegion, ReportUnit } from "@atlantis/core-client";
import { aParsedReport, aReportHeaderInfo, aReportRegion, aReportUnit } from "@atlantis/core-client";
import { describe, expect, it } from "vitest";
import { regionIdOf } from "../hexMapModel";
import { diffOrders, diffTurns } from "../turnDiff";
import {
  changesTabs,
  nextChangesTab,
  orderRows,
  ordersEmptyText,
  regionRows,
  regionsEmptyText,
  unitRows,
  unitsEmptyText
} from "./changesView";

const at = (x: number, y: number, z = 1): Coordinate => ({ x, y, z });

const unit = (overrides: Partial<ReportUnit> = {}): ReportUnit => aReportUnit(overrides);

const region = (coordinate: Coordinate, overrides: Partial<ReportRegion> = {}): ReportRegion =>
  aReportRegion({ coordinate, ...overrides });

const report = (regions: ReportRegion[], turnNumber: number | null = 71): ParsedReport =>
  aParsedReport({ header: aReportHeaderInfo({ turnNumber }), regions });

describe("changesTabs", () => {
  it("carries counts and reports a null orders diff as zero", () => {
    const older = report([region(at(7, 53), { units: [unit({ unitId: "1" }), unit({ unitId: "2" })] })], 70);
    const newer = report(
      [
        region(at(7, 53), {
          units: [
            unit({ unitId: "1", men: 2 }),
            unit({ unitId: "3" }),
            unit({ unitId: "4" }),
            unit({ unitId: "5" })
          ]
        })
      ],
      71
    );
    // 1 changed (men), 2 removed, 3 added -> five unit changes; no region field changes.
    const diff = diffTurns(older, newer);

    const tabs = changesTabs(diff, null);

    expect(tabs).toEqual([
      { key: "units", label: "Units · 5", count: 5 },
      { key: "regions", label: "Regions · 0", count: 0 },
      { key: "orders", label: "Orders · 0", count: 0 }
    ]);
  });

  it("counts a non-null orders diff", () => {
    const diff = diffTurns(report([]), report([]));
    const orders = diffOrders("unit 1\n@work\n", "unit 1\n@fish\n");

    const tabs = changesTabs(diff, orders);

    expect(tabs.find((tab) => tab.key === "orders")).toEqual({ key: "orders", label: "Orders · 1", count: 1 });
  });
});

describe("empty-state text", () => {
  it("names the category plainly when nothing changed", () => {
    expect(unitsEmptyText()).toBe("No unit changed between these turns.");
    expect(regionsEmptyText()).toBe("No region changed between these turns.");
  });

  it("distinguishes a null orders diff from one with no changes", () => {
    expect(ordersEmptyText(null, 70)).toBe("No orders known for turn 70.");
    const emptyDiff = diffOrders("unit 1\n@work\n", "unit 1\n@work\n");
    expect(ordersEmptyText(emptyDiff, 70)).toBe("No orders changed between these turns.");
  });
});

describe("unitRows", () => {
  it("names an added unit's arrival region and a removed unit's departure region", () => {
    const older = report([region(at(7, 53), { units: [unit({ unitId: "1" })] })]);
    const newer = report([region(at(8, 54), { units: [unit({ unitId: "2", regionId: regionIdOf(at(8, 54)) })] })]);
    const diff = diffTurns(older, newer);

    const rows = unitRows(diff.units, older, newer);

    expect(rows).toEqual([
      {
        unitId: "2",
        name: "Scouts",
        glyph: "+",
        regionId: regionIdOf(at(8, 54)),
        detail: "arrived in mountain (8,54) in Inhead"
      },
      {
        unitId: "1",
        name: "Scouts",
        glyph: "-",
        regionId: regionIdOf(at(7, 53)),
        detail: "left mountain (7,53) in Inhead"
      }
    ]);
  });

  it("renders a moved unit with both region labels and a stationary change with its field diff", () => {
    const older = report([
      region(at(7, 53), { units: [unit({ unitId: "1" }), unit({ unitId: "2" })] })
    ]);
    const newer = report([
      region(at(7, 53), { units: [unit({ unitId: "2", men: 3 })] }),
      region(at(8, 54), { units: [unit({ unitId: "1", regionId: regionIdOf(at(8, 54)) })] })
    ]);
    const diff = diffTurns(older, newer);

    const rows = unitRows(diff.units, older, newer);

    const moved = rows.find((row) => row.unitId === "1");
    expect(moved).toEqual({
      unitId: "1",
      name: "Scouts",
      glyph: "→",
      regionId: regionIdOf(at(8, 54)),
      detail: "moved: mountain (7,53) in Inhead → mountain (8,54) in Inhead"
    });

    const stationary = rows.find((row) => row.unitId === "2");
    expect(stationary).toEqual({
      unitId: "2",
      name: "Scouts",
      glyph: "±",
      regionId: regionIdOf(at(7, 53)),
      detail: "men: 1 → 3"
    });
  });
});

describe("regionRows", () => {
  it("labels a region seen on only one side, and a changed region on both", () => {
    const older = report([region(at(7, 53), { population: 100 })]);
    const newer = report([
      region(at(7, 53), { population: 150 }),
      region(at(8, 54))
    ]);
    const diff = diffTurns(older, newer);

    const rows = regionRows(diff.regions, older, newer);

    expect(rows).toEqual([
      {
        regionId: regionIdOf(at(8, 54)),
        glyph: "+",
        label: "mountain (8,54) in Inhead",
        detail: "newly seen"
      },
      {
        regionId: regionIdOf(at(7, 53)),
        glyph: "±",
        label: "mountain (7,53) in Inhead",
        detail: "population: 100 → 150"
      }
    ]);
  });
});

describe("nextChangesTab", () => {
  const order = ["units", "regions", "orders"] as const;

  it("moves right and wraps at the end, per the ARIA tabs pattern", () => {
    expect(nextChangesTab("units", "ArrowRight", [...order])).toBe("regions");
    expect(nextChangesTab("orders", "ArrowRight", [...order])).toBe("units");
  });

  it("moves left and wraps at the start", () => {
    expect(nextChangesTab("units", "ArrowLeft", [...order])).toBe("orders");
    expect(nextChangesTab("regions", "ArrowLeft", [...order])).toBe("units");
  });

  it("any other key moves nothing", () => {
    expect(nextChangesTab("units", "Enter", [...order])).toBeNull();
  });
});

describe("orderRows", () => {
  it("names a changed unit's orders by its report name when known", () => {
    const older = report([region(at(7, 53), { units: [unit({ unitId: "1", name: "Scouts" })] })]);
    const newer = report([region(at(7, 53), { units: [unit({ unitId: "1", name: "Scouts" })] })]);
    const orders = diffOrders("unit 1\n@work\n", "unit 1\n@fish\n");

    const rows = orderRows(orders, older, newer);

    expect(rows).toEqual([
      { unitId: "1", name: "Scouts", glyph: "±", detail: "@work → @fish" }
    ]);
  });
});
