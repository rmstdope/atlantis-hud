import { describe, expect, it } from "vitest";
import { readRuleset } from "@atlantis/fixtures";
import { parseGameData, type GameDataIndex } from "./gameData";
import { buildMagicTree } from "./magicTree";
import { cellMenu, cellWarning, goalsAfterClear, goalsAfterSet } from "./studyCell";
import { projectMage, type ScheduleRow, type SkillPoints } from "./studySchedule";

const index = parseGameData(readRuleset()) as GameDataIndex;
const tree = buildMagicTree(index);

function at(held: Record<string, [number, number]>): SkillPoints {
  return new Map(Object.entries(held).map(([tag, [level, points]]) => [tag, { level, points }]));
}

const STANDING = at({ FORC: [4, 300], PATT: [2, 100] });

function menu(turn = 27) {
  return cellMenu({ mageName: "Ereb", turn, standing: STANDING, tree });
}

describe("cellMenu", () => {
  it("says whose turn it is and where he will stand by then", () => {
    expect(menu().heading).toBe("From turn 27, Ereb studies");
    expect(menu().sub).toBe("He will be force 4, pattern 2 by then.");
  });

  it("holds nothing back when he holds nothing", () => {
    const empty = cellMenu({ mageName: "Ereb", turn: 27, standing: new Map(), tree });

    expect(empty.sub).toBeNull();
    expect(empty.raise).toEqual([]);
    expect(empty.begin.length).toBeGreaterThan(0);
  });

  it("puts every skill in exactly one group, and only blocked ones in Not yet", () => {
    const { raise, begin, notYet } = menu();

    expect(raise.length + begin.length + notYet.length).toBe(tree.byTag.size);
    expect(notYet.every((choice) => choice.blocked !== null)).toBe(true);
    expect([...raise, ...begin].every((choice) => choice.blocked === null)).toBe(true);
  });

  it("walks each group in the tree's own order", () => {
    const order = [...tree.byTag.keys()];
    for (const group of [menu().raise, menu().begin, menu().notYet]) {
      const positions = group.map((choice) => order.indexOf(choice.skill));
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
    }
  });

  it("says where a raisable skill starts from", () => {
    expect(menu().raise.find((choice) => choice.skill === "FORC")?.detail).toBe("from 4");
  });

  it("says what a blocked skill wants, and what he will actually hold", () => {
    const summoning = menu().notYet.find((choice) => choice.skill === "SUSK");

    expect(summoning?.detail).toBe("needs necromancy 1, he will have 0");
  });

  it("joins two prerequisites the way the magic tree joins them", () => {
    const twoNeeds = menu().notYet.find(
      (choice) =>
        [
          ...(tree.byTag.get(choice.skill)?.within ?? []),
          ...(tree.byTag.get(choice.skill)?.crossing ?? [])
        ].length === 2
    );

    expect(twoNeeds?.detail).toMatch(/^needs .+ and .+$/);
    expect(twoNeeds?.detail).not.toContain(";");
  });

  it("offers the levels above the one he holds", () => {
    expect(menu().raise.find((choice) => choice.skill === "PATT")?.levels).toEqual([3, 4, 5]);
    expect(menu().begin[0]?.levels).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("cellWarning", () => {
  it("says nothing about a skill he can study", () => {
    const force = menu().raise.find((choice) => choice.skill === "FORC");

    expect(cellWarning(force!, 27, "Ereb")).toBeNull();
  });

  it("warns that an impossible goal is being saved anyway", () => {
    const blocked = menu().notYet[0];

    expect(cellWarning(blocked, 27, "Ereb")).toBe(
      `Ereb cannot study ${blocked.name} by turn 27. The plan will say so anyway.`
    );
  });
});

/** A row projected from `start` and `goals`, as the Schedule draws it. */
function rowOf(start: SkillPoints, goals: { skill: string; targetLevel: number | null }[]): ScheduleRow {
  const { cells, standings } = projectMage({ start, goals, tree, turnCount: 6 });
  return {
    key: "21/2431",
    factionId: "21",
    unitId: "2431",
    name: "Ereb",
    summary: "",
    hasNote: false,
    goals,
    cells,
    standings,
    monthsUnreported: 0,
    sheetTurn: null
  };
}

describe("goalsAfterSet", () => {
  // force 3 at 270 reaches 4 on the first turn and 5 on the sixth.
  const goals = [{ skill: "FORC", targetLevel: 5 }];
  const row = rowOf(at({ FORC: [3, 270] }), goals);

  it("truncates the running goal to the level he holds at that turn", () => {
    expect(goalsAfterSet(goals, row, 2, { skill: "PATT", targetLevel: 3 })).toEqual([
      { skill: "FORC", targetLevel: 4 },
      { skill: "PATT", targetLevel: 3 }
    ]);
  });

  it("drops the running goal entirely when the cell is its first turn", () => {
    expect(goalsAfterSet(goals, row, 0, { skill: "PATT", targetLevel: 3 })).toEqual([
      { skill: "PATT", targetLevel: 3 }
    ]);
  });

  it("drops everything after the cell", () => {
    const queue = [
      { skill: "FORC", targetLevel: 4 },
      { skill: "PATT", targetLevel: 3 },
      { skill: "SPIR", targetLevel: 2 }
    ];
    const reflowed = rowOf(at({ FORC: [3, 270], PATT: [2, 100] }), queue);

    expect(goalsAfterSet(queue, reflowed, 1, { skill: "SPIR", targetLevel: 1 })).toEqual([
      { skill: "FORC", targetLevel: 4 },
      { skill: "SPIR", targetLevel: 1 }
    ]);
  });

  it("simply appends on an idle cell", () => {
    const short = rowOf(at({ FORC: [3, 270] }), [{ skill: "FORC", targetLevel: 4 }]);

    expect(
      goalsAfterSet([{ skill: "FORC", targetLevel: 4 }], short, 3, {
        skill: "PATT",
        targetLevel: 2
      })
    ).toEqual([
      { skill: "FORC", targetLevel: 4 },
      { skill: "PATT", targetLevel: 2 }
    ]);
  });
});

describe("goalsAfterClear", () => {
  const goals = [
    { skill: "FORC", targetLevel: 5 },
    { skill: "PATT", targetLevel: 3 }
  ];
  const row = rowOf(at({ FORC: [3, 270] }), goals);

  it("drops the tail and keeps what is drawn to the left", () => {
    expect(goalsAfterClear(goals, row, 2)).toEqual([{ skill: "FORC", targetLevel: 4 }]);
  });

  it("empties the queue when the cell is the first goal's first turn", () => {
    expect(goalsAfterClear(goals, row, 0)).toEqual([]);
  });

  it("leaves an idle cell's queue alone", () => {
    const short = rowOf(at({ FORC: [3, 270] }), [{ skill: "FORC", targetLevel: 4 }]);

    expect(goalsAfterClear([{ skill: "FORC", targetLevel: 4 }], short, 4)).toEqual([
      { skill: "FORC", targetLevel: 4 }
    ]);
  });
});
