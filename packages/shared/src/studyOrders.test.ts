import { describe, expect, it } from "vitest";
import type { PlannerGroup } from "./studyPlanner";
import type { PlannerNotice } from "./studyTeaching";
import type { ScheduleCell, ScheduleRow, SkillPoints } from "./studySchedule";
import { studyOrders } from "./studyOrders";

const ownGroup: PlannerGroup = {
  factionId: "95",
  factionLabel: "Borg TNG (95)",
  source: "own",
  heading: "Borg TNG (95) — your faction, turn 71",
  stale: false,
  mages: []
};

const standing = (levels: Record<string, number>): SkillPoints =>
  new Map(Object.entries(levels).map(([tag, level]) => [tag, { level, points: 0 }]));

const aRow = (over: Partial<ScheduleRow> & { cells: ScheduleCell[] }): ScheduleRow => ({
  key: `${over.factionId ?? "95"}/${over.unitId ?? "1234"}`,
  factionId: "95",
  unitId: "1234",
  name: "Ereb",
  regionId: "r1",
  summary: "",
  hasNote: false,
  goals: [],
  standings: [standing({})],
  monthsUnreported: 0,
  sheetTurn: null,
  ...over
});

const aStudyCell = (over: Partial<Extract<ScheduleCell, { kind: "study" }>> = {}): ScheduleCell => ({
  kind: "study",
  skill: "FORC",
  name: "force",
  level: 4,
  gained: true,
  blocked: null,
  worth: 1,
  unsheltered: false,
  shelterUnknown: false,
  taughtBy: null,
  ...over
});

const allyGroup: PlannerGroup = {
  factionId: "17",
  factionLabel: "Creeping Death (17)",
  source: "sheet",
  heading: "Creeping Death (17) — turn 70 · 2 turns old",
  stale: true,
  mages: []
};

const aTeachCell = ({
  taught,
  ...over
}: Partial<Omit<Extract<ScheduleCell, { kind: "teach" }>, "kind" | "outcome">> & {
  taught: string[];
}): ScheduleCell => ({
  kind: "teach",
  students: taught.map((key) => key.slice(key.indexOf("/") + 1)),
  label: "TEACH",
  ...over,
  outcome: { taught, refused: [], worth: 2 }
});

const aNotice = (over: Partial<PlannerNotice> = {}): PlannerNotice => ({
  code: "magic-study-outside-building",
  level: "warning",
  rowKey: "95/1234",
  turnIndex: 0,
  text: "Something is wrong.",
  where: "Ereb · turn 72",
  ...over
});

/** Two studying, one teaching, one idle, across the two factions. */
const mixedRows = (): ScheduleRow[] => [
  aRow({ cells: [aStudyCell()], goals: [{ kind: "study", turn: 24, skill: "FORC" }] }),
  aRow({ unitId: "881", key: "95/881", name: "Sable", cells: [aTeachCell({ taught: ["95/1234"] })] }),
  aRow({ unitId: "1263", key: "95/1263", name: "Vess", cells: [{ kind: "idle" }] }),
  aRow({
    factionId: "17",
    unitId: "300",
    key: "17/300",
    name: "Ghost",
    cells: [aStudyCell({ skill: "SPIR", name: "spirit", level: 4 })],
    goals: [{ kind: "study", turn: 24, skill: "SPIR" }],
    standings: [standing({ SPIR: 3 })]
  })
];

describe("studyOrders", () => {
  it("a_studying_mage_becomes_a_unit_block_with_an_annotated_study_line", () => {
    const rows = [
      aRow({
        cells: [aStudyCell()],
        goals: [{ kind: "study", turn: 24, skill: "FORC" }],
        standings: [standing({ FORC: 3 })]
      })
    ];
    const orders = studyOrders({ groups: [ownGroup], rows, turns: [72], notices: [] });

    expect(orders.sections).toHaveLength(1);
    expect(orders.sections[0].text.split("\n")).toEqual([
      "; Borg TNG (95) — study orders for turn 72, from Atlantis HUD",
      "UNIT 1234           ; Ereb",
      "  STUDY FORC        ; force 3 -> 4"
    ]);
  });

  it("the_study_order_is_the_bare_form", () => {
    const rows = [
      aRow({
        cells: [aStudyCell()],
        goals: [{ kind: "study", turn: 24, skill: "FORC" }],
        standings: [standing({ FORC: 3 })]
      })
    ];
    const [section] = studyOrders({ groups: [ownGroup], rows, turns: [72], notices: [] }).sections;
    expect(section.text.split("\n")[2]).toBe("  STUDY FORC        ; force 3 -> 4");
  });

  it("a_month_that_raises_nothing_states_the_level_without_an_arrow", () => {
    const rows = [
      aRow({
        cells: [aStudyCell({ level: 3, gained: false })],
        goals: [{ kind: "study", turn: 24, skill: "FORC" }],
        standings: [standing({ FORC: 3 })]
      })
    ];
    const [section] = studyOrders({ groups: [ownGroup], rows, turns: [72], notices: [] }).sections;
    expect(section.text.split("\n")[2]).toBe("  STUDY FORC        ; force 3");
  });

  it("a_taught_month_names_the_teacher_in_the_comment", () => {
    const rows = [
      aRow({
        cells: [aStudyCell({ taughtBy: "95/1263" })],
        goals: [{ kind: "study", turn: 24, skill: "FORC" }],
        standings: [standing({ FORC: 3 })]
      }),
      aRow({ unitId: "1263", name: "Vess", key: "95/1263", cells: [{ kind: "idle" }] })
    ];
    const [section] = studyOrders({ groups: [ownGroup], rows, turns: [72], notices: [] }).sections;
    expect(section.text.split("\n")[2]).toBe("  STUDY FORC        ; force 3 -> 4, taught by Vess");
  });

  it("a_teacher_writes_one_teach_line_of_the_unit_numbers_taught", () => {
    const rows = [
      aRow({
        unitId: "881",
        key: "95/881",
        name: "Sable",
        cells: [aTeachCell({ taught: ["95/1234", "95/1263"] })]
      }),
      aRow({ cells: [{ kind: "idle" }] }),
      aRow({ unitId: "1263", key: "95/1263", name: "Vess", cells: [{ kind: "idle" }] })
    ];
    const [section] = studyOrders({ groups: [ownGroup], rows, turns: [72], notices: [] }).sections;
    expect(section.text.split("\n")[2]).toBe("  TEACH 1234 1263   ; teaches Ereb and Vess");
  });

  it("a_taught_key_is_cut_to_its_unit_number_on_the_order_line", () => {
    const rows = [
      aRow({ unitId: "881", key: "95/881", name: "Sable", cells: [aTeachCell({ taught: ["95/1234"] })] })
    ];
    const [section] = studyOrders({ groups: [ownGroup], rows, turns: [72], notices: [] }).sections;
    expect(section.text).not.toContain("/");
  });

  it("a_blocked_study_is_commented_out_with_the_planners_own_reason", () => {
    const rows = [
      aRow({
        cells: [aStudyCell({ skill: "PATT", name: "pattern", blocked: "He cannot begin pattern until force reaches 1." })],
        goals: [{ kind: "study", turn: 24, skill: "PATT" }]
      })
    ];
    const [section] = studyOrders({ groups: [ownGroup], rows, turns: [72], notices: [] }).sections;
    expect(section.text.split("\n")[2]).toBe(
      "  ; STUDY PATT — He cannot begin pattern until force reaches 1."
    );
  });

  it("a_teach_nobody_can_receive_is_commented_out", () => {
    const rows = [
      aRow({ cells: [aTeachCell({ taught: [], students: ["4021"] })] })
    ];
    const [section] = studyOrders({ groups: [ownGroup], rows, turns: [72], notices: [] }).sections;
    expect(section.text.split("\n")[2]).toBe("  ; TEACH 4021 — nobody can be taught this turn");
  });

  it("a_mage_with_nothing_planned_is_named_in_a_comment_and_gets_no_unit_block", () => {
    const rows = [
      aRow({ cells: [aStudyCell()], goals: [{ kind: "study", turn: 24, skill: "FORC" }] }),
      aRow({ unitId: "1263", key: "95/1263", name: "Vess", cells: [{ kind: "idle" }] })
    ];
    const [section] = studyOrders({ groups: [ownGroup], rows, turns: [72], notices: [] }).sections;
    expect(section.text.split("\n")[3]).toBe("; Vess (1263) — nothing planned for this turn");
    expect(section.text).not.toContain("UNIT 1263");
  });

  it("a_warning_about_this_turn_is_written_under_its_mage", () => {
    const rows = [aRow({ cells: [aStudyCell()], goals: [{ kind: "study", turn: 24, skill: "FORC" }] })];
    const notices = [aNotice({ text: "He studies force above level 2 outside a building." })];
    const [section] = studyOrders({ groups: [ownGroup], rows, turns: [72], notices }).sections;
    expect(section.text.split("\n")[3]).toBe(
      "  ; He studies force above level 2 outside a building."
    );
  });

  it("a_suggestion_is_left_out_of_the_file", () => {
    const rows = [aRow({ cells: [aStudyCell()], goals: [{ kind: "study", turn: 24, skill: "FORC" }] })];
    const notices = [aNotice({ level: "suggestion", code: "teacher-has-free-slots", text: "He could also teach." })];
    const [section] = studyOrders({ groups: [ownGroup], rows, turns: [72], notices }).sections;
    expect(section.text).not.toContain("could also teach");
  });

  it("a_warning_about_a_later_turn_is_left_out", () => {
    const rows = [aRow({ cells: [aStudyCell()], goals: [{ kind: "study", turn: 24, skill: "FORC" }] })];
    const notices = [aNotice({ turnIndex: 2, text: "Later trouble." })];
    const [section] = studyOrders({ groups: [ownGroup], rows, turns: [72], notices }).sections;
    expect(section.text).not.toContain("Later trouble.");
  });

  it("an_allied_section_says_its_sheet_is_old_and_the_progress_estimated", () => {
    const rows = [
      aRow({
        factionId: "17",
        unitId: "300",
        key: "17/300",
        name: "Ghost",
        cells: [aStudyCell()],
        goals: [{ kind: "study", turn: 24, skill: "FORC" }],
        monthsUnreported: 2,
        sheetTurn: 70
      })
    ];
    const [section] = studyOrders({ groups: [allyGroup], rows, turns: [72], notices: [] }).sections;
    expect(section.text.split("\n")[1]).toBe(
      "; From their mage sheet of turn 70 — 2 months of study since are estimated."
    );
  });

  it("a_sheet_one_month_old_says_one_month_and_agrees_its_verb", () => {
    const rows = [
      aRow({
        factionId: "17",
        unitId: "300",
        key: "17/300",
        name: "Ghost",
        cells: [aStudyCell()],
        goals: [{ kind: "study", turn: 24, skill: "FORC" }],
        monthsUnreported: 1,
        sheetTurn: 71
      })
    ];
    const [section] = studyOrders({ groups: [allyGroup], rows, turns: [72], notices: [] }).sections;
    expect(section.text.split("\n")[1]).toBe(
      "; From their mage sheet of turn 71 — 1 month of study since is estimated."
    );
  });

  it("a_fresh_allied_section_carries_no_caveat", () => {
    const rows = [
      aRow({
        factionId: "17",
        unitId: "300",
        key: "17/300",
        name: "Ghost",
        cells: [aStudyCell()],
        goals: [{ kind: "study", turn: 24, skill: "FORC" }],
        sheetTurn: 72
      })
    ];
    const [section] = studyOrders({ groups: [allyGroup], rows, turns: [72], notices: [] }).sections;
    expect(section.text).not.toContain("mage sheet of turn");
  });

  it("sections_follow_planner_group_order", () => {
    const orders = studyOrders({ groups: [ownGroup, allyGroup], rows: mixedRows(), turns: [72], notices: [] });
    expect(orders.sections.map((section) => section.factionId)).toEqual(["95", "17"]);
    expect(orders.sections[1].heading).toBe(allyGroup.heading);
  });

  it("the_summary_counts_studying_teaching_and_unordered", () => {
    const orders = studyOrders({ groups: [ownGroup, allyGroup], rows: mixedRows(), turns: [72], notices: [] });
    expect(orders.summary).toBe(
      "Orders for turn 72 — 2 mages studying, 1 teaching, 1 with no order this turn"
    );
  });

  it("save_all_joins_the_sections_with_a_blank_line", () => {
    const orders = studyOrders({ groups: [ownGroup, allyGroup], rows: mixedRows(), turns: [72], notices: [] });
    expect(orders.allText).toBe(`${orders.sections[0].text}\n\n${orders.sections[1].text}`);
    expect(orders.allFileName).toBe("study-orders-turn-72.txt");
  });

  it("a_section_names_its_file_after_the_faction_and_the_turn", () => {
    const orders = studyOrders({ groups: [ownGroup], rows: mixedRows(), turns: [72], notices: [] });
    expect(orders.sections[0].fileName).toBe("study-orders-Borg-TNG-(95)-turn-72.txt");
  });

  it("a_faction_with_no_planned_month_still_gets_a_section", () => {
    const rows = [
      aRow({ cells: [aStudyCell()], goals: [{ kind: "study", turn: 24, skill: "FORC" }] }),
      aRow({ factionId: "17", unitId: "300", key: "17/300", name: "Ghost", cells: [{ kind: "idle" }] })
    ];
    const orders = studyOrders({ groups: [ownGroup, allyGroup], rows, turns: [72], notices: [] });
    expect(orders.sections).toHaveLength(2);
    expect(orders.sections[1].text).toContain("; Ghost (300) — nothing planned for this turn");
  });

  it("no_mage_with_a_cell_gives_no_sections_and_no_summary", () => {
    const rows = [aRow({ cells: [{ kind: "idle" }] })];
    const orders = studyOrders({ groups: [ownGroup], rows, turns: [72], notices: [] });
    expect(orders.sections).toEqual([]);
    expect(orders.summary).toBeNull();
    expect(orders.allText).toBe("");
    expect(orders.allFileName).toBe("study-orders.txt");
  });

  it("a_plan_whose_every_order_is_refused_still_gives_a_section", () => {
    const rows = [aRow({ cells: [aStudyCell({ blocked: "He cannot begin pattern yet." })] })];
    const orders = studyOrders({ groups: [ownGroup], rows, turns: [72], notices: [] });
    expect(orders.sections).toHaveLength(1);
    expect(orders.summary).toBe("Orders for turn 72 — 1 with no order this turn");
  });

  it("no_report_loaded_gives_no_sections", () => {
    const rows = [aRow({ cells: [aStudyCell()] })];
    expect(studyOrders({ groups: [ownGroup], rows, turns: [], notices: [] }).sections).toEqual([]);
  });
});

describe("studyOrders entries", () => {
  it("each_section_carries_one_entry_per_mage_with_its_bare_order_and_annotation", () => {
    const orders = studyOrders({
      groups: [ownGroup, allyGroup],
      rows: mixedRows(),
      turns: [72],
      notices: []
    });
    const own = orders.sections.find((section) => section.factionId === "95");
    expect(own?.entries.map((entry) => [entry.unitId, entry.order, entry.annotation])).toEqual([
      ["1234", "STUDY FORC", "force 0 -> 4"],
      ["881", "TEACH 1234", "teaches Ereb"],
      ["1263", null, null]
    ]);
    expect(own?.entries.map((entry) => entry.name)).toEqual(["Ereb", "Sable", "Vess"]);
    expect(own?.entries.map((entry) => entry.key)).toEqual(["95/1234", "95/881", "95/1263"]);
    expect(own?.entries.map((entry) => entry.regionId)).toEqual(["r1", "r1", "r1"]);
  });

  it("an_idle_mage_s_entry_carries_no_order_and_says_nothing_planned", () => {
    const rows = [
      aRow({ cells: [aStudyCell()] }),
      aRow({ unitId: "1263", key: "95/1263", name: "Vess", cells: [{ kind: "idle" }] })
    ];
    const [section] = studyOrders({ groups: [ownGroup], rows, turns: [72], notices: [] }).sections;
    expect(section.entries[1].order).toBeNull();
    expect(section.entries[1].skipReason).toBe("nothing planned");
  });

  it("a_blocked_study_s_entry_carries_the_planners_own_reason", () => {
    const rows = [aRow({ cells: [aStudyCell({ blocked: "he cannot study force yet" })] })];
    const [section] = studyOrders({ groups: [ownGroup], rows, turns: [72], notices: [] }).sections;
    expect(section.entries[0].order).toBeNull();
    expect(section.entries[0].skipReason).toBe("he cannot study force yet");
  });

  it("a_teach_nobody_can_receive_gives_an_entry_saying_so", () => {
    const rows = [aRow({ cells: [aTeachCell({ taught: [] })] })];
    const [section] = studyOrders({ groups: [ownGroup], rows, turns: [72], notices: [] }).sections;
    expect(section.entries[0].order).toBeNull();
    expect(section.entries[0].skipReason).toBe("nobody can be taught this turn");
  });

  it("the_own_factions_section_is_marked_source_own", () => {
    const orders = studyOrders({
      groups: [ownGroup, allyGroup],
      rows: mixedRows(),
      turns: [72],
      notices: []
    });
    expect(orders.sections.map((section) => [section.factionId, section.source])).toEqual([
      ["95", "own"],
      ["17", "sheet"]
    ]);
  });

  it("every_entrys_order_and_annotation_appear_in_the_section_text", () => {
    const orders = studyOrders({
      groups: [ownGroup, allyGroup],
      rows: mixedRows(),
      turns: [72],
      notices: [aNotice()]
    });
    for (const section of orders.sections) {
      for (const entry of section.entries) {
        if (entry.order !== null) {
          expect(section.text).toContain(entry.order);
        }
        if (entry.annotation !== null) {
          expect(section.text).toContain(entry.annotation);
        }
        if (entry.skipReason !== null) {
          expect(section.text).toContain(entry.skipReason);
        }
      }
    }
  });
});
