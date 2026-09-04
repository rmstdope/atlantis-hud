import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readRuleset } from "@atlantis/fixtures";
import { parseGameData, type GameDataIndex } from "../gameData";
import { buildMagicTree } from "../magicTree";
import { cellMenu } from "../studyCell";
import { hoverCard, scheduleRows, scheduleTurns, type ScheduleRow } from "../studySchedule";
import type { PlannerGroup } from "../studyPlanner";
import { STANDING_CHIP } from "./standingChip";
import { CellPopover, ScheduleGrid, ScheduleHoverCard, StudySchedule } from "./StudySchedule";
import type { CellMode } from "./studyCellState";

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
      goals: [{ skill: "FORC", targetLevel: 5 }],
      comment: "heading for Gate Lore",
      updatedAt: "2026-01-01T00:00:00.000Z"
    }
  ],
  tree,
  turns
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

  it("draws an empty cell as a plus", () => {
    expect(grid()).toContain(">+<");
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
    const markup = grid({
      kind: "editing",
      rowKey: "12/2431",
      turnIndex: 0,
      skill: "FORC",
      targetLevel: 5
    });
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

  // The hook that holds the pointed-at cell sits above that guard. Below it, loading a report
  // while the planner is open would change this component's hook count and React would throw.
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
  const mode = {
    kind: "editing" as const,
    rowKey: "12/2431",
    turnIndex: 3,
    skill: "FORC",
    targetLevel: 5
  };
  const menu = cellMenu({
    mageName: "Ereb",
    turn: 27,
    standing: (rows[0] as ScheduleRow).standings[3],
    tree
  });

  function popover() {
    return renderToStaticMarkup(
      <CellPopover
        menu={menu}
        mode={mode}
        mageName="Ereb"
        turn={27}
        replacing="was: force 4, force 5"
        onEvent={() => {}}
        onSet={() => {}}
        onClear={() => {}}
      />
    );
  }

  it("heads the menu with the turn and the mage, and says where he will stand", () => {
    expect(popover()).toContain("From turn 27, Ereb studies");
    expect(popover()).toContain("He will be force 4 by then.");
  });

  it("draws all three groups", () => {
    const markup = popover();

    expect(markup).toContain(">Raise<");
    expect(markup).toContain(">Begin<");
    expect(markup).toContain(">Not by turn 27<");
  });

  it("offers the level, with the one-month form first", () => {
    const markup = popover();

    expect(markup).toContain('data-testid="study-schedule-level"');
    expect(markup).toContain(">one month<");
  });

  it("ghosts the tail the choice will overwrite", () => {
    expect(popover()).toContain("was: force 4, force 5");
    expect(popover()).toContain('data-testid="study-schedule-was"');
  });

  it("carries the three buttons the navigator chose", () => {
    const markup = popover();

    expect(markup).toContain(">Set<");
    expect(markup).toContain(">Cancel<");
    expect(markup).toContain(">Clear from here<");
  });

  it("warns when an impossible skill is the chosen one", () => {
    const blocked = menu.notYet[0];
    const markup = renderToStaticMarkup(
      <CellPopover
        menu={menu}
        mode={{ ...mode, skill: blocked.skill }}
        mageName="Ereb"
        turn={27}
        replacing="was: force 4, force 5"
        onEvent={() => {}}
        onSet={() => {}}
        onClear={() => {}}
      />
    );

    expect(markup).toContain(
      `Ereb cannot study ${blocked.name} by turn 27. The plan will say so anyway.`
    );
  });
});
