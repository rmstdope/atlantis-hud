import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { aReportRegion, aReportUnit } from "@atlantis/core-client";
import { parseGameData, type GameDataEntry, type GameDataIndex } from "./gameData";
import { resourceChecksOf } from "./resourceChecks";
import type { RememberedResource } from "./resourceMemory";

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
    ],
    [
      "equipment:MITH",
      { id: "equipment:MITH", category: "equipment", name: "mithril", tag: "MITH" }
    ],
    [
      "equipment:ADMT",
      { id: "equipment:ADMT", category: "equipment", name: "admantium", tag: "ADMT" }
    ],
    [
      "equipment:ROOT",
      { id: "equipment:ROOT", category: "equipment", name: "rootstone", tag: "ROOT" }
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

const aSwamp = (units: ReturnType<typeof aReportUnit>[], products = [{ amount: 16, name: "wood", tag: "WOOD" }]) =>
  aReportRegion({ terrain: "swamp", products, units });

const hunter = (level: number, over: Parameters<typeof aReportUnit>[0] = {}) =>
  aReportUnit({ skills: [{ name: "hunting", tag: "HUNT", level, points: 180 }], ...over });

describe("resourceChecksOf (ah-rx0r.2)", () => {
  it("marks a resource absent when an own unit standing here has the skill", () => {
    const checks = resourceChecksOf(aSwamp([hunter(3)]), anIndex());

    expect(checks.map((check) => [check.tag, check.name, check.state])).toEqual([
      ["FLOA", "floater hide", "absent"],
      ["MUSH", "mushroom", "unchecked"]
    ]);
    expect(checks[0].skill).toEqual({ skillTag: "HUNT", skillName: "hunting", level: 3 });
  });

  it("marks a resource unchecked when nobody here could tell", () => {
    const herbalist = aReportUnit({
      skills: [{ name: "herb lore", tag: "HERB", level: 1, points: 50 }]
    });

    expect(resourceChecksOf(aSwamp([herbalist]), anIndex()).map((check) => [check.tag, check.state]))
      .toEqual([
        ["FLOA", "unchecked"],
        ["MUSH", "unchecked"]
      ]);
  });

  it("says nothing about a resource the report already names", () => {
    const region = aSwamp(
      [hunter(3)],
      [
        { amount: 16, name: "wood", tag: "WOOD" },
        { amount: 8, name: "floater hides", tag: "FLOA" }
      ]
    );

    expect(resourceChecksOf(region, anIndex()).map((check) => check.tag)).toEqual(["MUSH"]);
  });

  it("says nothing about a terrain the rules table does not name", () => {
    const region = aReportRegion({ terrain: "mountain", units: [hunter(3)] });

    expect(resourceChecksOf(region, anIndex())).toEqual([]);
  });

  it("says nothing about a resource this terrain cannot hold", () => {
    // The terrain is in the table; it simply does not list a resource anything reveals, so the
    // hunter standing here must not put `0 floater hide` on a mountain.
    const index = anIndex({
      terrainResources: new Map([["mountain", ["IRON", "STON"]]])
    });
    const region = aReportRegion({ terrain: "mountain", units: [hunter(3)] });

    expect(resourceChecksOf(region, index)).toEqual([]);
  });

  it("accepts a level above the one the skill states", () => {
    const checks = resourceChecksOf(aSwamp([hunter(5)]), anIndex());

    expect(checks.find((check) => check.tag === "FLOA")?.state).toBe("absent");
  });

  it("does not read a foreign unit's skills", () => {
    const checks = resourceChecksOf(aSwamp([hunter(3, { own: false })]), anIndex());

    expect(checks.find((check) => check.tag === "FLOA")?.state).toBe("unchecked");
  });

  it("puts the absences before the gaps, each in the rules table's order", () => {
    const index = anIndex({
      revealedBy: new Map([
        ["MITH", { skillTag: "MINI", skillName: "mining", level: 3 }],
        ["ADMT", { skillTag: "MINI", skillName: "mining", level: 5 }],
        ["ROOT", { skillTag: "QUAR", skillName: "quarrying", level: 3 }]
      ]),
      terrainResources: new Map([["mountain", ["IRON", "STON", "MITH", "ROOT", "ADMT"]]])
    });
    const region = aReportRegion({
      terrain: "mountain",
      products: [
        { amount: 25, name: "iron", tag: "IRON" },
        { amount: 10, name: "stone", tag: "STON" }
      ],
      units: [aReportUnit({ skills: [{ name: "mining", tag: "MINI", level: 5, points: 450 }] })]
    });

    expect(resourceChecksOf(region, index).map((check) => [check.tag, check.state])).toEqual([
      ["MITH", "absent"],
      ["ADMT", "absent"],
      ["ROOT", "unchecked"]
    ]);
  });

  it("says nothing while the catalogue cannot say what a terrain holds", () => {
    expect(resourceChecksOf(aSwamp([hunter(3)]), anIndex({ terrainResources: new Map() }))).toEqual(
      []
    );
    expect(resourceChecksOf(aSwamp([hunter(3)]), null)).toEqual([]);
  });

  it("reads the shipped ruleset against the committed swamp", () => {
    const index = parseGameData(
      readFileSync(new URL("../../../config/public/ruleset.json", import.meta.url), "utf8")
    );
    if (index === null) {
      throw new Error("expected the shipped ruleset to parse");
    }
    // swamp (36,46) in Pangmore, turn 23 of neworigins-3.0.0-g5-f21-t23.rep.
    const region = aReportRegion({
      terrain: "swamp",
      products: [
        { amount: 12, name: "livestock", tag: "LIVE" },
        { amount: 16, name: "wood", tag: "WOOD" },
        { amount: 18, name: "herbs", tag: "HERB" }
      ],
      units: [
        aReportUnit({
          unitId: "11851",
          skills: [{ name: "hunting", tag: "HUNT", level: 3, points: 180 }]
        }),
        aReportUnit({
          unitId: "11854",
          skills: [{ name: "hunting", tag: "HUNT", level: 3, points: 180 }]
        }),
        aReportUnit({
          unitId: "9595",
          skills: [{ name: "herb lore", tag: "HERB", level: 1, points: 50 }]
        })
      ]
    });

    expect(resourceChecksOf(region, index)).toEqual([
      {
        tag: "FLOA",
        name: "floater hide",
        state: "absent",
        amount: 0,
        provedOn: null,
        skill: { skillTag: "HUNT", skillName: "hunting", level: 3 }
      },
      {
        tag: "MUSH",
        name: "mushroom",
        state: "unchecked",
        amount: 0,
        provedOn: null,
        skill: { skillTag: "HERB", skillName: "herb lore", level: 3 }
      }
    ]);
  });
});

describe("verdicts carried over from earlier turns (ah-tgtp)", () => {
  const herbalist = aReportUnit({
    skills: [{ name: "herb lore", tag: "HERB", level: 1, points: 50 }]
  });
  const remembered = (over: Partial<RememberedResource> = {}) =>
    new Map<string, RememberedResource>([
      ["FLOA", { tag: "FLOA", amount: 0, name: null, turn: 23, ...over }]
    ]);

  it("carries a proved absence over to a later turn", () => {
    const checks = resourceChecksOf(aSwamp([herbalist]), anIndex(), remembered(), 39);

    expect(checks.map((check) => [check.tag, check.state, check.amount, check.provedOn])).toEqual([
      ["FLOA", "absent", 0, 23],
      ["MUSH", "unchecked", 0, null]
    ]);
    expect(checks[0].name).toBe("floater hide");
  });

  it("carries a proved presence over, with the report's own name", () => {
    const checks = resourceChecksOf(
      aSwamp([herbalist]),
      anIndex(),
      remembered({ amount: 8, name: "floater hides", turn: 25 }),
      39
    );

    expect(checks[0]).toMatchObject({
      tag: "FLOA",
      state: "present",
      amount: 8,
      name: "floater hides",
      provedOn: 25
    });
  });

  it("prefers this turn's own units to anything remembered", () => {
    const checks = resourceChecksOf(
      aSwamp([hunter(3)]),
      anIndex(),
      remembered({ amount: 8, name: "floater hides", turn: 25 }),
      39
    );

    expect(checks[0]).toMatchObject({
      tag: "FLOA",
      state: "absent",
      amount: 0,
      provedOn: null,
      name: "floater hide"
    });
  });

  it("says nothing at all about a resource this turn's report names", () => {
    const region = aSwamp(
      [herbalist],
      [
        { amount: 16, name: "wood", tag: "WOOD" },
        { amount: 8, name: "floater hides", tag: "FLOA" }
      ]
    );

    expect(
      resourceChecksOf(region, anIndex(), remembered(), 39).map((check) => check.tag)
    ).toEqual(["MUSH"]);
  });

  it("ignores a verdict from a turn later than the one being viewed", () => {
    const checks = resourceChecksOf(
      aSwamp([herbalist]),
      anIndex(),
      remembered({ turn: 39 }),
      23
    );

    expect(checks[0]).toMatchObject({ tag: "FLOA", state: "unchecked", provedOn: null });
  });

  it("uses every verdict when the report carries no turn number", () => {
    const checks = resourceChecksOf(
      aSwamp([herbalist]),
      anIndex(),
      remembered({ turn: 39 }),
      null
    );

    expect(checks[0]).toMatchObject({ tag: "FLOA", state: "absent", provedOn: 39 });
  });

  it("puts presences before absences before gaps", () => {
    const index = anIndex({
      revealedBy: new Map([
        ["MITH", { skillTag: "MINI", skillName: "mining", level: 3 }],
        ["ADMT", { skillTag: "MINI", skillName: "mining", level: 5 }],
        ["ROOT", { skillTag: "QUAR", skillName: "quarrying", level: 3 }]
      ]),
      terrainResources: new Map([["mountain", ["IRON", "STON", "MITH", "ROOT", "ADMT"]]])
    });
    const region = aReportRegion({
      terrain: "mountain",
      products: [{ amount: 25, name: "iron", tag: "IRON" }],
      units: [aReportUnit({ skills: [] })]
    });
    const memory = new Map<string, RememberedResource>([
      ["ROOT", { tag: "ROOT", amount: 4, name: "rootstones", turn: 17 }],
      ["ADMT", { tag: "ADMT", amount: 0, name: null, turn: 17 }]
    ]);

    expect(resourceChecksOf(region, index, memory, 20).map((check) => check.tag)).toEqual([
      "ROOT",
      "ADMT",
      "MITH"
    ]);
  });

  it("behaves exactly as it did before when nothing is remembered", () => {
    expect(
      resourceChecksOf(aSwamp([hunter(3)]), anIndex()).map((check) => [check.tag, check.state])
    ).toEqual([
      ["FLOA", "absent"],
      ["MUSH", "unchecked"]
    ]);
  });

  it("reads the shipped ruleset against the committed mountain", () => {
    const index = parseGameData(
      readFileSync(new URL("../../../config/public/ruleset.json", import.meta.url), "utf8")
    );
    if (index === null) {
      throw new Error("expected the shipped ruleset to parse");
    }
    // mountain (42,80) in Sa'endtell, turn 20 of neworigins-3.0.0-g7-f62-t20.rep; turn 17's report
    // proved the mithril, with Drones (7124) carrying mining 3.
    const region = aReportRegion({
      terrain: "mountain",
      products: [
        { amount: 29, name: "grain", tag: "GRAI" },
        { amount: 23, name: "iron", tag: "IRON" },
        { amount: 15, name: "stone", tag: "STON" }
      ],
      units: [aReportUnit({ unitId: "8569", skills: [] })]
    });
    const memory = new Map<string, RememberedResource>([
      ["MITH", { tag: "MITH", amount: 6, name: "mithril", turn: 17 }]
    ]);

    const checks = resourceChecksOf(region, index, memory, 20);

    expect(checks.map((check) => [check.tag, check.state])).toEqual([
      ["MITH", "present"],
      ["ROOT", "unchecked"],
      ["ADMT", "unchecked"]
    ]);
    expect(checks[0]).toMatchObject({ amount: 6, name: "mithril", provedOn: 17 });
  });
});
