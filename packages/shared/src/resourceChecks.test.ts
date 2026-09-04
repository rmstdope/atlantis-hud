import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { aReportRegion, aReportUnit } from "@atlantis/core-client";
import { parseGameData, type GameDataEntry, type GameDataIndex } from "./gameData";
import { resourceChecksOf } from "./resourceChecks";

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

  it("says nothing about a resource this terrain cannot hold", () => {
    const region = aReportRegion({ terrain: "mountain", units: [hunter(3)] });

    expect(resourceChecksOf(region, anIndex())).toEqual([]);
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
        skill: { skillTag: "HUNT", skillName: "hunting", level: 3 }
      },
      {
        tag: "MUSH",
        name: "mushroom",
        state: "unchecked",
        skill: { skillTag: "HERB", skillName: "herb lore", level: 3 }
      }
    ]);
  });
});
