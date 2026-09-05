import { describe, expect, it } from "vitest";
import { readRuleset } from "@atlantis/fixtures";
import type { StudyGoal } from "@atlantis/core-client";
import { parseGameData, type GameDataIndex } from "./gameData";
import { buildMagicTree } from "./magicTree";
import {
  SCHEDULE_TURNS,
  goalQueueText,
  hoverCard,
  projectAll,
  scheduleRows,
  scheduleSummary,
  scheduleTurns,
  worthMark,
  type ScheduleCell,
  type ScheduleRow,
  type SkillPoints
} from "./studySchedule";

const index = parseGameData(readRuleset()) as GameDataIndex;
const tree = buildMagicTree(index);

/** A mage's starting points, by upper-cased tag. */
function at(held: Record<string, [number, number]>): SkillPoints {
  return new Map(
    Object.entries(held).map(([tag, [level, points]]) => [tag, { level, points }])
  );
}

/** One mage, projected alone: what `projectMage` used to answer. */
function project(start: SkillPoints, goals: readonly StudyGoal[], turnCount = SCHEDULE_TURNS) {
  const projected = projectAll({
    mages: [
      { key: "21/2431", unitId: "2431", name: "Ereb", regionId: "1:7", structureId: "1", start, goals }
    ],
    tree,
    turnCount,
    // Sheltered, so these cases measure study arithmetic and nothing else; the shelter rule has
    // its own cases below.
    seats: new Map([["1:7/1", 1]])
  });
  return projected.get("21/2431") as { cells: ScheduleCell[]; standings: SkillPoints[] };
}

/** What each cell says, as `skill level` or `-` for an idle one. */
function said(cells: readonly ScheduleCell[]): string[] {
  return cells.map((cell) =>
    cell.kind === "idle" ? "-" : cell.kind === "teach" ? cell.label : `${cell.name} ${cell.level}`
  );
}

describe("scheduleTurns", () => {
  it("counts from the turn after the one being viewed", () => {
    expect(scheduleTurns(23)).toEqual([24, 25, 26, 27, 28, 29]);
  });

  it("is empty before a report is loaded", () => {
    expect(scheduleTurns(null)).toEqual([]);
  });
});

describe("projectAll", () => {
  it("raises a skill towards its goal, a month at a time", () => {
    // force 3 is 180 points; 4 is 300 and 5 is 450, so a 30-point month reaches 4 on the first
    // turn (300) and 5 on the sixth (450).
    const { cells } = project(at({ FORC: [3, 270] }), [{ kind: "study" as const, skill: "FORC", targetLevel: 5 }]);

    expect(said(cells)).toEqual([
      "force 4",
      "force 4",
      "force 4",
      "force 4",
      "force 4",
      "force 5"
    ]);
    expect(cells.map((cell) => cell.kind === "study" && cell.gained)).toEqual([
      true,
      false,
      false,
      false,
      false,
      true
    ]);
  });

  it("runs out when the goal is reached, and idles after it", () => {
    // force 1 is 30 points; 2 is 90 and 3 is 180. From 40, the second month reaches 100 (level 2)
    // and the fifth 190 (level 3).
    const { cells } = project(at({ FORC: [1, 40] }), [{ kind: "study" as const, skill: "FORC", targetLevel: 3 }]);

    expect(said(cells)).toEqual(["force 1", "force 2", "force 2", "force 2", "force 3", "-"]);
  });

  it("gives a goal with no level exactly one turn", () => {
    const { cells } = project(at({ FORC: [3, 270], PATT: [1, 40] }), [
      { kind: "study" as const, skill: "FORC", targetLevel: null },
      { kind: "study" as const, skill: "PATT", targetLevel: 2 }
    ]);

    expect(said(cells).slice(0, 3)).toEqual(["force 4", "pattern 1", "pattern 2"]);
  });

  it("re-flows the queue: the next goal begins the turn the one before it arrives", () => {
    const { cells } = project(at({ FORC: [3, 270], PATT: [2, 100] }), [
      { kind: "study" as const, skill: "FORC", targetLevel: 4 },
      { kind: "study" as const, skill: "PATT", targetLevel: 3 }
    ]);

    expect(said(cells)).toEqual([
      "force 4",
      "pattern 2",
      "pattern 2",
      "pattern 3",
      "-",
      "-"
    ]);
  });

  it("skips a goal already satisfied at the start, and it costs no column", () => {
    const { cells } = project(at({ FORC: [4, 300], PATT: [2, 100] }), [
      { kind: "study" as const, skill: "FORC", targetLevel: 4 },
      { kind: "study" as const, skill: "PATT", targetLevel: 3 }
    ]);

    expect(said(cells)[0]).toBe("pattern 2");
  });

  it("warns once about an impossible goal and moves on, without running out of cells", () => {
    // Summoning is locked without spirit; the mage holds only force.
    const { cells } = project(at({ FORC: [2, 100] }), [
      { kind: "study" as const, skill: "SUSK", targetLevel: 2 },
      { kind: "study" as const, skill: "FORC", targetLevel: 3 }
    ]);

    expect(cells).toHaveLength(SCHEDULE_TURNS);
    const first = cells[0];
    expect(first.kind === "study" && first.blocked).toMatch(/^He cannot begin .* until .*\.$/);
    expect(first.kind === "study" && first.gained).toBe(false);
    expect(said(cells)[1]).toBe("force 2");
  });

  it("says a maxed skill is already as high as it goes", () => {
    const { cells } = project(at({ FORC: [5, 450] }), [{ kind: "study" as const, skill: "FORC", targetLevel: 5 }]);

    // The goal is satisfied, so nothing is planned at all - the queue is empty from the start.
    expect(said(cells)[0]).toBe("-");

    const anyway = project(at({ FORC: [5, 450] }), [{ kind: "study" as const, skill: "FORC", targetLevel: null }]);
    const cell = anyway.cells[0];
    expect(cell.kind === "study" && cell.blocked).toBe(
      "force is already at 5, the highest there is."
    );
  });

  it("records where he stands before each turn, and after the last", () => {
    const { standings } = project(at({ FORC: [3, 270] }), [{ kind: "study" as const, skill: "FORC", targetLevel: 5 }]);

    expect(standings).toHaveLength(SCHEDULE_TURNS + 1);
    expect(standings[0].get("FORC")).toEqual({ level: 3, points: 270 });
    expect(standings[SCHEDULE_TURNS].get("FORC")).toEqual({ level: 5, points: 450 });
  });
});

describe("goalQueueText", () => {
  it("names each goal and its level, in order", () => {
    expect(
      goalQueueText(
        [
          { kind: "study" as const, skill: "FORC", targetLevel: 4 },
          { kind: "study" as const, skill: "PATT", targetLevel: 3 }
        ],
        tree
      )
    ).toBe("force → 4, then pattern → 3");
  });

  it("names one goal alone", () => {
    expect(goalQueueText([{ kind: "study" as const, skill: "FORC", targetLevel: 4 }], tree)).toBe("force → 4");
  });

  it("is null for an empty queue", () => {
    expect(goalQueueText([], tree)).toBeNull();
  });
});

describe("scheduleSummary", () => {
  const start = at({ FORC: [3, 270] });

  it("names his reach and what he is aiming at", () => {
    expect(
      scheduleSummary({
        start,
        goals: [
          { kind: "study" as const, skill: "FORC", targetLevel: 5 },
          { kind: "study" as const, skill: "PATT", targetLevel: 3 }
        ],
        tree
      })
    ).toBe("force 3 · force → 5, then pattern → 3");
  });

  it("says nothing is planned when there is no queue", () => {
    expect(scheduleSummary({ start, goals: [], tree })).toBe("force 3 · nothing planned");
  });

  it("says the goal is reached when the queue is stored but satisfied", () => {
    expect(
      scheduleSummary({
        start: at({ FORC: [4, 300] }),
        goals: [{ kind: "study" as const, skill: "FORC", targetLevel: 4 }],
        tree
      })
    ).toBe("force 4 · goal reached");
  });
});

/** A planner group of one mage, as `plannerGroups` shapes it. */
function groupOf(
  overrides: {
    skills?: { tag: string; level: number; points: number }[];
    monthsUnreported?: number;
    sheetTurn?: number | null;
  } = {}
) {
  return [
    {
      factionId: "21",
      factionLabel: "Wardens of the North (12)",
      source: "sheet" as const,
      heading: "Wardens of the North (12) — turn 20",
      stale: (overrides.monthsUnreported ?? 0) > 0,
      mages: [
        {
          key: "21/2431",
          factionId: "21",
          factionLabel: "Wardens of the North (12)",
          unitId: "2431",
          name: "Ereb",
          regionId: "1:7,53",
          sheetTurn: overrides.sheetTurn ?? null,
          monthsUnreported: overrides.monthsUnreported ?? 0,
          skills: overrides.skills ?? [{ tag: "FORC", level: 3, points: 270 }]
        }
      ]
    }
  ] as unknown as Parameters<typeof scheduleRows>[0]["groups"];
}

describe("scheduleRows", () => {
  const turns = scheduleTurns(23);

  it("gives every mage a row of the plan he has", () => {
    const rows = scheduleRows({
      groups: groupOf(),
      plans: [
        {
          factionId: "21",
          unitId: "2431",
          goals: [{ kind: "study" as const, skill: "FORC", targetLevel: 4 }],
          comment: "heading for Gate Lore",
          updatedAt: "2026-01-01T00:00:00.000Z"
        }
      ],
      tree,
      turns,
      seats: new Map()
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].summary).toBe("force 3 · force → 4");
    expect(rows[0].hasNote).toBe(true);
    expect(rows[0].cells).toHaveLength(SCHEDULE_TURNS);
  });

  it("gives a mage with no plan an idle row and no pencil", () => {
    const rows = scheduleRows({ groups: groupOf(), plans: [], tree, turns, seats: new Map() });

    expect(rows[0].hasNote).toBe(false);
    expect(rows[0].summary).toBe("force 3 · nothing planned");
    expect(rows[0].cells.every((cell) => cell.kind === "idle")).toBe(true);
  });

  it("starts an ally's stale mage from his sheet's own points", () => {
    const rows = scheduleRows({
      groups: groupOf({ monthsUnreported: 3, sheetTurn: 20 }),
      plans: [],
      tree,
      turns,
      seats: new Map()
    });

    expect(rows[0].standings[0].get("FORC")).toEqual({ level: 3, points: 270 });
  });
});

describe("hoverCard", () => {
  const turns = scheduleTurns(23);

  function row(overrides: Parameters<typeof groupOf>[0] = {}): ScheduleRow {
    return scheduleRows({
      groups: groupOf(overrides),
      plans: [
        {
          factionId: "21",
          unitId: "2431",
          goals: [{ kind: "study" as const, skill: "FORC", targetLevel: 5 }],
          comment: "",
          updatedAt: "2026-01-01T00:00:00.000Z"
        }
      ],
      tree,
      turns,
      seats: new Map()
    })[0];
  }

  it("names the mage, the turn, his faction and what he studies", () => {
    const card = hoverCard(row(), 2, turns, tree, "Wardens of the North (12)");

    expect(card.heading).toBe("Ereb (2431) — turn 26");
    expect(card.sub).toBe("Wardens of the North (12) · studying force");
    expect(card.lines.find((line) => line.name === "force")?.studying).toBe(true);
  });

  it("names the threshold he has just crossed on the turn a level is gained", () => {
    const card = hoverCard(row(), 0, turns, tree, "Wardens of the North (12)");

    expect(card.lines.find((line) => line.name === "force")?.right).toBe("3 → 4  (300 of 300)");
  });

  it("names the next threshold while he is still climbing towards it", () => {
    const card = hoverCard(row(), 1, turns, tree, "Wardens of the North (12)");

    expect(card.lines.find((line) => line.name === "force")?.right).toBe("4 → 4  (330 of 450)");
  });

  it("gives a skill he begins that turn a line of its own", () => {
    const beginning = scheduleRows({
      groups: groupOf({ skills: [{ tag: "FORC", level: 3, points: 270 }] }),
      plans: [
        {
          factionId: "21",
          unitId: "2431",
          goals: [{ kind: "study" as const, skill: "PATT", targetLevel: 1 }],
          comment: "",
          updatedAt: "2026-01-01T00:00:00.000Z"
        }
      ],
      tree,
      turns,
      seats: new Map()
    })[0];
    const card = hoverCard(beginning, 0, turns, tree, "x");

    expect(card.sub).toBe("x · studying pattern");
    const pattern = card.lines.find((line) => line.name === "pattern");
    expect(pattern?.studying).toBe(true);
    expect(pattern?.right).toBe("0 → 1  (30 of 30)");
  });

  it("never names a threshold above the skill's own maximum", () => {
    const maxed = scheduleRows({
      groups: groupOf({ skills: [{ tag: "FORC", level: 5, points: 450 }] }),
      plans: [],
      tree,
      turns,
      seats: new Map()
    })[0];
    const card = hoverCard(maxed, 0, turns, tree, "x");

    // 630 is what the level formula gives for a sixth level the game does not have.
    expect(card.lines.find((line) => line.name === "force")?.right).toBe("5 → 5  (450 of 450)");
  });

  it("says what it was projected from", () => {
    expect(hoverCard(row(), 0, turns, tree, "x").foot).toBe(
      "Projected from turn 23's report at 30 points a studied month."
    );
  });

  it("says nothing is assumed about a stale sheet's missing turns", () => {
    const stale = row({ monthsUnreported: 3, sheetTurn: 20 });

    expect(hoverCard(stale, 0, turns, tree, "x").foot).toBe(
      "From a mage sheet of turn 20. Nothing is assumed about the 3 turns since."
    );
  });
});

describe("projectAll across the whole fleet", () => {
  /** Two or more mages, projected together. */
  function fleet(
    mages: {
      key: string;
      unitId: string;
      name: string;
      regionId?: string;
      structureId?: string | null;
      start: SkillPoints;
      goals: readonly StudyGoal[];
    }[],
    seats: ReadonlyMap<string, number | null> = new Map(),
    turnCount = 2
  ) {
    return projectAll({
      mages: mages.map((mage) => ({
        regionId: "1:7",
        structureId: null,
        ...mage
      })),
      tree,
      turnCount,
      seats
    });
  }

  const teaches = (students: string[]): StudyGoal[] => [{ kind: "teach", students }];
  const studies = (skill: string, targetLevel: number | null = null): StudyGoal[] => [
    { kind: "study", skill, targetLevel }
  ];

  it("has the teacher study nothing that month", () => {
    const out = fleet([
      { key: "a", unitId: "1", name: "Ereb", start: at({ FORC: [3, 270] }), goals: teaches(["2"]) },
      { key: "b", unitId: "2", name: "Sable", start: at({ FORC: [1, 30] }), goals: studies("FORC") }
    ]);

    const cell = out.get("a")?.cells[0];
    expect(cell?.kind).toBe("teach");
    // He ends the turn exactly where he began it: `rules/teach` spends the whole month.
    expect(out.get("a")?.standings[1].get("FORC")).toEqual({ level: 3, points: 270 });
  });

  // `rules/skills_teaching`: "A unit with a teacher can learn up to twice as fast as normal."
  it("makes a taught month worth two", () => {
    const out = fleet([
      { key: "a", unitId: "1", name: "Ereb", start: at({ FORC: [3, 270] }), goals: teaches(["2"]) },
      { key: "b", unitId: "2", name: "Sable", start: at({ FORC: [1, 30] }), goals: studies("FORC") }
    ]);

    const cell = out.get("b")?.cells[0];
    expect(cell?.kind === "study" && cell.worth).toBe(2);
    expect(cell?.kind === "study" && cell.taughtBy).toBe("a");
    expect(out.get("b")?.standings[1].get("FORC")?.points).toBe(90);
  });

  it("names the students it actually teaches", () => {
    const out = fleet([
      { key: "a", unitId: "1", name: "Ereb", start: at({ FORC: [3, 270] }), goals: teaches(["2"]) },
      { key: "b", unitId: "2", name: "Sable", start: at({ FORC: [1, 30] }), goals: studies("FORC") }
    ]);

    const cell = out.get("a")?.cells[0];
    expect(cell?.kind === "teach" && cell.label).toBe("TEACH Sable");
  });

  // `rules/teach` teaches units present with the teacher; a hex away is not present.
  it("does not teach a student in another hex", () => {
    const out = fleet([
      { key: "a", unitId: "1", name: "Ereb", start: at({ FORC: [3, 270] }), goals: teaches(["2"]) },
      {
        key: "b",
        unitId: "2",
        name: "Sable",
        regionId: "2:8",
        start: at({ FORC: [1, 30] }),
        goals: studies("FORC")
      }
    ]);

    const teach = out.get("a")?.cells[0];
    expect(teach?.kind === "teach" && teach.outcome.refused[0]).toEqual({
      kind: "elsewhere",
      unitId: "2",
      regionId: "2:8"
    });
    expect(teach?.kind === "teach" && teach.label).toBe("TEACH nobody");
    const study = out.get("b")?.cells[0];
    expect(study?.kind === "study" && study.worth).toBe(1);
  });

  // "The unit doing the teaching must have a skill level greater than the unit doing the studying".
  it("teaches nothing to a student the teacher does not outrank", () => {
    const out = fleet([
      { key: "a", unitId: "1", name: "Ereb", start: at({ FORC: [2, 90] }), goals: teaches(["2"]) },
      { key: "b", unitId: "2", name: "Sable", start: at({ FORC: [2, 90] }), goals: studies("FORC") }
    ]);

    const teach = out.get("a")?.cells[0];
    expect(teach?.kind === "teach" && teach.outcome.refused[0]).toMatchObject({
      kind: "outranked",
      unitId: "2",
      teacherLevel: 2,
      studentLevel: 2
    });
  });

  // `rules/skills_teaching` describes one doubling and no rule for a second teacher.
  it("teaches a student named by two teachers once", () => {
    const out = fleet([
      { key: "a", unitId: "1", name: "Ereb", start: at({ FORC: [3, 270] }), goals: teaches(["3"]) },
      { key: "b", unitId: "2", name: "Vess", start: at({ FORC: [3, 270] }), goals: teaches(["3"]) },
      { key: "c", unitId: "3", name: "Sable", start: at({ FORC: [1, 30] }), goals: studies("FORC") }
    ]);

    const second = out.get("b")?.cells[0];
    expect(second?.kind === "teach" && second.outcome.refused[0]).toEqual({
      kind: "taken",
      unitId: "3",
      byName: "Ereb"
    });
    const study = out.get("c")?.cells[0];
    expect(study?.kind === "study" && study.worth).toBe(2);
  });

  // `rules/magic_skills`: "If the mage is not in such a structure, his study rate is cut in half."
  it("halves an unsheltered month above level two", () => {
    const out = fleet([
      { key: "a", unitId: "1", name: "Ereb", start: at({ FORC: [2, 90] }), goals: studies("FORC") }
    ]);

    const cell = out.get("a")?.cells[0];
    expect(cell?.kind === "study" && cell.unsheltered).toBe(true);
    expect(cell?.kind === "study" && cell.worth).toBe(0.5);
    expect(out.get("a")?.standings[1].get("FORC")?.points).toBe(105);
  });

  it("asks no seat of a mage below level two", () => {
    const out = fleet([
      { key: "a", unitId: "1", name: "Ereb", start: at({ FORC: [1, 30] }), goals: studies("FORC") }
    ]);

    const cell = out.get("a")?.cells[0];
    expect(cell?.kind === "study" && cell.unsheltered).toBe(false);
    expect(cell?.kind === "study" && cell.worth).toBe(1);
  });

  it("gives the fort's one seat to the first mage in order", () => {
    const seats = new Map([["1:7/3", 1]]);
    const out = fleet(
      [
        {
          key: "a",
          unitId: "1",
          name: "Ereb",
          structureId: "3",
          start: at({ FORC: [2, 90] }),
          goals: studies("FORC")
        },
        {
          key: "b",
          unitId: "2",
          name: "Sable",
          structureId: "3",
          start: at({ FORC: [2, 90] }),
          goals: studies("FORC")
        }
      ],
      seats
    );

    expect(out.get("a")?.cells[0]).toMatchObject({ unsheltered: false, worth: 1 });
    expect(out.get("b")?.cells[0]).toMatchObject({ unsheltered: true, worth: 0.5 });
  });

  // H2 was chosen to make the dates true, not to make them pessimistic out of ignorance.
  it("does not halve a month whose shelter is unknown", () => {
    const out = fleet([
      {
        key: "a",
        unitId: "1",
        name: "Ereb",
        structureId: "9",
        start: at({ FORC: [2, 90] }),
        goals: studies("FORC")
      }
    ]);

    const cell = out.get("a")?.cells[0];
    expect(cell?.kind === "study" && cell.unsheltered).toBe(false);
    expect(cell?.kind === "study" && cell.shelterUnknown).toBe(true);
    expect(cell?.kind === "study" && cell.worth).toBe(1);
  });
});

describe("worthMark", () => {
  it("says nothing when nothing modified the month", () => {
    expect(worthMark(1)).toBe("");
  });

  it("marks a doubled, a diluted and a halved month", () => {
    expect(worthMark(2)).toBe("×2");
    expect(worthMark(1.5)).toBe("×1½");
    expect(worthMark(0.5)).toBe("×½");
  });

  it("falls back to one decimal", () => {
    expect(worthMark(1.3)).toBe("×1.3");
  });

  it("draws ×1 when something modified the month and it came out at one", () => {
    // A taught but unsheltered month: silence would hide that the two effects cancelled.
    expect(worthMark(1, true)).toBe("×1");
    expect(worthMark(1, false)).toBe("");
  });
});
