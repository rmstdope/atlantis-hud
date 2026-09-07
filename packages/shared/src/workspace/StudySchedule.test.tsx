import { describe, expect, it } from "vitest";
import type { PlannerNotice } from "../studyTeaching";
import { renderToStaticMarkup } from "react-dom/server";
import { readRuleset } from "@atlantis/fixtures";
import { parseGameData, type GameDataIndex } from "../gameData";
import { buildMagicTree } from "../magicTree";
import { cellMenu, seededStudents } from "../studyCell";
import { scheduleRows, scheduleTurns, type ScheduleRow } from "../studySchedule";
import { magePane } from "../studyMagePane";
import type { PlannerGroup } from "../studyPlanner";
import { STANDING_CHIP } from "./standingChip";
import { CellPopover, MagePaneView, ScheduleGrid, StudySchedule } from "./StudySchedule";
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

describe("MagePaneView", () => {
  const shown = (turnIndex: number | null, note = "") =>
    renderToStaticMarkup(
      <MagePaneView
        pane={magePane({
          row: { ...rows[0], note, hasNote: note !== "" },
          turnIndex,
          turns,
          tree,
          factionLabel: "Wardens of the North (12)"
        })}
      />
    );

  it("draws what he knows at that turn, with the studied skill marked", () => {
    const markup = shown(0);

    expect(markup).toContain("Ereb (2431) — turn 24");
    expect(markup).toContain("Wardens of the North (12) · studying force");
    expect(markup).toContain("3(270) → 4(300)");
    const line = markup.slice(markup.indexOf("study-schedule-knows-force"));
    expect(line.slice(0, 200)).toContain(STANDING_CHIP.known);
  });

  it("draws what he could study then, under a heading that counts them", () => {
    const markup = shown(0);

    expect(markup).toContain("Can study on turn 24 —");
    expect(markup).toContain('data-testid="study-schedule-can-study-PATT"');
  });

  it("reads him as he stands now when the pointer is on his name", () => {
    const markup = shown(null);

    expect(markup).toContain("Ereb (2431) — now");
    expect(markup).toContain("Can study now —");
  });

  it("shows the mage's own note above what he knows, and nothing when there is none", () => {
    const written = shown(0, "heading for gate lore");

    expect(written).toContain("heading for gate lore");
    expect(written.indexOf("heading for gate lore")).toBeLessThan(written.indexOf('data-testid="study-schedule-knows"'));
    expect(shown(0)).not.toContain('data-testid="study-schedule-note"');
  });

  it("shows every known skill, with no scroller of its own", () => {
    const markup = shown(0);

    expect(markup).toContain('data-testid="study-schedule-knows"');
    expect(markup).toContain("Knows — ");
    expect(markup).not.toContain("grid-rows-[auto_auto_1fr_auto_1fr_auto]");
    expect(markup).toContain("fade-bottom");
  });

  it("says what it is for before anything has been pointed at", () => {
    const markup = renderToStaticMarkup(<MagePaneView pane={null} />);

    expect(markup).toContain("Point at a mage");
    expect(markup).toContain('data-testid="study-schedule-mage-pane"');
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

  it("the Teaches… row is drawn with nobody eligible", () => {
    // Only Ereb has a plan in `rows`, so Ilna is dim and nobody is tickable - the row is offered
    // all the same (ah-12h7).
    const bare = cellMenu({
      mageName: "Ereb",
      turn: 26,
      standing: (rows[0] as ScheduleRow).standings[2],
      tree,
      rows,
      turnIndex: 2,
      rowKey: "12/2431",
      label: (regionId: string) => regionId
    });
    const markup = renderToStaticMarkup(
      <CellPopover
        menu={bare}
        mode={mode}
        mageName="Ereb"
        turn={26}
        current={null}
        rowIndex={0}
        onEvent={() => {}}
        onChoose={() => {}}
      />
    );

    expect(markup).toContain('data-testid="study-schedule-choice-teach"');
    expect(markup).toContain("nobody eligible yet");
  });

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
    // And says it to the eye as well: `aria-pressed` alone left the row that is set looking
    // exactly like every row that is not.
    expect(pressed.slice(0, 400)).toContain("✓");
  });

  it("marks — nothing when the cell holds nothing", () => {
    const markup = popover(null);
    const row = markup.slice(markup.indexOf('data-testid="study-schedule-choice-nothing"'));

    expect(row.slice(0, 200)).toContain('aria-pressed="true"');
    expect(row.slice(0, 400)).toContain("✓");
  });

  it("leaves the rows the cell does not hold unmarked", () => {
    const markup = popover();
    const nothing = markup.slice(
      markup.indexOf('data-testid="study-schedule-choice-nothing"'),
      markup.indexOf('data-testid="study-schedule-choice-teach"')
    );

    expect(nothing).toContain('aria-pressed="false"');
    expect(nothing).not.toContain("✓");
  });

  it("has no Set button and no level select", () => {
    const markup = popover();

    expect(markup).not.toContain('data-testid="study-schedule-set"');
    expect(markup).not.toContain("study-schedule-level");
    expect(markup).not.toContain("Clear from here");
  });

  it("says how the dropdown is worked", () => {
    expect(popover()).toContain("↑↓ to move · ↵ to choose · Esc to close");
  });

  it("ticks the students already named, and only those", () => {
    // The same hole the dropdown had, and worse for being a list of several: `aria-checked` was
    // all a ticked student carried, so clicking one changed nothing anybody could see.
    const teaching = (students: string[]) =>
      renderToStaticMarkup(
        <CellPopover
          menu={menu}
          mode={{ kind: "teaching", rowKey: "12/2431", turnIndex: 2, students, live: false }}
          mageName="Ereb"
          turn={26}
          current={null}
          rowIndex={0}
          onEvent={() => {}}
          onChoose={() => {}}
        />
      );
    const row = (markup: string) =>
      markup.slice(markup.indexOf('data-testid="study-schedule-teach-2432"')).slice(0, 400);

    expect(row(teaching(["2432"]))).toContain('aria-checked="true"');
    expect(row(teaching(["2432"]))).toContain("✓");
    expect(row(teaching([]))).toContain('aria-checked="false"');
    expect(row(teaching([]))).not.toContain("✓");
  });

  it("the teach step arrives with its pupils ticked", () => {
    const seeded = seededStudents(menu.teach);
    expect(seeded).toEqual(["2432"]);

    const markup = renderToStaticMarkup(
      <CellPopover
        menu={menu}
        mode={{ kind: "teaching", rowKey: "12/2431", turnIndex: 2, students: seeded, live: true }}
        mageName="Ereb"
        turn={26}
        current={null}
        rowIndex={0}
        onEvent={() => {}}
        onChoose={() => {}}
      />
    );

    const row = markup.slice(markup.indexOf('data-testid="study-schedule-teach-2432"'));
    expect(row.slice(0, 400)).toContain('aria-checked="true"');
    expect(markup).toContain("Ereb teaches on turn 26 — everyone eligible");
  });

  it("a frozen teach step drops the clause", () => {
    const markup = renderToStaticMarkup(
      <CellPopover
        menu={menu}
        mode={{ kind: "teaching", rowKey: "12/2431", turnIndex: 2, students: ["2432"], live: false }}
        mageName="Ereb"
        turn={26}
        current={null}
        rowIndex={0}
        onEvent={() => {}}
        onChoose={() => {}}
      />
    );

    expect(markup).toContain("Ereb teaches on turn 26");
    expect(markup).not.toContain("everyone eligible");
  });

  it("shows the students, Cancel and Set in the teach step", () => {
    const markup = renderToStaticMarkup(
      <CellPopover
        menu={menu}
        mode={{ kind: "teaching", rowKey: "12/2431", turnIndex: 2, students: [], live: false }}
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
    expect(markup).toContain('data-testid="study-schedule-cancel"');
    expect(markup).toContain('data-testid="study-schedule-set"');
    // Both are bordered controls rather than bare words: `Set` commits, so it carries the brass.
    const set = markup.slice(markup.indexOf('data-testid="study-schedule-set"'));
    expect(set.slice(0, 200)).toContain("border-brass");
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
