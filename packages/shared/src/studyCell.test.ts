import { describe, expect, it } from "vitest";
import { readRuleset } from "@atlantis/fixtures";
import type { StudyGoal } from "@atlantis/core-client";
import { parseGameData, type GameDataIndex } from "./gameData";
import { buildMagicTree } from "./magicTree";
import { cellMenu, goalsAfterChoice, teachWarning } from "./studyCell";
import { blockedBecause, projectAll, type ScheduleRow, type SkillPoints } from "./studySchedule";
import { standingsFrom } from "./magicStanding";

const index = parseGameData(readRuleset()) as GameDataIndex;
const tree = buildMagicTree(index);

const TURNS = [24, 25, 26, 27, 28, 29];

function at(held: Record<string, [number, number]>): SkillPoints {
  return new Map(Object.entries(held).map(([tag, [level, points]]) => [tag, { level, points }]));
}

const STANDING = at({ FORC: [4, 300], PATT: [2, 100] });

function menu(turn = 26, standing: SkillPoints = STANDING) {
  return cellMenu({ mageName: "Ereb", turn, standing, tree });
}

describe("cellMenu", () => {
  it("heads the dropdown with the mage and the turn", () => {
    expect(menu().heading).toBe("Ereb — turn 26");
  });

  it("offers only skills blockedBecause allows", () => {
    const levels = new Map([...STANDING].map(([tag, held]) => [tag, held.level] as const));
    const { byTag } = standingsFrom(levels, tree);

    for (const choice of menu().choices) {
      const standing = byTag.get(choice.skill);
      expect(standing).toBeDefined();
      expect(blockedBecause(standing!, choice.name, tree, choice.skill)).toBeNull();
    }
  });

  it("does not offer a maxed, ceiling-capped or locked skill at all", () => {
    const offered = new Set(menu().choices.map((choice) => choice.skill));

    // Summoning is locked without necromancy; the mage holds neither.
    expect(offered.has("SUSK")).toBe(false);
    // A skill already at its maximum buys nothing and is not offered either.
    const maxed = menu(26, at({ FORC: [5, 450] }));
    expect(maxed.choices.some((choice) => choice.skill === "FORC")).toBe(false);
  });

  it("lists the choices in the tree's own order", () => {
    const order = [...tree.byTag.keys()];
    const positions = menu().choices.map((choice) => order.indexOf(choice.skill));

    expect(positions).toEqual([...positions].sort((left, right) => left - right));
  });

  it("says what a month buys, as `3 → 4`", () => {
    // pattern 2 is 90 points; he holds 100, and a 30-point month reaches 130 - still level 2.
    // force 4 is 300 points; 5 is 450, so his month leaves him at 4.
    const pattern = menu().choices.find((choice) => choice.skill === "PATT");
    expect(pattern?.detail).toBe("2 → 2");
    expect(pattern).toMatchObject({ from: 2, to: 2 });

    // force 3 at 270: a month reaches 300, which is level 4.
    const climbing = menu(26, at({ FORC: [3, 270] })).choices.find(
      (choice) => choice.skill === "FORC"
    );
    expect(climbing?.detail).toBe("3 → 4");
  });

  it("names the case when he can study nothing", () => {
    // Every skill at its maximum: nothing is offerable, and nothing is silently empty.
    const maxed = new Map(
      [...tree.byTag].map(([tag, node]) => [tag, { level: node.maxLevel, points: 9999 }] as const)
    );
    const nothing = cellMenu({ mageName: "Ereb", turn: 26, standing: maxed, tree });

    expect(nothing.choices).toEqual([]);
    expect(nothing.empty).toBe("Nothing he can study this turn.");
  });

  it("says nothing about emptiness when there is something to study", () => {
    expect(menu().empty).toBeNull();
  });
});

/** A row projected from `start` and `goals`, as the Schedule draws it. */
function rowOf(start: SkillPoints, goals: StudyGoal[]): ScheduleRow {
  const { cells, standings } = projectAll({
    mages: [
      { key: "21/2431", unitId: "2431", name: "Ereb", regionId: "1:7", structureId: "1", start, goals }
    ],
    tree,
    turns: TURNS,
    seats: new Map([["1:7/1", 1]])
  }).get("21/2431") as { cells: ScheduleRow["cells"]; standings: SkillPoints[] };
  return {
    key: "21/2431",
    factionId: "21",
    unitId: "2431",
    name: "Ereb",
    regionId: "1:7",
    summary: "",
    hasNote: false,
    goals,
    cells,
    standings,
    monthsUnreported: 0,
    sheetTurn: null
  };
}

describe("goalsAfterChoice", () => {
  const forc = (turn: number): StudyGoal => ({ kind: "study", turn, skill: "FORC" });

  it("sets the turn clicked and leaves every other turn alone", () => {
    expect(goalsAfterChoice([forc(24), forc(29)], 26, { kind: "study", skill: "PATT" })).toEqual([
      forc(24),
      { kind: "study", turn: 26, skill: "PATT" },
      forc(29)
    ]);
  });

  it("replaces the entry already on that turn", () => {
    expect(goalsAfterChoice([forc(26)], 26, { kind: "study", skill: "PATT" })).toEqual([
      { kind: "study", turn: 26, skill: "PATT" }
    ]);
  });

  it("clears that turn and only that turn on a null choice", () => {
    expect(goalsAfterChoice([forc(24), forc(26), forc(29)], 26, null)).toEqual([
      forc(24),
      forc(29)
    ]);
  });

  it("writes a teach entry on that turn", () => {
    expect(
      goalsAfterChoice([forc(24)], 26, { kind: "teach", students: ["2517", "2688"] })
    ).toEqual([forc(24), { kind: "teach", turn: 26, students: ["2517", "2688"] }]);
  });

  it("stays ascending by turn however the goals arrived", () => {
    const out = goalsAfterChoice([forc(29), forc(24)], 26, { kind: "study", skill: "PATT" });

    expect(out.map((goal) => goal.turn)).toEqual([24, 26, 29]);
  });

  it("gives an empty list when the only entry is cleared", () => {
    expect(goalsAfterChoice([forc(26)], 26, null)).toEqual([]);
  });
});

describe("the teach row of the dropdown", () => {
  /** Two mages in one hex, and one a hex away. */
  function rowsOf(): ScheduleRow[] {
    const plan = (skill: string): StudyGoal[] =>
      TURNS.map((turn) => ({ kind: "study" as const, turn, skill }));
    const base = rowOf(at({ FORC: [3, 270] }), plan("FORC"));
    const student = {
      ...rowOf(at({ FORC: [1, 30] }), plan("FORC")),
      key: "21/2517",
      unitId: "2517",
      name: "Sable"
    };
    const away = { ...student, key: "21/2688", unitId: "2688", name: "Kestrel", regionId: "2:8" };
    return [base, student, away];
  }

  function teachingMenu(rows: ScheduleRow[]) {
    return cellMenu({
      mageName: "Ereb",
      turn: 24,
      standing: rows[0].standings[0],
      tree,
      rows,
      turnIndex: 0,
      rowKey: "21/2431",
      label: (regionId) => (regionId === "2:8" ? "Dunmoor" : "Ereb's Hollow")
    });
  }

  it("lists every mage and says why one cannot be taught", () => {
    const listed = teachingMenu(rowsOf());

    expect(listed.teach.map((one) => one.unitId)).toEqual(["2517", "2688"]);
    expect(listed.teach[0]).toMatchObject({ label: "Sable (2517)", blocked: null });
    expect(listed.teach[1]).toMatchObject({
      label: "Kestrel (2688)",
      detail: "in Dunmoor, not here",
      blocked: "in Dunmoor, not here"
    });
  });

  it("counts the teachable students in the Teaches… row", () => {
    expect(teachingMenu(rowsOf()).teachDetail).toBe("1 he could teach");

    const rows = rowsOf();
    const second = { ...rows[1], key: "21/2900", unitId: "2900", name: "Vess" };
    expect(teachingMenu([...rows, second]).teachDetail).toBe("2 he could teach");
  });

  it("offers no Teaches… row when nobody is teachable", () => {
    const rows = rowsOf();
    // Everybody a hex away: nothing to teach, and no dead end offered.
    const away = rows.slice(1).map((row) => ({ ...row, regionId: "2:8" }));

    expect(teachingMenu([rows[0], ...away]).teachDetail).toBeNull();
  });

  it("offers no Teaches… row when the grid was not passed at all", () => {
    expect(menu().teach).toEqual([]);
    expect(menu().teachDetail).toBeNull();
  });

  it("warns when every ticked student is refused", () => {
    const listed = teachingMenu(rowsOf());

    expect(teachWarning([listed.teach[1]], 24, "Ereb")).toBe(
      "Ereb can teach nobody on turn 24. The plan will say so anyway."
    );
    expect(teachWarning(listed.teach, 24, "Ereb")).toBeNull();
  });
});
