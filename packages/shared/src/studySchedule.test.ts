import { describe, expect, it } from "vitest";
import { readRuleset } from "@atlantis/fixtures";
import type { StudyGoal } from "@atlantis/core-client";
import { parseGameData, type GameDataIndex } from "./gameData";
import { buildMagicTree } from "./magicTree";
import {
  SCHEDULE_TURNS,
  goalQueueText,
  hoverCard,
  projectMage,
  scheduleRows,
  scheduleSummary,
  scheduleTurns,
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

function project(start: SkillPoints, goals: readonly StudyGoal[], turnCount = SCHEDULE_TURNS) {
  return projectMage({ start, goals, tree, turnCount });
}

/** What each cell says, as `skill level` or `-` for an idle one. */
function said(cells: ReturnType<typeof project>["cells"]): string[] {
  return cells.map((cell) => (cell.kind === "idle" ? "-" : `${cell.name} ${cell.level}`));
}

describe("scheduleTurns", () => {
  it("counts from the turn after the one being viewed", () => {
    expect(scheduleTurns(23)).toEqual([24, 25, 26, 27, 28, 29]);
  });

  it("is empty before a report is loaded", () => {
    expect(scheduleTurns(null)).toEqual([]);
  });
});

describe("projectMage", () => {
  it("raises a skill towards its goal, a month at a time", () => {
    // force 3 is 180 points; 4 is 300 and 5 is 450, so a 30-point month reaches 4 on the first
    // turn (300) and 5 on the sixth (450).
    const { cells } = project(at({ FORC: [3, 270] }), [{ skill: "FORC", targetLevel: 5 }]);

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
    const { cells } = project(at({ FORC: [1, 40] }), [{ skill: "FORC", targetLevel: 3 }]);

    expect(said(cells)).toEqual(["force 1", "force 2", "force 2", "force 2", "force 3", "-"]);
  });

  it("gives a goal with no level exactly one turn", () => {
    const { cells } = project(at({ FORC: [3, 270], PATT: [1, 40] }), [
      { skill: "FORC", targetLevel: null },
      { skill: "PATT", targetLevel: 2 }
    ]);

    expect(said(cells).slice(0, 3)).toEqual(["force 4", "pattern 1", "pattern 2"]);
  });

  it("re-flows the queue: the next goal begins the turn the one before it arrives", () => {
    const { cells } = project(at({ FORC: [3, 270], PATT: [2, 100] }), [
      { skill: "FORC", targetLevel: 4 },
      { skill: "PATT", targetLevel: 3 }
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
      { skill: "FORC", targetLevel: 4 },
      { skill: "PATT", targetLevel: 3 }
    ]);

    expect(said(cells)[0]).toBe("pattern 2");
  });

  it("warns once about an impossible goal and moves on, without running out of cells", () => {
    // Summoning is locked without spirit; the mage holds only force.
    const { cells } = project(at({ FORC: [2, 100] }), [
      { skill: "SUSK", targetLevel: 2 },
      { skill: "FORC", targetLevel: 3 }
    ]);

    expect(cells).toHaveLength(SCHEDULE_TURNS);
    const first = cells[0];
    expect(first.kind === "study" && first.blocked).toMatch(/^He cannot begin .* until .*\.$/);
    expect(first.kind === "study" && first.gained).toBe(false);
    expect(said(cells)[1]).toBe("force 2");
  });

  it("says a maxed skill is already as high as it goes", () => {
    const { cells } = project(at({ FORC: [5, 450] }), [{ skill: "FORC", targetLevel: 5 }]);

    // The goal is satisfied, so nothing is planned at all - the queue is empty from the start.
    expect(said(cells)[0]).toBe("-");

    const anyway = project(at({ FORC: [5, 450] }), [{ skill: "FORC", targetLevel: null }]);
    const cell = anyway.cells[0];
    expect(cell.kind === "study" && cell.blocked).toBe(
      "force is already at 5, the highest there is."
    );
  });

  it("records where he stands before each turn, and after the last", () => {
    const { standings } = project(at({ FORC: [3, 270] }), [{ skill: "FORC", targetLevel: 5 }]);

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
          { skill: "FORC", targetLevel: 4 },
          { skill: "PATT", targetLevel: 3 }
        ],
        tree
      )
    ).toBe("force → 4, then pattern → 3");
  });

  it("names one goal alone", () => {
    expect(goalQueueText([{ skill: "FORC", targetLevel: 4 }], tree)).toBe("force → 4");
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
          { skill: "FORC", targetLevel: 5 },
          { skill: "PATT", targetLevel: 3 }
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
        goals: [{ skill: "FORC", targetLevel: 4 }],
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
          goals: [{ skill: "FORC", targetLevel: 4 }],
          comment: "heading for Gate Lore",
          updatedAt: "2026-01-01T00:00:00.000Z"
        }
      ],
      tree,
      turns
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].summary).toBe("force 3 · force → 4");
    expect(rows[0].hasNote).toBe(true);
    expect(rows[0].cells).toHaveLength(SCHEDULE_TURNS);
  });

  it("gives a mage with no plan an idle row and no pencil", () => {
    const rows = scheduleRows({ groups: groupOf(), plans: [], tree, turns });

    expect(rows[0].hasNote).toBe(false);
    expect(rows[0].summary).toBe("force 3 · nothing planned");
    expect(rows[0].cells.every((cell) => cell.kind === "idle")).toBe(true);
  });

  it("starts an ally's stale mage from his sheet's own points", () => {
    const rows = scheduleRows({
      groups: groupOf({ monthsUnreported: 3, sheetTurn: 20 }),
      plans: [],
      tree,
      turns
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
          goals: [{ skill: "FORC", targetLevel: 5 }],
          comment: "",
          updatedAt: "2026-01-01T00:00:00.000Z"
        }
      ],
      tree,
      turns
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
