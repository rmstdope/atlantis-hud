import { describe, expect, it } from "vitest";
import { readRuleset } from "@atlantis/fixtures";
import type { StudyGoal } from "@atlantis/core-client";
import { parseGameData, type GameDataIndex } from "./gameData";
import { buildMagicTree } from "./magicTree";
import { cellMenu, goalsAfterChoice, seededStudents, teachClick, teachWarning } from "./studyCell";
import type { TeachChoice } from "./studyCell";
import { blockedBecause, projectAll, type ScheduleRow, type SkillPoints } from "./studySchedule";
import { standingsFrom } from "./magicStanding";
import { NO_TEACHING_RULE, type TeachingRule } from "./teachingPermission";

const index = parseGameData(readRuleset()) as GameDataIndex;
const tree = buildMagicTree(index);

const TURNS = [24, 25, 26, 27, 28, 29];

function at(held: Record<string, [number, number]>): SkillPoints {
  return new Map(Object.entries(held).map(([tag, [level, points]]) => [tag, { level, points }]));
}

const STANDING = at({ FORC: [4, 300], PATT: [2, 100] });

function menu(turn = 26, standing: SkillPoints = STANDING) {
  return cellMenu({ mageName: "Ereb", turn, standing, tree, rule: NO_TEACHING_RULE });
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

  it("says what a month buys, as `3(270) → 4(300)`", () => {
    // pattern 2 is 90 points; he holds 100, and a 30-point month reaches 130 - still level 2. Both
    // ends carry their points, in the shape a report prints a skill in with the space closed up.
    const pattern = menu().choices.find((choice) => choice.skill === "PATT");
    expect(pattern?.detail).toBe("2(100) → 2(130)");
    expect(pattern).toMatchObject({ from: 2, to: 2 });

    // force 3 at 270: a month reaches 300, which is level 4.
    const climbing = menu(26, at({ FORC: [3, 270] })).choices.find(
      (choice) => choice.skill === "FORC"
    );
    expect(climbing?.detail).toBe("3(270) → 4(300)");
  });

  it("never carries a level past the skill's own maximum", () => {
    // force 4 at 420: a month reaches 450, which is level 5 and the skill's maximum.
    const topping = menu(26, at({ FORC: [4, 420] })).choices.find(
      (choice) => choice.skill === "FORC"
    );
    expect(topping?.detail).toBe("4(420) → 5(450)");
  });

  it("rounds the points it prints, having been given a taught or halved month's fraction", () => {
    // A halved month leaves 22.5 points on a projection, and a dropdown reading `(122.5)` is the
    // arithmetic leaking through the glass - every other view rounds for the same reason.
    const odd = menu(26, at({ PATT: [2, 92.5] })).choices.find(
      (choice) => choice.skill === "PATT"
    );
    expect(odd?.detail).toBe("2(93) → 2(123)");
  });

  it("names the case when he can study nothing", () => {
    // Every skill at its maximum: nothing is offerable, and nothing is silently empty.
    const maxed = new Map(
      [...tree.byTag].map(([tag, node]) => [tag, { level: node.maxLevel, points: 9999 }] as const)
    );
    const nothing = cellMenu({ mageName: "Ereb", turn: 26, standing: maxed, tree, rule: NO_TEACHING_RULE });

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
      {
        key: "21/2431",
        factionId: "21",
        unitId: "2431",
        name: "Ereb",
        regionId: "1:7",
        studyRegionId: "1:7",
        structureId: "1",
        offMap: false,
        leftBuilding: null,
        leftBy: null,
        start,
        goals
      }
    ],
    tree,
    turns: TURNS,
    seats: new Map([["1:7/1", 1]]),
    rule: NO_TEACHING_RULE
  }).get("21/2431") as { cells: ScheduleRow["cells"]; standings: SkillPoints[] };
  return {
    key: "21/2431",
    factionId: "21",
    unitId: "2431",
    name: "Ereb",
    regionId: "1:7",
    summary: "",
    note: "",
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
      goalsAfterChoice([forc(24)], 26, { kind: "teach", students: ["2517", "2688"], live: false })
    ).toEqual([
      forc(24),
      { kind: "teach", turn: 26, students: ["2517", "2688"], live: false }
    ]);
  });

  it("stores no list for a live pick", () => {
    expect(
      goalsAfterChoice([], 26, { kind: "teach", students: ["a", "b"], live: true })
    ).toEqual([{ kind: "teach", turn: 26, students: [], live: true }]);
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
      rule: NO_TEACHING_RULE,
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

  it("offers the Teaches… row with nobody eligible yet", () => {
    const rows = rowsOf();
    // Everybody a hex away: nobody teachable, and the row is offered all the same.
    const away = rows.slice(1).map((row) => ({ ...row, regionId: "2:8" }));

    expect(teachingMenu([rows[0], ...away]).teachDetail).toBe("nobody eligible yet");
  });

  it("offers the Teaches… row even with no grid", () => {
    expect(menu().teach).toEqual([]);
    expect(menu().teachDetail).toBe("nobody eligible yet");
  });

  it("warns when every ticked student is refused", () => {
    const listed = teachingMenu(rowsOf());

    expect(teachWarning([listed.teach[1]], 24, "Ereb")).toBe(
      "Ereb can teach nobody on turn 24. The plan will say so anyway."
    );
    expect(teachWarning(listed.teach, 24, "Ereb")).toBeNull();
  });
});

describe("a month somebody would double", () => {
  /** Ereb (force 3), teaching live on turn 24, and Sable (force 1) in his hex. */
  function taughtRows(): ScheduleRow[] {
    const plan = (skill: string): StudyGoal[] =>
      TURNS.map((turn) => ({ kind: "study" as const, turn, skill }));
    const base = rowOf(at({ FORC: [3, 270] }), plan("FORC"));
    const teacher: ScheduleRow = {
      ...base,
      cells: base.cells.map((cell, at) =>
        at === 0
          ? {
              kind: "teach" as const,
              students: [],
              live: true,
              outcome: { taught: ["21/2517"], refused: [], worth: 2 },
              label: "TEACH"
            }
          : cell
      )
    };
    const student = {
      ...rowOf(at({ FORC: [1, 30] }), plan("FORC")),
      key: "21/2517",
      unitId: "2517",
      name: "Sable"
    };
    return [teacher, student];
  }

  function studentMenu(rows: ScheduleRow[]) {
    return cellMenu({
      mageName: "Sable",
      turn: 24,
      standing: rows[1].standings[0],
      tree,
      rows,
      turnIndex: 0,
      rowKey: "21/2517",
      rule: NO_TEACHING_RULE
    });
  }

  it("shows the doubled month for a skill somebody is teaching", () => {
    const forc = studentMenu(taughtRows()).choices.find((one) => one.skill === "FORC");

    expect(forc?.taughtBy).toBe("Ereb");
    expect(forc?.detail).toBe("1(30) → 2(90) · taught by Ereb");
  });

  it("leaves a skill nobody teaches plain", () => {
    const patt = studentMenu(taughtRows()).choices.find((one) => one.skill === "PATT");

    expect(patt?.taughtBy).toBeNull();
    expect(patt?.detail).not.toContain("taught by");
  });

  it("leaves every row plain when there is no grid to read", () => {
    expect(menu().choices.every((one) => one.taughtBy === null)).toBe(true);
  });
});

describe("seededStudents", () => {
  function choice(unitId: string, blocked: string | null): TeachChoice {
    return { unitId, label: `M (${unitId})`, detail: "force 1 → force 2", blocked };
  }

  it("takes every teachable pupil in row order", () => {
    const teach = [
      choice("a", null),
      choice("b", "elsewhere"),
      choice("c", null),
      choice("d", "already taught"),
      choice("e", null)
    ];

    expect(seededStudents(teach)).toEqual(["a", "c", "e"]);
  });

  it("stops at ten", () => {
    const teach: TeachChoice[] = [];
    for (let n = 0; n < 12; n += 1) {
      teach.push(choice(`u${n}`, null));
      if (n % 4 === 0) {
        teach.push(choice(`x${n}`, "elsewhere"));
      }
    }

    expect(seededStudents(teach)).toEqual([
      "u0",
      "u1",
      "u2",
      "u3",
      "u4",
      "u5",
      "u6",
      "u7",
      "u8",
      "u9"
    ]);
  });
});

describe("teachClick", () => {
  const choice = (unitId: string, blocked: string | null): TeachChoice => ({
    unitId,
    label: `Unit (${unitId})`,
    detail: blocked ?? "force 1 → force 2",
    blocked
  });

  it("teachClick commits when no pupil is tickable", () => {
    const all = [choice("1", "nothing planned"), choice("2", "in Dunmoor, not here"), choice("3", "nothing planned")];

    expect(teachClick(all, null)).toEqual({ kind: "commit" });
    expect(teachClick([], null)).toEqual({ kind: "commit" });
  });

  it("teachClick opens with the seed when somebody is eligible", () => {
    const some = [choice("1", "nothing planned"), choice("2517", null), choice("3", "nothing planned")];

    expect(teachClick(some, null)).toEqual({ kind: "open", students: ["2517"], live: true });
  });

  it("teachClick opens a frozen list even with nobody eligible", () => {
    const none = [choice("1", "nothing planned"), choice("2", "nothing planned")];

    expect(teachClick(none, { kind: "teach", students: ["2517", "2688"], live: false })).toEqual({
      kind: "open",
      students: ["2517", "2688"],
      live: false
    });
  });
});

describe("the doubled month a declaration rule withholds", () => {
  /** Our own Sable at force 3, and Uln of another faction teaching in her hex at force 5. */
  const standing = (level: number) => at({ FORC: [level, 0] });

  const rows: ScheduleRow[] = [
    {
      key: "21/881",
      factionId: "21",
      unitId: "881",
      name: "Uln",
      regionId: "1:7",
      summary: "",
      note: "",
      hasNote: false,
      goals: [],
      cells: [
        {
          kind: "teach",
          students: [],
          live: true,
          outcome: { taught: [], refused: [], worth: 2 },
          label: "TEACH"
        }
      ],
      standings: [standing(5), standing(5)],
      monthsUnreported: 0,
      sheetTurn: null
    },
    {
      key: "12/2517",
      factionId: "12",
      unitId: "2517",
      name: "Sable",
      regionId: "1:7",
      summary: "",
      note: "",
      hasNote: false,
      goals: [],
      cells: [],
      standings: [standing(3), standing(3)],
      monthsUnreported: 0,
      sheetTurn: null
    }
  ];

  const force = (rule: TeachingRule) =>
    cellMenu({
      mageName: "Sable",
      turn: 24,
      standing: standing(3),
      tree,
      rows,
      turnIndex: 0,
      rowKey: "12/2517",
      rule
    }).choices.find((choice) => choice.skill === "FORC");

  const rule = (toward: Record<string, string>): TeachingRule => ({
    declarer: "student",
    declarations: { factionId: "12", toward: new Map(Object.entries(toward)), fallback: null }
  });

  it("drops the doubled month from the study choices when the declaration does not allow it", () => {
    expect(force(rule({ "21": "friendly" }))?.taughtBy).toBe("Uln");
    expect(force(rule({ "21": "neutral" }))?.taughtBy).toBeNull();
    expect(force(rule({}))?.taughtBy).toBeNull();
    expect(force(NO_TEACHING_RULE)?.taughtBy).toBe("Uln");
  });
});
