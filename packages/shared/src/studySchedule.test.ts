import { describe, expect, it } from "vitest";
import { readRuleset } from "@atlantis/fixtures";
import type { StudyGoal } from "@atlantis/core-client";
import { parseGameData, type GameDataIndex } from "./gameData";
import { buildMagicTree } from "./magicTree";
import {
  SCHEDULE_TURNS,
  hoverCard,
  planLine,
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

/** The six turns every case here is projected over. */
const TURNS = [24, 25, 26, 27, 28, 29];

/** A study goal on each of the turns named. */
function studies(skill: string, ...turns: number[]): StudyGoal[] {
  return turns.map((turn) => ({ kind: "study" as const, turn, skill }));
}

/** One mage, projected alone: what `projectMage` used to answer. */
function project(start: SkillPoints, goals: readonly StudyGoal[], turns: readonly number[] = TURNS) {
  const projected = projectAll({
    mages: [
      { key: "21/2431", unitId: "2431", name: "Ereb", regionId: "1:7", structureId: "1", start, goals }
    ],
    tree,
    turns,
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
  it("plans the turn a goal names, and leaves every other turn idle", () => {
    const { cells } = project(at({ FORC: [3, 270] }), studies("FORC", 26));

    expect(said(cells)).toEqual(["-", "-", "force 4", "-", "-", "-"]);
  });

  it("leaves the gap between two goals on non-adjacent turns idle", () => {
    const { cells } = project(at({ FORC: [3, 270], PATT: [1, 40] }), [
      ...studies("FORC", 24),
      ...studies("PATT", 27)
    ]);

    expect(said(cells)).toEqual(["force 4", "-", "-", "pattern 1", "-", "-"]);
  });

  it("gives six idle cells for an empty plan", () => {
    const { cells } = project(at({ FORC: [3, 270] }), []);

    expect(said(cells)).toEqual(["-", "-", "-", "-", "-", "-"]);
  });

  it("ignores a goal on a turn outside the window", () => {
    const { cells } = project(at({ FORC: [3, 270] }), studies("FORC", 12, 40));

    expect(said(cells)).toEqual(["-", "-", "-", "-", "-", "-"]);
  });

  it("raises a skill a month at a time, on the turns it is planned for", () => {
    // force 3 is 180 points; 4 is 300 and 5 is 450, so a 30-point month reaches 4 on the first
    // turn (300) and 5 on the sixth (450).
    const { cells } = project(at({ FORC: [3, 270] }), studies("FORC", 24, 25, 26, 27, 28, 29));

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

  it("says a maxed skill is already as high as it goes", () => {
    const { cells } = project(at({ FORC: [5, 450] }), studies("FORC", 24));
    const cell = cells[0];

    expect(cell.kind === "study" && cell.blocked).toBe(
      "force is already at 5, the highest there is."
    );
  });

  it("warns about an impossible month and still plans the turns around it", () => {
    // Summoning is locked without spirit; the mage holds only force.
    const { cells } = project(at({ FORC: [2, 100] }), [
      ...studies("SUSK", 24),
      ...studies("FORC", 25)
    ]);

    expect(cells).toHaveLength(SCHEDULE_TURNS);
    const first = cells[0];
    expect(first.kind === "study" && first.blocked).toMatch(/^He cannot begin .* until .*\.$/);
    expect(first.kind === "study" && first.gained).toBe(false);
    expect(said(cells)[1]).toBe("force 2");
  });

  it("records where he stands before each turn, and after the last", () => {
    const { standings } = project(at({ FORC: [3, 270] }), studies("FORC", 24, 25, 26, 27, 28, 29));

    expect(standings).toHaveLength(SCHEDULE_TURNS + 1);
    expect(standings[0].get("FORC")).toEqual({ level: 3, points: 270 });
    expect(standings[SCHEDULE_TURNS].get("FORC")).toEqual({ level: 5, points: 450 });
  });
});

describe("planLine", () => {
  it("names next turn's study", () => {
    expect(planLine(studies("FORC", 24), 24, tree)).toBe("Next turn: force");
  });

  it("names next turn's teaching by name", () => {
    expect(
      planLine(
        [{ kind: "teach", turn: 24, students: ["2517", "2688"] }],
        24,
        tree,
        new Map([
          ["2517", "Sable"],
          ["2688", "Vess"]
        ])
      )
    ).toBe("Next turn: teaches Sable and Vess");
  });

  it("says who is taught by id when no name is known", () => {
    expect(planLine([{ kind: "teach", turn: 24, students: ["2517"] }], 24, tree)).toBe(
      "Next turn: teaches 2517"
    );
  });

  it("says a teach month with no students teaches nobody", () => {
    expect(planLine([{ kind: "teach", turn: 24, students: [] }], 24, tree)).toBe(
      "Next turn: teaches nobody"
    );
  });

  it("says nothing is planned when the plan starts later", () => {
    expect(planLine(studies("FORC", 26), 24, tree)).toBe("Nothing planned for turn 24.");
  });

  it("says nothing is planned when there is no plan at all", () => {
    expect(planLine([], 24, tree)).toBe("Nothing planned for turn 24.");
  });
});

describe("scheduleSummary", () => {
  it("is his strongest magic skill and nothing else", () => {
    expect(scheduleSummary({ start: at({ FORC: [3, 270], PATT: [1, 40] }), tree })).toBe("force 3");
  });

  it("says so when he holds no magic skills", () => {
    expect(scheduleSummary({ start: at({}), tree })).toBe("no magic skills");
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
          goals: [{ kind: "study" as const, turn: 24, skill: "FORC" }],
          comment: "heading for Gate Lore",
          updatedAt: "2026-01-01T00:00:00.000Z"
        }
      ],
      tree,
      turns,
      seats: new Map()
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].summary).toBe("force 3");
    expect(rows[0].hasNote).toBe(true);
    expect(rows[0].cells).toHaveLength(SCHEDULE_TURNS);
  });

  it("gives a mage with no plan an idle row and no pencil", () => {
    const rows = scheduleRows({ groups: groupOf(), plans: [], tree, turns, seats: new Map() });

    expect(rows[0].hasNote).toBe(false);
    expect(rows[0].summary).toBe("force 3");
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
          goals: turns.map((turn) => ({ kind: "study" as const, turn, skill: "FORC" })),
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
          goals: [{ kind: "study" as const, turn: turns[0], skill: "PATT" }],
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
  /** Two turns, as every case here projects over. */
  const FLEET_TURNS = [24, 25];

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
    turns: readonly number[] = FLEET_TURNS
  ) {
    return projectAll({
      mages: mages.map((mage) => ({
        regionId: "1:7",
        structureId: null,
        ...mage
      })),
      tree,
      turns,
      seats
    });
  }

  const teaches = (students: string[]): StudyGoal[] =>
    FLEET_TURNS.map((turn) => ({ kind: "teach", turn, students }));
  const studies = (skill: string): StudyGoal[] =>
    FLEET_TURNS.map((turn) => ({ kind: "study", turn, skill }));

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
