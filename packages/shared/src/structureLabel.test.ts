import { describe, expect, it } from "vitest";
import type { StructureInfo } from "@atlantis/core-client";

import {
  reportedStructureRegionOf,
  structureLabel,
  structureRegionOf,
  structuresByRegionOf,
  unitStructureLabel,
  unitStructureLabelIn
} from "./structureLabel";

const aStructure = (overrides: Partial<StructureInfo> = {}): StructureInfo => ({
  structureId: "12",
  name: "Odds and Ends",
  kind: "Fort",
  baseKind: "Fort",
  qualifiers: [],
  vessels: [],
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

describe("unitStructureLabelIn", () => {
  const index = structuresByRegionOf([
    {
      regionId: "1:43,81",
      structures: [aStructure({ structureId: "7", name: "Northkeep", kind: "Fort" })]
    },
    {
      regionId: "1:43,79",
      structures: [aStructure({ structureId: "7", name: "Southwatch", kind: "Fort" })]
    }
  ]);

  it("names the structure in the region that numbered it, not another region's structure of the same number", () => {
    expect(unitStructureLabelIn("1:43,79", "7", index)).toBe("Southwatch [7] · Fort");
    expect(unitStructureLabelIn("1:43,81", "7", index)).toBe("Northkeep [7] · Fort");
  });

  it("falls back to the bare number for a region the index does not describe", () => {
    expect(unitStructureLabelIn("1:6,52", "7", index)).toBe("[7]");
  });

  it("gives nothing at all for a unit standing in the open", () => {
    expect(unitStructureLabelIn("1:43,79", null, index)).toBeNull();
  });
});

describe("structureRegionOf and reportedStructureRegionOf", () => {
  it("takes a folded row's structure hex over the hex it stands in", () => {
    expect(
      structureRegionOf({ regionId: "1:43,81", structureId: "12", structureRegionId: "1:43,79" })
    ).toBe("1:43,79");
  });

  it("falls back to the row's own hex", () => {
    expect(structureRegionOf({ regionId: "1:43,81", structureId: "12" })).toBe("1:43,81");
    expect(reportedStructureRegionOf({ regionId: "1:43,81", structureId: "12" })).toBe("1:43,81");
  });

  it("reads a reported structure in the hex the unit set out from", () => {
    expect(
      reportedStructureRegionOf({
        regionId: "1:43,79",
        structureId: null,
        arrivingFrom: "1:43,81"
      })
    ).toBe("1:43,81");
  });
});
