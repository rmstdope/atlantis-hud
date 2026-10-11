import { describe, expect, it } from "vitest";
import type { BuildSpend, RegionPreview, UnitPreview } from "@atlantis/core-client";
import { aReportUnit, aStructure } from "@atlantis/core-client";
import { structuresByRegionOf } from "./structureLabel";
import { formatItems } from "./unitPreview";
import {
  finishingStructuresOf,
  isUnfinishedShipName,
  itemCellParts,
  structureFinishState
} from "./unfinishedMark";

const spend = (finishes: string | null): BuildSpend => ({
  materials: [{ amount: 20, tag: "WOOD", name: "wood" }],
  amount: 20,
  place: "Building 11",
  founding: false,
  helping: null,
  couldDo: 20,
  cappedBy: null,
  finishes
});

const row = (
  unitId: string,
  built: BuildSpend[],
  status: UnitPreview["status"] = "present"
): UnitPreview =>
  ({
    unit: aReportUnit({ unitId }),
    status,
    changes: [],
    built
  }) as unknown as UnitPreview;

const STOCKADE = aStructure("Stockade", { structureId: "11", name: "Building", needs: 20 });
const FORT = aStructure("Fort", { structureId: "12", name: "Odds and Ends", needs: null });
const byRegion = structuresByRegionOf([{ regionId: "r1", structures: [STOCKADE, FORT] }]);
const NONE = new Map<string, ReadonlySet<string>>();

describe("finishingStructuresOf", () => {
  it("collects every structure a BUILD finishes, by region", () => {
    const regions: RegionPreview[] = [
      { regionId: "r1", units: [row("1", [spend(null)]), row("2", [spend("11")])] },
      { regionId: "r2", units: [row("3", [spend("4")])] }
    ];
    const finishing = finishingStructuresOf({ regions });
    expect([...(finishing.get("r1") ?? [])]).toEqual(["11"]);
    expect([...(finishing.get("r2") ?? [])]).toEqual(["4"]);
  });

  it("reads a row only where the report lists it, never its arriving copy", () => {
    const regions: RegionPreview[] = [
      { regionId: "r2", units: [row("1", [spend("11")], "arriving")] }
    ];
    expect(finishingStructuresOf({ regions }).size).toBe(0);
  });

  it("is empty without a preview", () => {
    expect(finishingStructuresOf(null).size).toBe(0);
  });
});

describe("structureFinishState", () => {
  it("is unfinished for a structure the report shows with needs", () => {
    expect(structureFinishState("r1", "11", byRegion, NONE)).toBe("unfinished");
  });

  it("is finishing when this month's BUILD lays its last work", () => {
    const finishing = new Map([["r1", new Set(["11"])]]);
    expect(structureFinishState("r1", "11", byRegion, finishing)).toBe("finishing");
  });

  it("says nothing of a finished structure, of none, or of one the report never described", () => {
    expect(structureFinishState("r1", "12", byRegion, NONE)).toBeNull();
    expect(structureFinishState("r1", null, byRegion, NONE)).toBeNull();
    expect(structureFinishState("r1", "99", byRegion, NONE)).toBeNull();
    expect(structureFinishState("r9", "11", byRegion, NONE)).toBeNull();
  });

  it("keys the finishing set by region, since a structure number is scoped to its region", () => {
    const finishing = new Map([["r2", new Set(["11"])]]);
    expect(structureFinishState("r1", "11", byRegion, finishing)).toBe("unfinished");
  });
});

describe("isUnfinishedShipName", () => {
  it("reads the report's own prefix, whatever its case", () => {
    expect(isUnfinishedShipName("unfinished Galleon")).toBe(true);
    expect(isUnfinishedShipName("UNFINISHED cog")).toBe(true);
    expect(isUnfinishedShipName("Galleon")).toBe(false);
    expect(isUnfinishedShipName("unfinishedGalleon")).toBe(false);
    expect(isUnfinishedShipName(undefined)).toBe(false);
  });
});

describe("itemCellParts", () => {
  const items = [
    { amount: 85, name: "wood", tag: "WOOD" },
    { amount: 300, name: "silver", tag: "SILV" },
    { amount: 1, name: "unfinished Galleon", tag: "GALL" },
    { amount: 5, name: "sword", tag: "SWOR" }
  ];

  it("marks only the unfinished ship, and leaves silver out as the cell does", () => {
    expect(itemCellParts(items)).toEqual([
      { text: "85 WOOD", unfinished: false },
      { text: "1 GALL", unfinished: true },
      { text: "5 SWOR", unfinished: false }
    ]);
  });

  it("keeps the range a CAST's uncertain creation draws", () => {
    const created = [{ tag: "SWOR", most: 5, fewest: 2 }] as never;
    expect(itemCellParts(items, created).at(-1)).toEqual({ text: "2-5 SWOR", unfinished: false });
  });

  it("is what formatItems joins, so the two cannot drift", () => {
    expect(formatItems(items)).toBe("85 WOOD, 1 GALL, 5 SWOR");
  });
});
