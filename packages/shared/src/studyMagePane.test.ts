import { describe, expect, it } from "vitest";
import { readRuleset } from "@atlantis/fixtures";
import { parseGameData, type GameDataIndex } from "./gameData";
import { buildMagicTree } from "./magicTree";
import { magePane } from "./studyMagePane";
import { NO_TEACHING_RULE, type TeachingRule } from "./teachingPermission";
import { scheduleRows, scheduleTurns, type ScheduleRow } from "./studySchedule";

const index = parseGameData(readRuleset()) as GameDataIndex;
const tree = buildMagicTree(index);
const turns = scheduleTurns(23);

function groups(skills = [{ tag: "FORC", level: 3, points: 270 }]) {
  return [
    {
      factionId: "21",
      factionLabel: "Wardens of the North (12)",
      source: "sheet" as const,
      heading: "Wardens of the North (12) — turn 20",
      stale: false,
      mages: [
        {
          key: "21/2431",
          factionId: "21",
          factionLabel: "Wardens of the North (12)",
          unitId: "2431",
          name: "Ereb",
          regionId: "1:7,53",
          sheetTurn: null,
          monthsUnreported: 0,
          skills
        }
      ]
    }
  ] as unknown as Parameters<typeof scheduleRows>[0]["groups"];
}

/** Ereb, studying force on every one of the six turns. */
function row(skills?: { tag: string; level: number; points: number }[]): ScheduleRow {
  return scheduleRows({
    groups: groups(skills),
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
    seats: new Map([["1:7,53/1", 1]]),
    after: new Map(),
    rule: NO_TEACHING_RULE
  })[0];
}

function pane(
  turnIndex: number | null,
  skills?: { tag: string; level: number; points: number }[],
  comment = ""
) {
  return magePane({
    row: { ...row(skills), note: comment, hasNote: comment !== "" },
    turnIndex,
    turns,
    tree,
    factionLabel: "Wardens of the North (12)",
    rule: NO_TEACHING_RULE
  });
}

describe("magePane on a turn", () => {
  it("names the mage, the turn he is being read at, and what he studies then", () => {
    const shown = pane(2);

    expect(shown.heading).toBe("Ereb (2431) — turn 26");
    expect(shown.sub).toBe("Wardens of the North (12) · studying force");
    expect(shown.knows.find((line) => line.name === "force")?.studying).toBe(true);
  });

  it("says where each skill stands at both ends of that turn", () => {
    expect(pane(1).knows.find((line) => line.name === "force")?.right).toBe("4(300) → 4(330)");
  });

  it("lists what he could study then, and counts them", () => {
    const shown = pane(2);

    expect(shown.canStudyHeading).toBe(`Can study on turn 26 — ${shown.canStudy.length}`);
    expect(shown.canStudy.length).toBeGreaterThan(0);
    // Worded exactly as the dropdown words the same month, so nothing has to be translated
    // between the pane and the menu it is read beside.
    expect(shown.canStudy.find((choice) => choice.skill === "FORC")?.detail).toBe("4(330) → 4(360)");
    expect(shown.canStudy.find((choice) => choice.skill === "PATT")?.detail).toBe("0(0) → 1(30)");
  });

  it("offers nothing it would be pointless to offer", () => {
    // Every magic skill at its maximum: there is nothing left to study, and the pane says so
    // rather than showing an empty list under a count of zero.
    const maxed = [...tree.byTag].map(([tag, node]) => ({
      tag,
      level: node.maxLevel,
      points: 9999
    }));
    const shown = pane(2, maxed);

    expect(shown.canStudy).toEqual([]);
    expect(shown.canStudyHeading).toBe("Nothing he can study on turn 26.");
  });

  it("says where its figures come from", () => {
    expect(pane(2).foot).toBe("Projected from turn 23's report at 30 points a studied month.");
  });
});

describe("the mage's own note", () => {
  it("is carried whichever way the pane is being read", () => {
    // Written in All mages and read here: the pane is where a mage is looked at while his months
    // are being planned, so what the player wrote about him belongs in it (navigator, 2026-09-07).
    expect(pane(2, undefined, "heading for gate lore").note).toBe("heading for gate lore");
    expect(pane(null, undefined, "heading for gate lore").note).toBe("heading for gate lore");
  });

  it("is empty for a mage nobody has written about", () => {
    expect(pane(2).note).toBe("");
  });
});

describe("magePane on the mage himself", () => {
  it("reads him as he stands now, with no month applied", () => {
    const shown = pane(null);

    expect(shown.heading).toBe("Ereb (2431) — now");
    expect(shown.sub).toBe("Wardens of the North (12)");
    // No arrow: nothing has happened yet, so there is no before and after to put one between.
    expect(shown.knows.find((line) => line.name === "force")?.right).toBe("3(270)");
    expect(shown.knows.every((line) => !line.studying)).toBe(true);
  });

  it("lists what he could study today", () => {
    const shown = pane(null);

    expect(shown.canStudyHeading).toBe(`Can study now — ${shown.canStudy.length}`);
    expect(shown.canStudy.find((choice) => choice.skill === "FORC")?.detail).toBe("3(270) → 4(300)");
  });

  it("counts what he knows in the heading", () => {
    expect(pane(null).knowsHeading).toBe("Knows — 1");
    // COMB is not in the magic tree, so a mage holding only it knows nothing the pane can name.
    expect(pane(null, [{ tag: "COMB", level: 3, points: 180 }]).knowsHeading).toBe(
      "Nothing he knows yet."
    );
  });

  it("names the report the figures are his from", () => {
    expect(pane(null).foot).toBe("From turn 23's report.");
  });
});

describe("a month somebody would double", () => {
  /** Ereb, and a senior mage in his hex teaching live on every turn. */
  function rowsWithTeacher(): ScheduleRow[] {
    const student = row();
    const teacher: ScheduleRow = {
      ...student,
      key: "21/881",
      unitId: "881",
      name: "Wardweaver",
      cells: student.cells.map(() => ({
        kind: "teach" as const,
        students: [],
        live: true,
        outcome: { taught: ["21/2431"], refused: [], worth: 2 },
        label: "TEACH"
      })),
      standings: student.standings.map(
        () => new Map([["FORC", { level: 5, points: 450 }]]) as ScheduleRow["standings"][number]
      )
    };
    return [teacher, student];
  }

  function paneWithRows(turnIndex: number | null) {
    const rows = rowsWithTeacher();
    return magePane({
      row: rows[1],
      turnIndex,
      turns,
      tree,
      factionLabel: "Wardens of the North (12)",
      rows,
      rule: NO_TEACHING_RULE
    });
  }

  it("shows the Can study list a month somebody would double", () => {
    const forc = paneWithRows(0).canStudy.find((one) => one.skill === "FORC");

    expect(forc?.taughtBy).toBe("Wardweaver");
    expect(forc?.detail).toContain("· taught by Wardweaver");
  });

  it("leaves the mage's own column plain, there being no turn to teach in", () => {
    const forc = paneWithRows(null).canStudy.find((one) => one.skill === "FORC");

    expect(forc?.taughtBy).toBeNull();
    expect(forc?.detail).not.toContain("taught by");
  });
});

describe("a month a declaration rule would not double", () => {
  /** Ereb of our faction 21, and a teacher of faction 12 in his hex. */
  function rowsWithForeignTeacher(): ScheduleRow[] {
    const student = row();
    const teacher: ScheduleRow = {
      ...student,
      key: "12/881",
      factionId: "12",
      unitId: "881",
      name: "Wardweaver",
      cells: student.cells.map(() => ({
        kind: "teach" as const,
        students: [],
        live: true,
        outcome: { taught: [], refused: [], worth: 2 },
        label: "TEACH"
      })),
      standings: student.standings.map(
        () => new Map([["FORC", { level: 5, points: 450 }]]) as ScheduleRow["standings"][number]
      )
    };
    return [teacher, student];
  }

  const forc = (rule: TeachingRule) => {
    const rows = rowsWithForeignTeacher();
    return magePane({
      row: rows[1],
      turnIndex: 0,
      turns,
      tree,
      factionLabel: "Wardens of the North (12)",
      rows,
      rule
    }).canStudy.find((one) => one.skill === "FORC");
  };

  const rule = (toward: Record<string, string>): TeachingRule => ({
    declarer: "student",
    declarations: { factionId: "21", toward: new Map(Object.entries(toward)), fallback: null }
  });

  it("leaves the Can study row plain when the declaration does not allow the doubling", () => {
    expect(forc(rule({ "12": "friendly" }))?.taughtBy).toBe("Wardweaver");
    expect(forc(rule({ "12": "neutral" }))?.taughtBy).toBeNull();
    expect(forc(rule({}))?.taughtBy).toBeNull();
  });
});
