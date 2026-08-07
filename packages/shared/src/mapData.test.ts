import { describe, expect, it } from "vitest";
import type { ReportParseResult } from "@atlantis/core-client";
import { buildMapViewModel, parseRegionCoordinate } from "./mapData";

describe("mapData", () => {
  it("parses alphanumeric region ids into zero-based hex coordinates", () => {
    expect(parseRegionCoordinate("A1")).toEqual({ col: 0, row: 0 });
    expect(parseRegionCoordinate("B2")).toEqual({ col: 1, row: 1 });
    expect(parseRegionCoordinate("AA1")).toEqual({ col: 26, row: 0 });
    expect(parseRegionCoordinate("invalid")).toBeNull();
  });

  it("builds sorted region hierarchy with deterministic fallback coordinates", () => {
    const parsed: ReportParseResult = {
      turnHeader: { turnNumber: 12, season: "Spring" },
      detectedFactions: [{ factionId: "17", name: "Crimson Tide" }],
      regions: [
        { regionId: "X", name: "Fallback Region" },
        { regionId: "B2", name: "Second" },
        { regionId: "A1", name: "First" }
      ],
      units: [
        { unitId: "U200", name: "Bravo Unit", regionId: "B2" },
        { unitId: "U100", name: "Alpha Unit", regionId: "B2" },
        { unitId: "U300", name: "Gamma Unit", regionId: "X" }
      ],
      inventories: [],
      messageSummaries: [],
      warnings: [],
      meetsMinimumImportThreshold: true
    };

    const viewModel = buildMapViewModel(parsed);

    expect(viewModel.regions.map((region) => region.regionId)).toEqual(["A1", "B2", "X"]);
    expect(viewModel.regions[2]?.coordinate.row).toBeGreaterThan(viewModel.regions[1]?.coordinate.row ?? 0);
    expect(viewModel.regions[1]?.units.map((unit) => unit.name)).toEqual(["Alpha Unit", "Bravo Unit"]);
    expect(viewModel.initialSelectedRegionId).toBe("A1");
  });
});
