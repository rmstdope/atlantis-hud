import type { ParsedReport } from "@atlantis/core-client";
import { aParsedReport, aReportRegion, aReportUnit, aStructure } from "@atlantis/core-client";
import { readNewAgeArcanumRuleset, readRuleset, readTridentRuleset } from "@atlantis/fixtures";
import { describe, expect, it } from "vitest";
import { parseGameData, type GameDataIndex } from "./gameData";
import { reportNames, rulesetChangeWords, rulesetGaps } from "./rulesetGaps";

function index(text: string): GameDataIndex {
  const parsed = parseGameData(text);
  if (parsed === null) {
    throw new Error("not a ruleset");
  }
  return parsed;
}

const NEW_ORIGINS = index(readRuleset());
const TRIDENT = index(readTridentRuleset());
const ARCANUM = index(readNewAgeArcanumRuleset());
const SHIPPED = [NEW_ORIGINS, ARCANUM, TRIDENT];

/**
 * A New Origins report naming, among ordinary things, what Trident lacks: the gnoll race [GNOL],
 * tarot cards [TARO], annihilation [ANNI] and a Ritual Altar. Every one of these is checked against
 * the committed rulesets (`config/public/ruleset*.json`), not against memory.
 */
function newOriginsReport(): ParsedReport {
  return aParsedReport({
    regions: [
      aReportRegion({
        terrain: "plain",
        products: [{ amount: 31, name: "grain", tag: "GRAI" }],
        forSale: [{ amount: 12, name: "gnolls", tag: "GNOL", price: 50 }],
        wanted: [{ amount: 3, name: "tarot cards", tag: "TARO", price: 90 }],
        structures: [aStructure("Ritual Altar"), aStructure("Fleet, 2 Longships"), aStructure("Fort")],
        units: [
          aReportUnit({
            items: [
              { amount: 4, name: "gnolls", tag: "GNOL" },
              { amount: 17, name: "silver", tag: "SILV" }
            ],
            skills: [
              { name: "annihilation", tag: "ANNI", level: 1, points: 30 },
              { name: "combat", tag: "COMB", level: 1, points: 30 }
            ]
          })
        ]
      })
    ]
  });
}

describe("reportNames", () => {
  it("collects items, skills, structures, races and terrains a report names", () => {
    const names = reportNames(newOriginsReport(), SHIPPED);
    // Repeats are expected (the gnolls are both for sale and in a unit); `rulesetGaps` folds them.
    const byKind = (kind: string) =>
      [...new Set(names.filter((name) => name.kind === kind).map((name) => name.name))].sort();

    expect(byKind("item")).toEqual(["grain", "silver", "tarot cards"]);
    expect(byKind("race")).toEqual(["gnoll"]);
    expect(byKind("skill")).toEqual(["annihilation", "combat"]);
    // The fleet is checked by its vessels, never by the word "Fleet".
    expect(byKind("structure")).toEqual(["Fort", "Longships", "Ritual Altar"]);
    expect(byKind("terrain")).toEqual(["plain"]);
  });

  it("files a tag no shipped ruleset knows under Items, in the report's own spelling", () => {
    const report = aParsedReport({
      regions: [
        aReportRegion({ units: [aReportUnit({ items: [{ amount: 2, name: "zorbles", tag: "ZORB" }] })] })
      ]
    });

    expect(reportNames(report, SHIPPED).filter((name) => name.kind !== "terrain")).toEqual([
      { kind: "item", key: "ZORB", name: "zorbles" }
    ]);
  });
});

describe("rulesetGaps", () => {
  it("lists what Trident does not define in a New Origins report, grouped in order, sorted, each once", () => {
    const gaps = rulesetGaps(
      [
        { turnNumber: 3, report: newOriginsReport() },
        { turnNumber: 4, report: newOriginsReport() }
      ],
      TRIDENT,
      SHIPPED
    );

    expect(gaps.groups).toEqual([
      { kind: "item", names: ["tarot cards"] },
      { kind: "skill", names: ["annihilation"] },
      { kind: "structure", names: ["Ritual Altar"] },
      { kind: "race", names: ["gnoll"] }
    ]);
    expect(gaps.count).toBe(4);
  });

  it("reports nothing for the report's own ruleset", () => {
    const gaps = rulesetGaps([{ turnNumber: 3, report: newOriginsReport() }], NEW_ORIGINS, SHIPPED);

    expect(gaps).toEqual({ totalTurns: 1, affectedTurns: [], groups: [], count: 0 });
  });

  it("counts affected and total turns by turn number, two factions' reports of one turn being one turn", () => {
    const clean = aParsedReport({ regions: [aReportRegion({ terrain: "plain" })] });
    const gaps = rulesetGaps(
      [
        { turnNumber: 1, report: clean },
        { turnNumber: 2, report: newOriginsReport() },
        { turnNumber: 2, report: clean },
        { turnNumber: 4, report: newOriginsReport() }
      ],
      TRIDENT,
      SHIPPED
    );

    expect(gaps.totalTurns).toBe(3);
    expect(gaps.affectedTurns).toEqual([2, 4]);
  });

  it("names a terrain the target has no entry for", () => {
    const report = aParsedReport({ regions: [aReportRegion({ terrain: "nexus" })] });

    expect(rulesetGaps([{ turnNumber: 1, report }], TRIDENT, SHIPPED).groups).toEqual([
      { kind: "terrain", names: ["nexus"] }
    ]);
  });

  it("has nothing missing for a game with no turns", () => {
    expect(rulesetGaps([], TRIDENT, SHIPPED)).toEqual({
      totalTurns: 0,
      affectedTurns: [],
      groups: [],
      count: 0
    });
  });
});

describe("rulesetChangeWords", () => {
  const gaps = {
    totalTurns: 5,
    affectedTurns: [2, 3, 4],
    groups: [
      { kind: "item" as const, names: ["bounty token", "compass"] },
      { kind: "structure" as const, names: ["Canal"] }
    ],
    count: 3
  };

  it("words the warning exactly as agreed", () => {
    const words = rulesetChangeWords("New Age: Trident", gaps);

    expect(words.title).toBe("⚠ Change to New Age: Trident?");
    expect(words.intro).toEqual({
      before: "3 of this game’s 5 turns name 3 things the ",
      ruleset: "New Age: Trident",
      after: " ruleset doesn’t define. They will show without their game data if you change."
    });
    expect(words.turns).toBe("Turns 2, 3, 4");
    expect(words.heading).toBe("Not defined in New Age: Trident");
    expect(words.groups).toEqual([
      { heading: "Items (2)", names: "bounty token, compass" },
      { heading: "Buildings and ships (1)", names: "Canal" }
    ]);
  });

  it("names a single turn in the singular", () => {
    expect(rulesetChangeWords("New Origins", { ...gaps, affectedTurns: [7] }).turns).toBe("Turn 7");
  });

  it("heads every kind as agreed", () => {
    const all = rulesetChangeWords("X", {
      totalTurns: 1,
      affectedTurns: [1],
      groups: [
        { kind: "item", names: ["a"] },
        { kind: "skill", names: ["b"] },
        { kind: "structure", names: ["c"] },
        { kind: "race", names: ["d"] },
        { kind: "terrain", names: ["e"] }
      ],
      count: 5
    });

    expect(all.groups.map((group) => group.heading)).toEqual([
      "Items (1)",
      "Skills (1)",
      "Buildings and ships (1)",
      "Races (1)",
      "Terrains (1)"
    ]);
  });
});
