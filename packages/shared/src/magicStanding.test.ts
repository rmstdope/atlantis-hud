import { describe, expect, it } from "vitest";
import { readRuleset } from "@atlantis/fixtures";
import { aReportUnit } from "@atlantis/core-client";
import type { SkillInfo } from "@atlantis/core-client";
import { parseGameData, type GameDataIndex } from "./gameData";
import { buildMagicTree } from "./magicTree";
import { magesOf, openingMage, standingOf, standingsFrom } from "./magicStanding";

const index = parseGameData(readRuleset()) as GameDataIndex;
const tree = buildMagicTree(index);

/** The tags a report writes, as `SkillInfo`s. Points are never read by this module. */
const held = (levels: Record<string, number>): SkillInfo[] =>
  Object.entries(levels).map(([tag, level]) => ({
    name: tag.toLowerCase(),
    tag,
    level,
    points: level * 30
  }));

const standing = (levels: Record<string, number>, overrides = {}) =>
  standingOf(aReportUnit({ skills: held(levels), ...overrides }), tree, index);

/** Six of Seven (881) of the smoke fixture `g7f95t71`, verbatim. */
const SIX_OF_SEVEN = standing({
  FORC: 4,
  PATT: 3,
  SPIR: 3,
  GATE: 1,
  FIRE: 2,
  ILLU: 3,
  PHEN: 1,
  EART: 3,
  BIRD: 3,
  TRUE: 2,
  WOLF: 3,
  DRAG: 3,
  PHDE: 3,
  ARTI: 2,
  EARM: 2,
  WEAT: 3,
  STOR: 3
});

describe("standingsFrom", () => {
  it("answers about a level map, with no report unit in sight", () => {
    const { byTag, counts } = standingsFrom(
      new Map([
        ["FORC", 2],
        ["PATT", 3],
        ["ILLU", 3]
      ]),
      tree
    );

    const illusion = byTag.get("ILLU");
    expect(illusion).toMatchObject({ kind: "ceiling", level: 3, ceiling: 2 });
    expect(illusion?.kind === "ceiling" ? illusion.heldBy.map((need) => need.name) : []).toEqual([
      "force"
    ]);
    expect(byTag.get("FORC")).toEqual({ kind: "known", level: 2, ceiling: 5 });
    expect(counts.known + counts.ceiling + counts.maxed + counts.open + counts.locked).toBe(
      tree.byTag.size
    );
  });
});

describe("standingOf", () => {
  it("separates known, stuck, finished, open and locked", () => {
    const mage = standing({ FORC: 4, PATT: 3, ILLU: 3, ARTI: 2 });

    expect(mage.byTag.get("FORC")).toEqual({ kind: "known", level: 4, ceiling: 5 });
    expect(mage.byTag.get("ILLU")).toMatchObject({ kind: "ceiling", level: 3, ceiling: 3 });
    expect(mage.byTag.get("INVI")).toEqual({ kind: "open", ceiling: 3 });
    expect(mage.byTag.get("CRRI")).toEqual({ kind: "locked" });

    const finished = standing({ FORC: 5 });
    expect(finished.byTag.get("FORC")).toEqual({ kind: "maxed", level: 5 });
  });

  it("names every prerequisite holding a skill down", () => {
    const dragon = SIX_OF_SEVEN.byTag.get("DRAG");
    expect(dragon?.kind).toBe("ceiling");
    expect(dragon?.kind === "ceiling" ? dragon.heldBy.map((need) => need.name) : []).toEqual([
      "bird lore",
      "wolf lore"
    ]);

    const weather = SIX_OF_SEVEN.byTag.get("WEAT");
    expect(weather?.kind === "ceiling" ? weather.heldBy.map((need) => need.name) : []).toEqual([
      "pattern"
    ]);
  });

  it("counts every skill exactly once", () => {
    const counts = SIX_OF_SEVEN.counts;

    expect(counts).toEqual({ known: 8, ceiling: 9, maxed: 0, open: 21, locked: 32 });
    expect(Object.values(counts).reduce((sum, count) => sum + count, 0)).toBe(tree.skillCount);
  });

  it("reports a skill the ruleset has no entry for", () => {
    const mage = standing({ BRTL: 1, OBSE: 5, FORC: 2 });

    expect(mage.missing.map((skill) => skill.tag)).toEqual(["BRTL"]);
  });
});

/**
 * Nine own units in report order: an apprentice, two adepts, four more apprentices and two units
 * that have never studied magic at all.
 */
const UNITS = [
  aReportUnit({ unitId: "10", name: "One of Eight", skills: held({ MANI: 3 }) }),
  aReportUnit({ unitId: "11", name: "Strong but narrow", skills: held({ FORC: 5 }) }),
  aReportUnit({ unitId: "12", name: "Six of Seven", skills: held({ FORC: 4, PATT: 3, ILLU: 3 }) }),
  aReportUnit({ unitId: "13", name: "Two of Eight", skills: held({ MANI: 3 }) }),
  aReportUnit({ unitId: "14", name: "Three of Eight", skills: held({ MANI: 3 }) }),
  aReportUnit({ unitId: "15", name: "Four of Eight", skills: held({ MANI: 3 }) }),
  aReportUnit({ unitId: "16", name: "Five of Eight", skills: held({ MANI: 3 }) }),
  aReportUnit({ unitId: "20", name: "Scouts", skills: [] }),
  aReportUnit({ unitId: "21", name: "Watchers", skills: held({ OBSE: 5 }) })
];

const MAGES = magesOf(UNITS, tree, index);

describe("magesOf", () => {
  it("puts adepts before apprentices", () => {
    expect(MAGES).toHaveLength(7);
    expect(MAGES.map((mage) => mage.unitId)).toEqual(["11", "12", "10", "13", "14", "15", "16"]);
    expect(MAGES.slice(0, 2).every((mage) => mage.adept)).toBe(true);
    expect(MAGES.slice(2).some((mage) => mage.adept)).toBe(false);
  });

  it("counts every skill exactly once for every mage it returns", () => {
    for (const mage of MAGES) {
      const total = Object.values(mage.counts).reduce((sum, count) => sum + count, 0);
      expect(total).toBe(tree.skillCount);
    }
  });
});

describe("openingMage", () => {
  it("opens on the selected unit when it is a mage", () => {
    expect(openingMage(MAGES, "10")?.unitId).toBe("10");
    expect(openingMage(MAGES, "20")?.unitId).toBe("12");
    expect(openingMage(MAGES, null)?.unitId).toBe("12");
    expect(openingMage([], null)).toBeNull();
  });
});
