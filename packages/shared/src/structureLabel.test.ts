import { describe, expect, it } from "vitest";
import type { StructureInfo } from "@atlantis/core-client";

import { structureLabel, unitStructureLabel } from "./structureLabel";

const aStructure = (overrides: Partial<StructureInfo> = {}): StructureInfo => ({
  structureId: "12",
  name: "Odds and Ends",
  kind: "Fort",
  description: null,
  needs: null,
  ...overrides
});

describe("structureLabel", () => {
  it("writes a structure the way the region pane does", () => {
    expect(structureLabel(aStructure())).toBe("Odds and Ends [12] · Fort");
  });
});

describe("unitStructureLabel", () => {
  const structures = [aStructure(), aStructure({ structureId: "329", name: "Wavecrest", kind: "Longship" })];

  it("gives nothing at all for a unit standing in the open", () => {
    expect(unitStructureLabel(null, structures)).toBeNull();
  });

  it("names the structure the unit stands in", () => {
    expect(unitStructureLabel("329", structures)).toBe("Wavecrest [329] · Longship");
  });

  it("falls back to the bare number when the region never described the structure", () => {
    expect(unitStructureLabel("77", structures)).toBe("[77]");
  });
});
