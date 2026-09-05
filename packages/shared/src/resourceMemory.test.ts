import { describe, expect, it } from "vitest";
import { aParsedReport, aReportRegion, aReportUnit } from "@atlantis/core-client";
import type { GameDataEntry, GameDataIndex } from "./gameData";
import {
  mergedMemory,
  NO_RESOURCE_MEMORY,
  rememberedFor,
  withTurn,
  type ResourceMemory
} from "./resourceMemory";

const anIndex = (over: Partial<GameDataIndex> = {}): GameDataIndex => ({
  entries: [],
  byId: new Map([
    [
      "equipment:FLOA",
      { id: "equipment:FLOA", category: "equipment", name: "floater hide", tag: "FLOA" }
    ],
    [
      "equipment:MUSH",
      { id: "equipment:MUSH", category: "equipment", name: "mushroom", tag: "MUSH" }
    ]
  ] as [string, GameDataEntry][]),
  detailOf: () => null,
  revealedBy: new Map([
    ["FLOA", { skillTag: "HUNT", skillName: "hunting", level: 3 }],
    ["MUSH", { skillTag: "HERB", skillName: "herb lore", level: 3 }]
  ]),
  terrainResources: new Map([["swamp", ["WOOD", "FLOA", "HERB", "MUSH"]]]),
  ...over
});

const hunter = (level: number, over: Parameters<typeof aReportUnit>[0] = {}) =>
  aReportUnit({ skills: [{ name: "hunting", tag: "HUNT", level, points: 180 }], ...over });

const aSwampReport = (
  units: ReturnType<typeof aReportUnit>[],
  products = [{ amount: 16, name: "wood", tag: "WOOD" }],
  over: Parameters<typeof aReportRegion>[0] = {}
) =>
  aParsedReport({
    regions: [aReportRegion({ terrain: "swamp", products, units, ...over })]
  });

const hexId = aReportRegion({ terrain: "swamp" }).regionId;

describe("resourceMemory (ah-tgtp)", () => {
  it("remembers what a skilled unit proved absent", () => {
    const memory = withTurn(NO_RESOURCE_MEMORY, aSwampReport([hunter(3)]), 23, anIndex());

    expect(rememberedFor(memory, hexId).get("FLOA")).toEqual({
      tag: "FLOA",
      amount: 0,
      name: null,
      turn: 23
    });
  });

  it("remembers what a skilled unit proved present, with the report's own name", () => {
    const report = aSwampReport(
      [hunter(3)],
      [
        { amount: 16, name: "wood", tag: "WOOD" },
        { amount: 8, name: "floater hides", tag: "FLOA" }
      ]
    );

    expect(rememberedFor(withTurn(NO_RESOURCE_MEMORY, report, 23, anIndex()), hexId).get("FLOA"))
      .toEqual({ tag: "FLOA", amount: 8, name: "floater hides", turn: 23 });
  });

  it("remembers nothing about a resource nobody there could check", () => {
    const herbalist = aReportUnit({
      skills: [{ name: "herb lore", tag: "HERB", level: 1, points: 50 }]
    });
    const memory = withTurn(NO_RESOURCE_MEMORY, aSwampReport([herbalist]), 23, anIndex());

    expect(rememberedFor(memory, hexId).get("FLOA")).toBeUndefined();
    expect(rememberedFor(memory, hexId).get("MUSH")).toBeUndefined();
  });

  it("does not read a foreign unit's skills", () => {
    const memory = withTurn(
      NO_RESOURCE_MEMORY,
      aSwampReport([hunter(3, { own: false })]),
      23,
      anIndex()
    );

    expect(rememberedFor(memory, hexId).get("FLOA")).toBeUndefined();
  });

  it("remembers nothing about a resource this terrain cannot hold", () => {
    const memory = withTurn(
      NO_RESOURCE_MEMORY,
      aSwampReport([hunter(3)], [{ amount: 16, name: "wood", tag: "WOOD" }], {
        terrain: "mountain"
      }),
      23,
      anIndex()
    );

    expect(rememberedFor(memory, hexId).size).toBe(0);
  });

  it("keeps the newer turn's verdict", () => {
    const present = [
      { amount: 16, name: "wood", tag: "WOOD" },
      { amount: 8, name: "floater hides", tag: "FLOA" }
    ];
    let memory = withTurn(NO_RESOURCE_MEMORY, aSwampReport([hunter(3)]), 23, anIndex());
    memory = withTurn(memory, aSwampReport([hunter(3)], present), 25, anIndex());
    memory = withTurn(memory, aSwampReport([hunter(3)]), 24, anIndex());

    expect(rememberedFor(memory, hexId).get("FLOA")).toEqual({
      tag: "FLOA",
      amount: 8,
      name: "floater hides",
      turn: 25
    });
  });

  it("lets a re-fold of the same turn win, so a rescan is idempotent", () => {
    const present = [
      { amount: 16, name: "wood", tag: "WOOD" },
      { amount: 8, name: "floater hides", tag: "FLOA" }
    ];
    let memory = withTurn(NO_RESOURCE_MEMORY, aSwampReport([hunter(3)], present), 25, anIndex());
    memory = withTurn(memory, aSwampReport([hunter(3)], present), 25, anIndex());

    expect(rememberedFor(memory, hexId).size).toBe(1);
    expect(rememberedFor(memory, hexId).get("FLOA")?.amount).toBe(8);
  });

  it("remembers nothing while the catalogue cannot say", () => {
    const memory: ResourceMemory = NO_RESOURCE_MEMORY;

    expect(withTurn(memory, aSwampReport([hunter(3)]), 23, null)).toBe(memory);
  });

  it("hands back the same empty map for a hex it knows nothing about", () => {
    expect(rememberedFor(NO_RESOURCE_MEMORY, "1:36,46")).toBe(
      rememberedFor(NO_RESOURCE_MEMORY, "1:36,46")
    );
  });

  it("merges two memories, the greater turn winning", () => {
    const absent = withTurn(NO_RESOURCE_MEMORY, aSwampReport([hunter(3)]), 23, anIndex());
    const present = withTurn(
      NO_RESOURCE_MEMORY,
      aSwampReport([hunter(3)], [{ amount: 8, name: "floater hides", tag: "FLOA" }]),
      25,
      anIndex()
    );

    expect(rememberedFor(mergedMemory(absent, present), hexId).get("FLOA")?.turn).toBe(25);
    expect(rememberedFor(mergedMemory(present, absent), hexId).get("FLOA")?.turn).toBe(25);
    expect(rememberedFor(mergedMemory(present, absent), hexId).get("FLOA")?.amount).toBe(8);
  });

  it("lets the incoming memory win a tie", () => {
    const absent = withTurn(NO_RESOURCE_MEMORY, aSwampReport([hunter(3)]), 25, anIndex());
    const present = withTurn(
      NO_RESOURCE_MEMORY,
      aSwampReport([hunter(3)], [{ amount: 8, name: "floater hides", tag: "FLOA" }]),
      25,
      anIndex()
    );

    expect(rememberedFor(mergedMemory(absent, present), hexId).get("FLOA")?.amount).toBe(8);
    expect(rememberedFor(mergedMemory(present, absent), hexId).get("FLOA")?.amount).toBe(0);
  });

  it("keeps a hex only one of the two knows about", () => {
    const here = withTurn(NO_RESOURCE_MEMORY, aSwampReport([hunter(3)]), 23, anIndex());
    const there = withTurn(
      NO_RESOURCE_MEMORY,
      aSwampReport([hunter(3)], [{ amount: 16, name: "wood", tag: "WOOD" }], {
        coordinate: { x: 35, y: 47, z: 1 }
      }),
      23,
      anIndex()
    );
    const merged = mergedMemory(here, there);

    expect(rememberedFor(merged, hexId).get("FLOA")?.turn).toBe(23);
    expect(rememberedFor(merged, "1:35,47").get("FLOA")?.turn).toBe(23);
  });
});
