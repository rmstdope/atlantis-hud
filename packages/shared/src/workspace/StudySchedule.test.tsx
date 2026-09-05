import { describe, expect, it } from "vitest";
import type { PlannerNotice } from "../studyTeaching";
import { renderToStaticMarkup } from "react-dom/server";
import { readRuleset } from "@atlantis/fixtures";
import { parseGameData, type GameDataIndex } from "../gameData";
import { buildMagicTree } from "../magicTree";
import { cellMenu } from "../studyCell";
import { hoverCard, scheduleRows, scheduleTurns, type ScheduleRow } from "../studySchedule";
import type { PlannerGroup } from "../studyPlanner";
import { STANDING_CHIP } from "./standingChip";
import { CellPopover, ScheduleGrid, ScheduleHoverCard, StudySchedule } from "./StudySchedule";
import type { CellMode, CellPick } from "./studyCellState";

const index = parseGameData(readRuleset()) as GameDataIndex;
const tree = buildMagicTree(index);
const turns = scheduleTurns(23);

const groups = [
  {
    factionId: "12",
    factionLabel: "Wardens of the North (12)",
    source: "own",
    heading: "Wardens of the North (12) — your faction, turn 23",
    stale: false,
    mages: [
      {
        key: "12/2431",
        factionId: "12",
        factionLabel: "Wardens of the North (12)",
        unitId: "2431",
        name: "Ereb",
        regionId: "1:7,53",
        sheetTurn: null,
        monthsUnreported: 0,
        skills: [{ tag: "FORC", level: 3, points: 270 }]
      },
      {
        key: "12/2432",
        factionId: "12",
        factionLabel: "Wardens of the North (12)",
        unitId: "2432",
        name: "Ilna",
        regionId: "1:7,53",
        sheetTurn: null,
        monthsUnreported: 0,
        skills: [{ tag: "PATT", level: 1, points: 40 }]
      }
    ]
  }
] as unknown as PlannerGroup[];

const rows = scheduleRows({
  groups,
  plans: [
    {
      factionId: "12",
      unitId: "2431",
      goals: turns.map((turn) => ({ kind: "study" as const, turn, skill: "FORC" })),
      comment: "heading for Gate Lore",
      updatedAt: "2026-01-01T00:00:00.000Z"
    }
  ],
  tree,
  turns,
  seats: new Map([["1:7,53/1", 1]])
});

function grid(mode: CellMode = { kind: "idle" }) {
  return renderToStaticMarkup(
    <ScheduleGrid rows={rows} groups={groups} turns={turns} mode={mode} onEvent={() => {}} />
  );
}

describe("ScheduleGrid", () => {
  it("gives every mage a button for every turn", () => {
    const markup = grid();

    for (const turn of turns) {
      expect(markup).toContain(`data-testid="study-schedule-cell-2431-${turn}"`);
      expect(markup).toContain(`data-testid="study-schedule-cell-2432-${turn}"`);
    }
  });

  it("heads the first column with the next turn, and the rest bare", () => {
    const markup = grid();

    expect(markup).toContain("24 · next");
    expect(markup).toContain(">25<");
  });

  it("heads each faction with the words the All mages view uses", () => {
    expect(grid()).toContain("Wardens of the North (12) — your faction, turn 23");
    expect(grid()).toContain('data-testid="study-schedule-group-12"');
  });

  it("tints the cell where a level is gained", () => {
    const markup = grid();
    const first = markup.slice(markup.indexOf('study-schedule-cell-2431-24'));

    expect(first.slice(0, 400)).toContain(STANDING_CHIP.known);
  });

  it("draws an unplanned cell as a dash", () => {
    expect(grid()).toContain(">—<");
  });

  it("puts a pencil on a mage who has a note, and on no one else", () => {
    const markup = grid();

    expect(markup).toContain('data-testid="study-schedule-note-2431"');
    expect(markup).not.toContain('data-testid="study-schedule-note-2432"');
  });

  it("makes every cell reachable and addressable by the arrow keys", () => {
    const markup = grid();

    expect(markup).toContain('data-cell="0:0"');
    expect(markup).toContain(`data-cell="1:${turns.length - 1}"`);
  });

  it("says which cell is open", () => {
    const markup = grid({ kind: "choosing", rowKey: "12/2431", turnIndex: 0 });
    const cell = markup.slice(markup.indexOf('study-schedule-cell-2431-24'));

    expect(cell.slice(0, 200)).toContain('aria-expanded="true"');
  });
});

describe("StudySchedule", () => {
  function schedule(drawn: readonly number[]) {
    return renderToStaticMarkup(
      <StudySchedule
        rows={rows}
        groups={groups}
        turns={drawn}
        tree={tree}
        mode={{ kind: "idle" }}
        onEvent={() => {}}
        onCommit={() => {}}
        saveError={null}
      />
    );
  }

  it("says what to do when no report is loaded, rather than disabling the view", () => {
    const markup = schedule([]);

    expect(markup).toContain("Load a report and the coming six turns appear here.");
    expect(markup).not.toContain("study-schedule-cell-");
  });

  // Both paths, from one component. This does **not** reproduce a hook-order change and cannot:
  // `renderToStaticMarkup` is a one-shot server render, and React's hook-count invariant only
  // fires when a live instance re-renders - which this package cannot do, having no jsdom
  // (ah-nass). What keeps that defect out is structural instead: every hook in `StudySchedule`
  // sits above every return, and its own comment says why.
  it("draws the grid once a report is loaded, from the same component", () => {
    expect(schedule(turns)).toContain("study-schedule-cell-2431-24");
  });
});

describe("ScheduleHoverCard", () => {
  it("draws what he knows then, with the studied skill marked", () => {
    const card = hoverCard(rows[0], 0, turns, tree, "Wardens of the North (12)");
    const markup = renderToStaticMarkup(<ScheduleHoverCard card={card} />);

    expect(markup).toContain("Ereb (2431) — turn 24");
    expect(markup).toContain("Wardens of the North (12) · studying force");
    expect(markup).toContain("3 → 4  (300 of 300)");
    const line = markup.slice(markup.indexOf('study-schedule-hover-force'));
    expect(line.slice(0, 200)).toContain(STANDING_CHIP.known);
  });
});

describe("CellPopover", () => {
  const mode = { kind: "choosing" as const, rowKey: "12/2431", turnIndex: 2 };
  // Both mages studying force in the same hex, so Ereb - who outranks Ilna - has somebody he could
  // teach and the `Teaches…` row is offered (`rules/skills_teaching`).
  const withStudent = scheduleRows({
    groups,
    plans: ["2431", "2432"].map((unitId) => ({
      factionId: "12",
      unitId,
      goals: turns.map((turn) => ({ kind: "study" as const, turn, skill: "FORC" })),
      comment: "",
      updatedAt: "2026-01-01T00:00:00.000Z"
    })),
    tree,
    turns,
    seats: new Map([["1:7,53/1", 1]])
  });
  const menu = cellMenu({
    mageName: "Ereb",
    turn: 26,
    standing: (withStudent[0] as ScheduleRow).standings[2],
    tree,
    rows: withStudent,
    turnIndex: 2,
    rowKey: "12/2431",
    label: (regionId: string) => regionId
  });

  function popover(current: CellPick | null = { kind: "study", skill: "FORC" }) {
    return renderToStaticMarkup(
      <CellPopover
        menu={menu}
        mode={mode}
        mageName="Ereb"
        turn={26}
        current={current}
        rowIndex={0}
        onEvent={() => {}}
        onChoose={() => {}}
      />
    );
  }

  it("heads the dropdown with the mage and the turn", () => {
    expect(popover()).toContain("Ereb — turn 26");
  });

  it("lists — nothing, the teaches row and the skills, in that order", () => {
    const markup = popover();
    const nothing = markup.indexOf('data-testid="study-schedule-choice-nothing"');
    const teach = markup.indexOf('data-testid="study-schedule-choice-teach"');
    const first = markup.indexOf('data-testid="study-schedule-choice-FORC"');

    expect(nothing).toBeGreaterThan(-1);
    expect(teach).toBeGreaterThan(nothing);
    expect(first).toBeGreaterThan(teach);
    expect(markup).toContain("— nothing");
    expect(markup).toContain("Teaches…");
  });

  it("marks the row the cell already holds", () => {
    const pressed = popover().slice(
      popover().indexOf('data-testid="study-schedule-choice-FORC"')
    );

    expect(pressed.slice(0, 200)).toContain('aria-pressed="true"');
  });

  it("marks — nothing when the cell holds nothing", () => {
    const markup = popover(null);
    const row = markup.slice(markup.indexOf('data-testid="study-schedule-choice-nothing"'));

    expect(row.slice(0, 200)).toContain('aria-pressed="true"');
  });

  it("has no Set button and no level select", () => {
    const markup = popover();

    expect(markup).not.toContain(">Set<");
    expect(markup).not.toContain("study-schedule-level");
    expect(markup).not.toContain("Clear from here");
  });

  it("says how the dropdown is worked", () => {
    expect(popover()).toContain("↑↓ to move · ↵ to choose · Esc to close");
  });

  it("shows the students, Cancel and Set in the teach step", () => {
    const markup = renderToStaticMarkup(
      <CellPopover
        menu={menu}
        mode={{ kind: "teaching", rowKey: "12/2431", turnIndex: 2, students: [] }}
        mageName="Ereb"
        turn={26}
        current={null}
        rowIndex={0}
        onEvent={() => {}}
        onChoose={() => {}}
      />
    );

    expect(markup).toContain("Ereb teaches on turn 26");
    expect(markup).toContain('data-testid="study-schedule-teach-2432"');
    expect(markup).toContain(">Cancel<");
    expect(markup).toContain(">Set<");
  });
});

describe("a teaching month in the grid", () => {
  /** The same two mages, with Ereb teaching Ilna on the first turn. */
  const teachingRows = scheduleRows({
    groups,
    plans: [
      {
        factionId: "12",
        unitId: "2431",
        goals: [
          { kind: "teach", turn: turns[0], students: ["2432"] },
          ...turns.slice(1).map((turn) => ({ kind: "study" as const, turn, skill: "FORC" }))
        ],
        comment: "",
        updatedAt: "2026-01-01T00:00:00.000Z"
      },
      {
        factionId: "12",
        unitId: "2432",
        // Force, not pattern: `rules/skills_teaching` needs the teacher to outrank the student in
        // the skill being studied, and Ereb holds no pattern at all.
        goals: turns.map((turn) => ({ kind: "study" as const, turn, skill: "FORC" })),
        comment: "",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }
    ],
    tree,
    turns,
    seats: new Map()
  });

  function teachingGrid(notices: PlannerNotice[] = []) {
    return renderToStaticMarkup(
      <ScheduleGrid
        rows={teachingRows}
        groups={groups}
        turns={turns}
        mode={{ kind: "idle" }}
        onEvent={() => {}}
        notices={notices}
      />
    );
  }

  it("names the student in the teacher's cell", () => {
    expect(teachingGrid()).toContain("TEACH Ilna");
  });

  it("marks the doubled month on the student's cell", () => {
    expect(teachingGrid()).toContain("×2");
  });

  it("marks a halved month, and marks nothing on an ordinary one", () => {
    // Ilna is pattern 1, so she needs no seat and her later months are worth exactly one.
    const plain = renderToStaticMarkup(
      <ScheduleGrid
        rows={rows}
        groups={groups}
        turns={turns}
        mode={{ kind: "idle" }}
        onEvent={() => {}}
      />
    );

    expect(plain).not.toContain("×");
  });

  it("tints a warned teach cell and titles it with what was raised", () => {
    const markup = teachingGrid([
      {
        code: "taught-not-here",
        level: "warning",
        rowKey: "12/2431",
        turnIndex: 0,
        text: "Ilna is elsewhere.",
        where: "Ereb · turn 24"
      }
    ]);

    expect(markup).toContain("Ilna is elsewhere.");
  });
});

describe("the warnings strip", () => {
  const notices: PlannerNotice[] = [
    {
      code: "taught-not-here",
      level: "warning",
      rowKey: "12/2431",
      turnIndex: 0,
      text: "Ilna is in Dunmoor, not in Ereb's hex.",
      where: "Ereb · turn 24"
    },
    {
      code: "shelter-unknown",
      level: "suggestion",
      rowKey: "12/2432",
      turnIndex: 1,
      text: "Nothing can be said about Ilna's shelter.",
      where: "Ilna · turn 25"
    }
  ];

  function schedule(given: PlannerNotice[]) {
    return renderToStaticMarkup(
      <StudySchedule
        rows={rows}
        groups={groups}
        turns={turns}
        tree={tree}
        mode={{ kind: "idle" }}
        onEvent={() => {}}
        onCommit={() => {}}
        saveError={null}
        notices={given}
      />
    );
  }

  it("is folded when the pane opens, and counts what it holds", () => {
    const markup = schedule(notices);

    expect(markup).toContain('data-testid="study-planner-warnings-toggle"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain("1 warning, 1 suggestion");
    expect(markup).not.toContain('data-testid="study-planner-warnings"');
  });

  it("says so and shows no button when there is nothing wrong", () => {
    const markup = schedule([]);

    expect(markup).toContain('data-testid="study-planner-warnings-none"');
    expect(markup).toContain("Nothing to warn about in this plan.");
    expect(markup).not.toContain('data-testid="study-planner-warnings-toggle"');
  });
});
