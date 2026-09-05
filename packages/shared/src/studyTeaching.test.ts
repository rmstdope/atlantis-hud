import { describe, expect, it } from "vitest";
import {
  TEACHING_SLOTS,
  noticeSummary,
  plannerNotices,
  taughtWorth,
  type PlannerNotice,
  type TeachRefusal
} from "./studyTeaching";
import type { ScheduleCell, ScheduleRow } from "./studySchedule";

describe("what a taught month is worth", () => {
  it("has ten slots per teacher", () => {
    // `rules/skills_teaching`: "Each person can only teach up to 10 students in a month".
    expect(TEACHING_SLOTS).toBe(10);
  });

  // `rules/skills_teaching`: "A unit with a teacher can learn up to twice as fast as normal".
  it("doubles the month for one student", () => {
    expect(taughtWorth(1)).toBe(2);
  });

  it("still doubles it at ten students, the last one on a slot", () => {
    expect(taughtWorth(2)).toBe(2);
    expect(taughtWorth(10)).toBe(2);
  });

  // "if 1 teacher teaches 20 men, each man being taught will gain 1 1/2 months of training".
  it("dilutes twenty students on ten slots to one and a half", () => {
    expect(taughtWorth(20)).toBe(1.5);
  });

  it("dilutes eleven students just below two", () => {
    expect(taughtWorth(11)).toBeCloseTo(1 + 10 / 11, 10);
  });

  it("is worth one when nobody is taught", () => {
    expect(taughtWorth(0)).toBe(1);
  });
});

describe("what the planner has to say about a plan", () => {
  const label = (regionId: string) => (regionId === "1:7" ? "Ereb's Hollow" : "Dunmoor");

  /** One row, with the cells a case needs and nothing else real about it. */
  function row(over: Partial<ScheduleRow> & { key: string; name: string }): ScheduleRow {
    return {
      factionId: "21",
      unitId: over.key.split("/")[1] ?? "1",
      regionId: "1:7",
      summary: "",
      hasNote: false,
      goals: [],
      cells: [],
      standings: [],
      monthsUnreported: 0,
      sheetTurn: null,
      ...over
    } as ScheduleRow;
  }

  const teachCell = (refused: TeachRefusal[], taught: string[] = []): ScheduleCell => ({
    kind: "teach",
    students: [],
    outcome: { taught, refused, worth: taughtWorth(taught.length) },
    label: "TEACH nobody"
  });

  const studyCell = (over: Partial<Extract<ScheduleCell, { kind: "study" }>> = {}): ScheduleCell => ({
    kind: "study",
    skill: "FORC",
    name: "force",
    level: 3,
    gained: false,
    blocked: null,
    worth: 1,
    unsheltered: false,
    shelterUnknown: false,
    taughtBy: null,
    ...over
  });

  function notice(rows: ScheduleRow[]) {
    return plannerNotices({ rows, turns: [24], label });
  }

  it("says a student is in another hex", () => {
    const notices = notice([
      row({
        key: "21/1",
        name: "Ereb",
        cells: [teachCell([{ kind: "elsewhere", unitId: "2688", regionId: "2:8" }])]
      }),
      row({ key: "21/2688", name: "Kestrel", cells: [studyCell()] })
    ]);

    expect(notices[0]).toMatchObject({
      code: "taught-not-here",
      level: "warning",
      rowKey: "21/1",
      turnIndex: 0,
      text: "Kestrel (2688) is in Dunmoor, not in Ereb's hex, so Ereb cannot teach him on turn 24.",
      where: "Ereb · turn 24"
    });
  });

  it("names a unit it can see no mage for", () => {
    const notices = notice([
      row({ key: "21/1", name: "Ereb", cells: [teachCell([{ kind: "unknown", unitId: "9999" }])] })
    ]);

    expect(notices[0].text).toBe(
      "Ereb names unit 9999 on turn 24, and the planner can see no such mage."
    );
  });

  it("says a student has nothing planned", () => {
    const notices = notice([
      row({ key: "21/1", name: "Ereb", cells: [teachCell([{ kind: "not-studying", unitId: "2688" }])] }),
      row({ key: "21/2688", name: "Kestrel", cells: [{ kind: "idle" }] })
    ]);

    expect(notices[0].code).toBe("taught-not-studying");
    expect(notices[0].text).toBe(
      "Kestrel (2688) has nothing planned for turn 24, so there is nothing for Ereb to teach him."
    );
  });

  it("says the teacher does not outrank the student", () => {
    const notices = notice([
      row({
        key: "21/1",
        name: "Ereb",
        cells: [
          teachCell([
            {
              kind: "outranked",
              unitId: "2688",
              skill: "FORC",
              skillName: "force",
              teacherLevel: 2,
              studentLevel: 2
            }
          ])
        ]
      }),
      row({ key: "21/2688", name: "Kestrel", cells: [studyCell()] })
    ]);

    expect(notices[0].code).toBe("teacher-cannot-teach");
    expect(notices[0].text).toBe(
      "Ereb is force 2 and Kestrel (2688) is force 2, so Ereb cannot teach him on turn 24."
    );
  });

  it("says the teacher does not hold the skill at all", () => {
    const notices = notice([
      row({
        key: "21/1",
        name: "Ereb",
        cells: [
          teachCell([
            {
              kind: "outranked",
              unitId: "2688",
              skill: "FORC",
              skillName: "force",
              teacherLevel: 0,
              studentLevel: 2
            }
          ])
        ]
      }),
      row({ key: "21/2688", name: "Kestrel", cells: [studyCell()] })
    ]);

    expect(notices[0].text).toBe(
      "Ereb is not skilled in force, so he cannot teach Kestrel (2688) on turn 24."
    );
  });

  it("says another teacher already has the student", () => {
    const notices = notice([
      row({
        key: "21/1",
        name: "Vess",
        cells: [teachCell([{ kind: "taken", unitId: "2688", byName: "Ereb" }])]
      }),
      row({ key: "21/2688", name: "Kestrel", cells: [studyCell()] })
    ]);

    expect(notices[0].text).toBe(
      "Ereb already teaches Kestrel (2688) on turn 24, and two teachers do not stack."
    );
  });

  it("says a teacher is oversubscribed", () => {
    const taught = Array.from({ length: 13 }, (_unused, index) => `21/${index + 100}`);
    const notices = notice([row({ key: "21/1", name: "Uln", cells: [teachCell([], taught)] })]);

    expect(notices[0].code).toBe("teaching-oversubscribed");
    expect(notices[0].text).toBe(
      // 1 + 10/13 = 1.769..., to one decimal. The plan's own example said 1.5 here, which is the
      // figure `rules/skills_teaching` gives for *twenty* students; the arithmetic is the rule's.
      "Uln teaches 13 students on 10 slots on turn 24, so each gains 1.8 months instead of two months."
    );
  });

  it("suggests the mages a teacher with room could also teach", () => {
    // Standings matter now: the suggestion offers only mages in his hex whom he actually
    // outranks in what they are studying (`rules/skills_teaching`).
    const stands = (level: number) => [new Map([["FORC", { level, points: level * 30 }]])];
    const notices = notice([
      row({ key: "21/1", name: "Ereb", cells: [teachCell([], ["21/2"])], standings: stands(3) }),
      row({
        key: "21/2",
        name: "Sable",
        cells: [studyCell({ level: 1, taughtBy: "21/1" })],
        standings: stands(1)
      }),
      row({ key: "21/3", name: "Vess", cells: [studyCell({ level: 1 })], standings: stands(1) })
    ]);

    const suggestion = notices.find((one) => one.code === "teacher-has-free-slots");
    expect(suggestion).toMatchObject({ level: "suggestion", rowKey: "21/1" });
    expect(suggestion?.text).toBe("Ereb teaches 1 of 10 on turn 24. He could also teach Vess.");
  });

  it("suggests nobody when the teacher outranks nobody, or has no slot left", () => {
    const stands = (level: number) => [new Map([["FORC", { level, points: level * 30 }]])];
    const outranked = notice([
      row({ key: "21/1", name: "Ereb", cells: [teachCell([], ["21/2"])], standings: stands(2) }),
      row({
        key: "21/2",
        name: "Sable",
        cells: [studyCell({ level: 1, taughtBy: "21/1" })],
        standings: stands(1)
      }),
      row({ key: "21/3", name: "Vess", cells: [studyCell({ level: 2 })], standings: stands(2) })
    ]);
    const full = notice([
      row({
        key: "21/1",
        name: "Uln",
        cells: [teachCell([], Array.from({ length: 10 }, (_u, index) => `21/${index + 100}`))],
        standings: stands(3)
      }),
      row({ key: "21/3", name: "Vess", cells: [studyCell({ level: 1 })], standings: stands(1) })
    ]);

    expect(outranked.find((one) => one.code === "teacher-has-free-slots")).toBeUndefined();
    expect(full.find((one) => one.code === "teacher-has-free-slots")).toBeUndefined();
  });

  it("says a mage studies in the open", () => {
    const notices = notice([
      row({
        key: "21/1",
        name: "Ereb",
        cells: [studyCell({ unsheltered: true, worth: 0.5 })]
      })
    ]);

    expect(notices[0].code).toBe("magic-study-outside-building");
    expect(notices[0].text).toBe(
      "Ereb studies force outside any building on turn 24. Above level 2 a month is worth half."
    );
  });

  it("says a building's seats are taken", () => {
    const notices = plannerNotices({
      rows: [row({ key: "21/1", name: "Ereb", cells: [studyCell({ unsheltered: true, worth: 0.5 })] })],
      turns: [24],
      label,
      shelters: new Map([["21/1", { name: "Fort", seats: 1 }]])
    });

    expect(notices[0].text).toBe(
      "Ereb studies force in the Fort on turn 24, but its one mage seat is taken. A month is worth half."
    );
  });

  it("says a building houses no mages", () => {
    const notices = plannerNotices({
      rows: [row({ key: "21/1", name: "Ereb", cells: [studyCell({ unsheltered: true, worth: 0.5 })] })],
      turns: [24],
      label,
      shelters: new Map([["21/1", { name: "Tower", seats: 0 }]])
    });

    expect(notices[0].text).toBe(
      "Ereb studies force in the Tower on turn 24, which houses no mages. A month is worth half."
    );
  });

  it("says nothing can be said about an unknown shelter", () => {
    const notices = plannerNotices({
      rows: [row({ key: "95/1", factionId: "95", name: "Ereb", cells: [studyCell({ shelterUnknown: true })] })],
      turns: [24],
      label,
      factionLabels: new Map([["95", "Borg"]])
    });

    expect(notices[0]).toMatchObject({ code: "shelter-unknown", level: "suggestion" });
    expect(notices[0].text).toBe(
      "Borg's hex is not in your report, so nothing can be said about Ereb's shelter."
    );
  });
});

describe("noticeSummary", () => {
  const one = (level: "warning" | "suggestion"): PlannerNotice => ({
    code: "shelter-unknown",
    level,
    rowKey: "21/1",
    turnIndex: 0,
    text: "",
    where: ""
  });

  it("says so when there is nothing to say", () => {
    expect(noticeSummary([])).toBe("Nothing to warn about in this plan.");
  });

  it("counts warnings alone", () => {
    expect(noticeSummary([one("warning")])).toBe("1 warning");
    expect(noticeSummary([one("warning"), one("warning")])).toBe("2 warnings");
  });

  it("counts suggestions alone", () => {
    expect(noticeSummary([one("suggestion")])).toBe("1 suggestion");
  });

  it("counts both", () => {
    expect(
      noticeSummary([one("warning"), one("warning"), one("warning"), one("suggestion")])
    ).toBe("3 warnings, 1 suggestion");
  });
});

describe("a teacher who names himself", () => {
  it("is told so, rather than told there is no such mage", () => {
    const rows: ScheduleRow[] = [
      {
        key: "21/1",
        factionId: "21",
        unitId: "881",
        regionId: "1:7",
        name: "Ereb",
        summary: "",
        hasNote: false,
        goals: [],
        cells: [
          {
            kind: "teach",
                    students: ["881"],
            outcome: { taught: [], refused: [{ kind: "self", unitId: "881" }], worth: 1 },
            label: "TEACH nobody"
          }
        ],
        standings: [],
        monthsUnreported: 0,
        sheetTurn: null
      }
    ];

    const notices = plannerNotices({ rows, turns: [24], label: (regionId) => regionId });

    expect(notices[0].text).toBe("Ereb names himself on turn 24, and a mage cannot teach himself.");
  });
});
