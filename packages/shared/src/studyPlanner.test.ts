import { describe, expect, it } from "vitest";
import { readRuleset } from "@atlantis/fixtures";
import { aParsedReport, aReportHeaderInfo, aReportUnit } from "@atlantis/core-client";
import type { AlliedMageRecord, SkillInfo } from "@atlantis/core-client";
import { parseGameData, type GameDataIndex } from "./gameData";
import { buildMagicTree } from "./magicTree";
import { standingOf } from "./magicStanding";
import {
  openingPlannerMage,
  plannerAlliedNotice,
  plannerEmptyCopy,
  plannerGroups,
  plannerSummaryLine,
  unreportedLine
} from "./studyPlanner";

const index = parseGameData(readRuleset()) as GameDataIndex;
const tree = buildMagicTree(index);

const held = (levels: Record<string, [number, number]>): SkillInfo[] =>
  Object.entries(levels).map(([tag, [level, points]]) => ({
    name: tag.toLowerCase(),
    tag,
    level,
    points
  }));

const ownUnit = (unitId: string, name: string, levels: Record<string, [number, number]>) =>
  aReportUnit({ unitId, name, skills: held(levels), regionId: "1:7,53" });

const ownStanding = (unitId: string, name: string, levels: Record<string, [number, number]>) =>
  standingOf(ownUnit(unitId, name, levels), tree, index);

const alliedRecord = (
  factionId: string,
  factionName: string | null,
  unitId: string,
  sheetTurn: number,
  levels: Record<string, [number, number]>
): AlliedMageRecord => ({
  factionId,
  factionName,
  unit: aReportUnit({
    unitId,
    name: `Mage ${unitId}`,
    factionId,
    own: false,
    skills: held(levels),
    regionId: "1:9,53"
  }),
  sheetTurn,
  receivedAt: "2026-01-01T00:00:00Z"
});

const report = (overrides = {}) =>
  aParsedReport({
    header: aReportHeaderInfo({ factionId: "95", factionName: "Borg TNG", turnNumber: 71, ...overrides })
  });

/** Force 4, and one skill nothing could move: force is at its ceiling of 4 held by nothing here. */
const SIX = ownStanding("881", "Six of Seven", { FORC: [4, 325], SPIR: [1, 30] });
const ONE = ownStanding("882", "One of Nine", { MANI: [3, 180] });

const groupsOf = (options: {
  ownMages?: ReturnType<typeof ownStanding>[];
  alliedMages?: AlliedMageRecord[];
  reportOverrides?: object;
  viewedTurn?: number | null;
}) =>
  plannerGroups({
    report: report(options.reportOverrides ?? {}),
    ownMages: options.ownMages ?? [SIX, ONE],
    alliedMages: options.alliedMages ?? [],
    tree,
    index,
    viewedTurn: options.viewedTurn === undefined ? 71 : options.viewedTurn
  });

describe("plannerGroups", () => {
  it("puts your own faction first and the allied groups after it, oldest sheet first", () => {
    const groups = groupsOf({
      alliedMages: [
        alliedRecord("17", "Creeping Death", "300", 69, { SPIR: [3, 270] }),
        alliedRecord("21", "Grey Wardens", "400", 71, { PATT: [1, 30] })
      ]
    });
    expect(groups.map((group) => group.factionId)).toEqual(["95", "17", "21"]);
    expect(groups.map((group) => group.source)).toEqual(["own", "sheet", "sheet"]);
  });

  it("heads your own group with the faction, its role and the turn", () => {
    expect(groupsOf({}).at(0)?.heading).toBe("Borg TNG (95) — your faction, turn 71");
    expect(
      groupsOf({ reportOverrides: { factionId: null, factionName: null } }).at(0)?.heading
    ).toBe("Your faction — turn 71");
    expect(
      groupsOf({ reportOverrides: { turnNumber: null }, viewedTurn: null }).at(0)?.heading
    ).toBe("Borg TNG (95) — your faction");
  });

  it("heads an allied group with the mage sheet's own age", () => {
    const groups = groupsOf({
      alliedMages: [alliedRecord("17", "Creeping Death", "300", 69, { SPIR: [3, 270] })]
    });
    expect(groups.at(1)?.heading).toBe("Creeping Death (17) — turn 69 · 2 turns old");
    expect(groups.at(1)?.stale).toBe(true);
    expect(groups.at(0)?.stale).toBe(false);

    const level = groupsOf({
      alliedMages: [alliedRecord("17", "Creeping Death", "300", 71, { SPIR: [3, 270] })]
    });
    expect(level.at(1)?.heading).toBe("Creeping Death (17) — turn 71");
    expect(level.at(1)?.stale).toBe(false);
  });

  it("estimates a stale mage's progress from the report's own point numbers", () => {
    const groups = groupsOf({
      alliedMages: [alliedRecord("17", "Creeping Death", "300", 69, { SPIR: [3, 270], FORC: [5, 450] })]
    });
    const mage = groups[1].mages[0];
    expect(mage.monthsUnreported).toBe(2);
    expect(mage.knows.find((skill) => skill.tag === "SPIR")?.projected).toBe(4);
    // Force is already at the highest there is, so nothing two months could do moves it.
    expect(mage.knows.find((skill) => skill.tag === "FORC")?.projected).toBeNull();
  });

  it("ages every mage of a faction by that faction's newest sheet", () => {
    const groups = groupsOf({
      alliedMages: [
        alliedRecord("17", "Creeping Death", "300", 68, { SPIR: [3, 270] }),
        alliedRecord("17", "Creeping Death", "301", 70, { SPIR: [3, 270] })
      ]
    });
    // The heading says "turn 70 · 1 turn old"; a detail sentence saying "turn 68, 3 turns old"
    // about a row underneath it would be a second answer to the same question.
    expect(groups[1].heading).toBe("Creeping Death (17) — turn 70 · 1 turn old");
    expect(groups[1].mages.map((mage) => mage.monthsUnreported)).toEqual([1, 1]);
    expect(groups[1].mages.map((mage) => mage.sheetTurn)).toEqual([70, 70]);
  });

  it("orders two skills at one level by tag, which is what the row's summary names", () => {
    const mage = plannerGroups({
      report: report(),
      ownMages: [ownStanding("890", "Tied", { SPIR: [3, 180], PATT: [3, 180] })],
      alliedMages: [],
      tree,
      index,
      viewedTurn: 71
    })[0].mages[0];
    expect(mage.knows.map((skill) => skill.tag)).toEqual(["PATT", "SPIR"]);
    expect(mage.summary.startsWith("pattern 3 · ")).toBe(true);
  });

  it("never estimates one of your own mages", () => {
    const mage = groupsOf({}).at(0)?.mages.find((row) => row.unitId === "881");
    expect(mage?.monthsUnreported).toBe(0);
    expect(mage?.knows.every((skill) => skill.projected === null)).toBe(true);
  });

  it("lists what he knows strongest first and what he may study in tree order", () => {
    const mage = groupsOf({}).at(0)?.mages.find((row) => row.unitId === "881");
    expect(mage?.knows.map((skill) => skill.tag)).toEqual(["FORC", "SPIR"]);
    expect(mage?.knows.every((skill) => skill.standing.kind !== "locked")).toBe(true);
    expect(mage?.canStudy.every((node) => node.tag !== "FORC")).toBe(true);
    const order = [...(mage?.canStudy ?? [])].map((node) => node.tag);
    const treeOrder = tree.branches
      .flatMap((branch) => branch.skills.map((skill) => skill.tag))
      .filter((tag) => order.includes(tag));
    expect(order).toEqual(treeOrder);
  });

  it("summarises a row as his strongest skill and what he may begin", () => {
    const mage = groupsOf({}).at(0)?.mages.find((row) => row.unitId === "881");
    expect(mage?.summary).toBe(`force 4 · ${mage?.canStudy.length} can study`);
  });

  it("keys a mage by his faction and his unit", () => {
    const mage = groupsOf({}).at(0)?.mages[0];
    expect(mage?.key).toBe(`95/${mage?.unitId}`);
  });
});

describe("plannerSummaryLine", () => {
  const line = (own: number, allied: [string, number][]) =>
    plannerSummaryLine(
      plannerGroups({
        report: report(),
        ownMages: Array.from({ length: own }, (_, at) =>
          ownStanding(`${900 + at}`, `Mage ${at}`, { FORC: [1, 30] })
        ),
        alliedMages: allied.flatMap(([factionId, count]) =>
          Array.from({ length: count }, (_, at) =>
            alliedRecord(factionId, `Ally ${factionId}`, `${at}`, 71, { FORC: [1, 30] })
          )
        ),
        tree,
        index,
        viewedTurn: 71
      })
    );

  it("counts yours and your allies' apart", () => {
    expect(line(3, [["17", 3], ["21", 1]])).toBe("7 mages — 3 yours, 4 from 2 allies");
    expect(line(3, [])).toBe("3 mages, all yours");
    expect(line(0, [["17", 3], ["21", 1]])).toBe("4 mages from 2 allies");
    expect(line(0, [["17", 1]])).toBe("1 mage from 1 ally");
    expect(line(0, [])).toBeNull();
  });
});

describe("unreportedLine", () => {
  it("says how old the sheet is and what is estimated from it", () => {
    const groups = groupsOf({
      alliedMages: [alliedRecord("17", "Creeping Death", "300", 69, { SPIR: [3, 270] })]
    });
    expect(unreportedLine(groups[1].mages[0])).toBe(
      "From a mage sheet of turn 69, 2 turns old. Up to 2 months of study since it are estimated below and marked →."
    );
  });

  it("says nothing about one of your own mages", () => {
    expect(unreportedLine(groupsOf({}).at(0)!.mages[0])).toBeNull();
  });
});

describe("openingPlannerMage", () => {
  it("opens on the selected unit when he is a mage", () => {
    expect(openingPlannerMage(groupsOf({}), "882")?.unitId).toBe("882");
  });

  it("otherwise opens on your own strongest mage", () => {
    expect(openingPlannerMage(groupsOf({}), null)?.unitId).toBe("881");
    expect(openingPlannerMage(groupsOf({}), "no-such-unit")?.unitId).toBe("881");
  });

  it("opens on an ally's mage only when you have none of your own", () => {
    const groups = groupsOf({
      ownMages: [],
      alliedMages: [alliedRecord("17", "Creeping Death", "300", 69, { SPIR: [3, 270] })]
    });
    expect(openingPlannerMage(groups, null)?.unitId).toBe("300");
    expect(openingPlannerMage([], null)).toBeNull();
  });
});

describe("plannerAlliedNotice", () => {
  it("speaks only while the allied rows are loading or after they failed", () => {
    expect(plannerAlliedNotice("loading", true)).toBe("Loading your allies' mages…");
    expect(plannerAlliedNotice("error", false)).toBe("Your allies' mage sheets could not be read.");
    expect(plannerAlliedNotice("error", true)).toBe(
      "Your allies' mage sheets could not be read. Your own mages are listed below."
    );
    expect(plannerAlliedNotice("idle", true)).toBeNull();
    expect(plannerAlliedNotice("ready", true)).toBeNull();
  });
});

describe("plannerEmptyCopy", () => {
  it("explains where mages come from", () => {
    expect(plannerEmptyCopy({ reportLoaded: false })).toEqual({
      headline: "No mages yet.",
      detail:
        "Your own mages appear when a report is loaded. An ally's appear when you open a mage sheet they sent you."
    });
    expect(plannerEmptyCopy({ reportLoaded: true })).toEqual({
      headline: "No mage in this faction has begun a magic skill.",
      detail: "A one-man leader unit that studies a Foundation becomes one."
    });
  });
});
