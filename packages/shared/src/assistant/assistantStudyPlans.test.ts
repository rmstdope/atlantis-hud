import { describe, expect, it } from "vitest";
import { readRuleset } from "@atlantis/fixtures";
import type { StudyPlanRecord } from "@atlantis/core-client";
import { parseGameData, type GameDataIndex } from "../gameData";
import { buildMagicTree, studyPlannerTree } from "../magicTree";
import { cellLabel, scheduleRows, scheduleTurns } from "../studySchedule";
import { mageShelters } from "../studyShelter";
import { plannerNotices } from "../studyTeaching";
import { NO_TEACHING_RULE } from "../teachingPermission";
import { readyStudyPlans, studyPlansAnswer, type StudyPlannerInputs } from "./assistantStudyPlans";

const tree = studyPlannerTree(buildMagicTree(parseGameData(readRuleset()) as GameDataIndex));

/** A skill that cannot be begun from nothing: the first learnable one with a prerequisite. */
const LOCKED = [...tree.byTag.values()].find((node) => node.learnable && node.within.length > 0)!;

function mage(unitId: string, name: string, regionId: string, skills: { tag: string; level: number; points: number }[]) {
  return {
    key: `3/${unitId}`,
    factionId: "3",
    factionLabel: "Testers (3)",
    unitId,
    name,
    regionId,
    structureId: null,
    sheetTurn: null,
    monthsUnreported: 0,
    skills
  };
}

/** Your faction: Ereb studies force in the open, Vess teaches him from another hex, Sable tries a locked skill, Kesh has no plan. */
const GROUPS = [
  {
    factionId: "3",
    factionLabel: "Testers (3)",
    source: "own" as const,
    heading: "Testers (3) — your faction, turn 23",
    stale: false,
    mages: [
      mage("2431", "Ereb", "1:7", [{ tag: "FORC", level: 3, points: 270 }]),
      mage("2500", "Vess", "1:9", [{ tag: "FORC", level: 5, points: 450 }]),
      mage("2600", "Sable", "1:7", []),
      mage("2700", "Kesh", "1:7", [{ tag: "FORC", level: 1, points: 30 }])
    ]
  }
] as unknown as StudyPlannerInputs["groups"];

function plan(unitId: string, over: Partial<StudyPlanRecord>): StudyPlanRecord {
  return { factionId: "3", unitId, goals: [], casts: [], comment: "", updatedAt: "2026-01-01T00:00:00.000Z", ...over };
}

const PLANS: StudyPlanRecord[] = [
  plan("2431", {
    goals: [
      { kind: "study", turn: 24, skill: "FORC" },
      { kind: "study", turn: 25, skill: "FORC" }
    ],
    comment: "heading for Gate Lore"
  }),
  plan("2500", { goals: [{ kind: "teach", turn: 24, students: ["2431"], live: false }] }),
  plan("2600", { goals: [{ kind: "study", turn: 26, skill: LOCKED.tag }] })
];

const label = (regionId: string) => (regionId === "1:7" ? "plain (7,1)" : "forest (9,1)");

function inputs(over: Partial<StudyPlannerInputs> = {}): StudyPlannerInputs {
  return {
    groups: GROUPS,
    plans: PLANS,
    tree,
    viewedTurn: 23,
    seats: new Map(),
    structureNames: new Map(),
    after: new Map(),
    rule: NO_TEACHING_RULE,
    assumeSheltered: false,
    label,
    ...over
  };
}

/** What the planner dialog itself draws from the same inputs. */
function drawn(input: StudyPlannerInputs) {
  const turns = scheduleTurns(input.viewedTurn);
  const rows = scheduleRows({ ...input, turns });
  const shelters = mageShelters({ groups: input.groups, seats: input.seats, names: input.structureNames, after: input.after });
  const factionLabels = new Map(input.groups.map((group) => [group.factionId, group.factionLabel] as const));
  return { rows, notices: plannerNotices({ rows, turns, label: input.label, factionLabels, shelters }) };
}

describe("a study plan as the assistant reads it", () => {
  it("lists a planned mage's turns and skills as the Schedule draws them", () => {
    const answer = studyPlansAnswer(inputs())!;
    const ereb = answer.mages.find((one) => one.unitId === "2431")!;
    const row = drawn(inputs()).rows.find((one) => one.unitId === "2431")!;

    expect(answer.turns).toEqual([24, 25, 26, 27, 28, 29]);
    expect(answer.forecastAllSheltered).toBe(false);
    expect(ereb).toMatchObject({
      name: "Ereb",
      faction: "Testers (3)",
      own: true,
      region: "plain (7,1)",
      regionId: "1:7",
      note: "heading for Gate Lore",
      skillsNow: ["FORC 3(270)"]
    });
    expect(ereb.turns.map((turn) => turn.turn)).toEqual([24, 25]);
    expect(ereb.turns.map((turn) => turn.shows)).toEqual([cellLabel(row.cells[0]), cellLabel(row.cells[1])]);
    // In the open above level 2 a month is worth half (`rules/magic_skills`): 270 + 15 = 285, still 3.
    expect(ereb.turns[0]).toMatchObject({ study: "FORC", level: 3, points: 285, worth: 0.5, gained: false });
    expect(ereb.skillsAtEnd).toEqual([`FORC ${ereb.turns[1].level}(${ereb.turns[1].points})`]);
  });

  it("names what a teacher teaches, and leaves idle turns out", () => {
    const vess = studyPlansAnswer(inputs())!.mages.find((one) => one.unitId === "2500")!;

    expect(vess.turns).toHaveLength(1);
    expect(vess.turns[0]).toMatchObject({ turn: 24, teach: ["Ereb (2431)"], taught: [] });
  });

  it("says why a blocked month buys nothing, in the planner's words", () => {
    const sable = studyPlansAnswer(inputs())!.mages.find((one) => one.unitId === "2600")!;
    const cell = drawn(inputs()).rows.find((one) => one.unitId === "2600")!.cells[2];

    expect(sable.turns[0].turn).toBe(26);
    expect(sable.turns[0].blocked).toMatch(/^He cannot begin /);
    expect(sable.turns[0].blocked).toBe(cell.kind === "study" ? cell.blocked : "not a study cell");
  });

  it("lists mages with nothing planned by name only", () => {
    const answer = studyPlansAnswer(inputs())!;

    expect(answer.notPlanned).toEqual(["Kesh (2700)"]);
    expect(answer.mages.map((one) => one.unitId)).not.toContain("2700");
  });

  it("carries the planner's warnings verbatim, with the summary its strip shows", () => {
    const answer = studyPlansAnswer(inputs())!;
    const { notices } = drawn(inputs());

    expect(answer.warnings.map((one) => one.text)).toEqual(notices.map((one) => one.text));
    expect(answer.warnings.map((one) => one.text)).toContain(
      "Ereb (2431) is in plain (7,1), not in Vess's hex, so Vess cannot teach him on turn 24."
    );
    expect(answer.warnings.find((one) => one.code === "taught-not-here")).toMatchObject({
      level: "warning",
      unitId: "2500",
      mage: "Vess",
      turn: 24
    });
    expect(answer.summary).toMatch(/warning/);
  });

  it("keeps only the named mage and his own warnings when a unit is asked for", () => {
    const answer = studyPlansAnswer(inputs(), "2500")!;

    expect(answer.mages.map((one) => one.unitId)).toEqual(["2500"]);
    expect(answer.notPlanned).toEqual([]);
    expect(answer.warnings.length).toBeGreaterThan(0);
    expect(answer.warnings.every((one) => one.unitId === "2500")).toBe(true);
  });

  it("finds a mage with nothing planned when he is the one asked for", () => {
    const answer = studyPlansAnswer(inputs(), "2700")!;

    expect(answer.mages).toEqual([]);
    expect(answer.notPlanned).toEqual(["Kesh (2700)"]);
  });

  it("says when the planner shows no such mage", () => {
    expect(studyPlansAnswer(inputs(), "9999")).toBeNull();
    expect(studyPlansAnswer(inputs(), "2431")).not.toBeNull();
  });

  it("forecasts every mage sheltered when the planner does", () => {
    const answer = studyPlansAnswer(inputs({ assumeSheltered: true }))!;

    expect(studyPlansAnswer(inputs())!.warnings.some((one) => one.code === "magic-study-outside-building")).toBe(true);
    expect(answer.forecastAllSheltered).toBe(true);
    expect(answer.warnings.some((one) => one.code === "magic-study-outside-building")).toBe(false);
  });
});

describe("readyStudyPlans", () => {
  const rows = [plan("2431", {})];

  it("answers the rows once the open game's have loaded", () => {
    expect(readyStudyPlans({ gameId: "g", status: "ready", plans: rows }, "g")).toBe(rows);
  });

  it("is loading while they load, or while another game's are held", () => {
    expect(readyStudyPlans({ gameId: "g", status: "loading", plans: [] }, "g")).toBe("loading");
    expect(readyStudyPlans({ gameId: "other", status: "ready", plans: rows }, "g")).toBe("loading");
  });

  it("has failed when the open game's could not be read", () => {
    expect(readyStudyPlans({ gameId: "g", status: "error", plans: [] }, "g")).toBe("failed");
  });
});
