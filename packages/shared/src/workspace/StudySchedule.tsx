import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { placeUnderAnchor, type Placement } from "../unitTooltip";
import { STANDING_CHIP } from "./standingChip";
import { useEscapeToDismiss } from "./dismissLayer";
import type { MagicTree } from "../magicTree";
import type { StudyGoal } from "@atlantis/core-client";
import {
  cellMenu,
  goalsAfterChoice,
  teachClick,
  teachWarning,
  type CellMenu
} from "../studyCell";
import { plannedGoals } from "../studyPlans";
import { cellLabel, type ScheduleRow } from "../studySchedule";
import { magePane, type MagePane } from "../studyMagePane";
import { noticeSummary, type PlannerNotice } from "../studyTeaching";
import type { PlannerGroup } from "../studyPlanner";
import type { CellEvent, CellMode, CellPick } from "./studyCellState";
import { keyToAction } from "./studyCellState";

/**
 * The Schedule view (`ah-lyg6.2.3`): every mage a row, the next six turns the columns.
 *
 * `docs/ui/ah-lyg6.2.3-simple.html` is the design, chosen with the navigator. The grid **is** the
 * planner: a cell is one turn, clicking it opens a dropdown of what that mage can study then, and
 * a choice changes exactly the cell that was clicked. Every rule about what a cell offers, what it
 * says and what a choice writes lives in `studyCell.ts` and `studySchedule.ts`; nothing here
 * decides anything.
 *
 * The dropdown **hangs off the cell it belongs to** rather than sitting in the flow under the
 * table, where it read as a second pane opening rather than as that cell's own menu:
 * `FloatingAtCell` measures the cell by the `data-cell` address the arrow keys already use and
 * places the menu against it with `placeUnderAnchor`.
 *
 * Beside the six columns stands the **mage pane** (navigator, 2026-09-07), which replaced a
 * floating hover card. It fills from whatever the pointer or the focus is on - a turn cell for
 * that turn, the mage's name for where he stands now - and keeps what it last showed when the
 * pointer leaves, so it can be read without holding the mouse still on a row.
 *
 * **Split hook-free**, the way `MagePicker` and `StudyPlannerList` are: `packages/shared` has no
 * jsdom (ah-nass), so `ScheduleGrid`, `MagePaneView` and `CellPopover` take everything as
 * props and are what the unit tests render. Focus, the arrow keys and a dropdown actually opening
 * belong to the smoke suite.
 */
export function StudySchedule({
  rows,
  groups,
  turns,
  tree,
  mode,
  onEvent,
  onCommit,
  saveError,
  notices = [],
  label = (regionId: string) => regionId
}: {
  rows: readonly ScheduleRow[];
  /** For the faction headings, worded exactly as the All mages view words them. */
  groups: readonly PlannerGroup[];
  turns: readonly number[];
  tree: MagicTree;
  mode: CellMode;
  onEvent: (event: CellEvent) => void;
  /**
   * Called when a choice is made, with the *edit* rather than the resulting list.
   *
   * A function, because the store applies it against the row it holds when the write actually
   * runs: a plan is one row whose goals are written whole, so a second choice made while the
   * first write is still in flight would otherwise be built from a row that does not hold the
   * first choice yet, and would overwrite it.
   */
  onCommit: (rowKey: string, edit: (current: readonly StudyGoal[]) => StudyGoal[]) => void;
  /** `Could not save this plan.`, or null. */
  saveError: string | null;
  /** Everything the planner has to say about this plan, for the strip and the cell tints. */
  notices?: readonly PlannerNotice[];
  /** How a region id reads to a player, for a teach row naming a student's hex. */
  label?: (regionId: string) => string;
}) {
  // The pane follows the *focused* cell as well as the hovered one, or it would be unreachable
  // without a mouse - and the grid is walked with the arrow keys, which is what moves focus. A
  // null `turnIndex` is the mage's name rather than one of his months.
  const [at, setAt] = useState<{ rowKey: string; turnIndex: number | null } | null>(null);
  // Folded when the pane opens, every time, and not remembered - the same reasoning ah-lyg6.2.2
  // gave for the picked mage and ah-lyg6.2.3 for the view switch. **Above every return**, like
  // every other hook in this body; see the comment below.
  const [stripOpen, setStripOpen] = useState(false);

  // `scheduleTurns(null)` is empty, so this component is rendered both before and after a report
  // is loaded, on the same mounted instance. **Every hook in this body stays above every return**:
  // an `if (turns.length === 0) return ...` up here would make them conditional, React would
  // throw "Rendered more hooks than during the previous render" the moment a report arrived with
  // the planner open, and nothing would catch it - this package has no jsdom (ah-nass), so no
  // test in it can re-render a live instance, and `eslint-plugin-react-hooks` is not registered
  // in `eslint.config.mjs`.
  const empty = turns.length === 0;

  const hovered = at === null ? null : rows.find((row) => row.key === at.rowKey) ?? null;
  const pane =
    hovered === null || at === null
      ? null
      : magePane({
          row: hovered,
          turnIndex: at.turnIndex,
          turns,
          tree,
          factionLabel: factionLabelOf(groups, hovered.factionId),
          teacherNames: new Map(rows.map((row) => [row.key, row.name] as const)),
          rows
        });

  const editing = mode.kind === "choosing" || mode.kind === "teaching" ? mode : null;
  const open = editing === null ? null : rows.find((row) => row.key === editing.rowKey) ?? null;
  const menu =
    open === null || editing === null
      ? null
      : cellMenu({
          mageName: open.name,
          turn: turns[editing.turnIndex],
          standing: open.standings[editing.turnIndex] ?? new Map(),
          tree,
          rows,
          turnIndex: editing.turnIndex,
          rowKey: editing.rowKey,
          label
        });

  if (empty) {
    return (
      <div data-testid="study-schedule" className="min-h-0 overflow-auto p-3">
        <p className="text-ink-dim">Load a report and the coming six turns appear here.</p>
      </div>
    );
  }

  /** Move focus to the cell a notice names, by the address the arrow keys already use. */
  const focusCell = (notice: PlannerNotice) => {
    const rowIndex = rows.findIndex((row) => row.key === notice.rowKey);
    const cell = document.querySelector<HTMLElement>(
      `[data-cell="${rowIndex}:${notice.turnIndex}"]`
    );
    cell?.focus();
  };

  return (
    <div data-testid="study-schedule" className="grid min-h-0 grid-rows-[auto_1fr] overflow-hidden">
      {/* One grid child, whatever it holds: the error line and the strip share the `auto` row, so
          the scroller below keeps the `1fr` whether an error is showing or not. */}
      <div>
      {saveError === null ? null : (
        <p data-testid="study-schedule-error" className="m-0 px-2 py-1 text-warn">
          {saveError}
        </p>
      )}
      <div className="px-2 py-1">
        {notices.length === 0 ? (
          <p data-testid="study-planner-warnings-none" className="m-0 text-ink-dim">
            {noticeSummary([])}
          </p>
        ) : (
          <>
            <button
              type="button"
              data-testid="study-planner-warnings-toggle"
              aria-expanded={stripOpen}
              onClick={() => setStripOpen((was) => !was)}
              className="text-ink"
            >
              {`${stripOpen ? "▾" : "▸"} ${noticeSummary(notices)}`}
            </button>
            {!stripOpen ? null : (
              <ul
                data-testid="study-planner-warnings"
                className="m-0 max-h-36 list-none overflow-y-auto p-0"
              >
                {notices.map((notice, index) => (
                  <li key={`${notice.rowKey}:${notice.turnIndex}:${index}`}>
                    <button
                      type="button"
                      data-testid={`study-planner-warning-${index}`}
                      onClick={() => focusCell(notice)}
                      className={`flex w-full gap-2 px-1 text-left ${
                        notice.level === "warning"
                          ? "border-l-2 border-warn text-warn"
                          : "border-l-2 border-edge text-ink-dim"
                      }`}
                    >
                      <span className="flex-1">{notice.text}</span>
                      <span className="text-ink-dim">{notice.where}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
      </div>
      {/* The grid scrolls; the pane beside it is a column of its own and does not. */}
      <div className="grid min-h-0 grid-cols-[1fr_20rem] overflow-hidden">
        <div className="min-h-0 overflow-auto">
          <ScheduleGrid
            rows={rows}
            groups={groups}
            turns={turns}
            mode={mode}
            onEvent={onEvent}
            onAt={setAt}
            notices={notices}
          />
        </div>
        <MagePaneView pane={pane} />
      </div>
      {menu === null || open === null || editing === null ? null : (
        <CellPopoverLayer
          menu={menu}
          mode={editing}
          mageName={open.name}
          turn={turns[editing.turnIndex]}
          current={pickOf(open, turns[editing.turnIndex])}
          rowIndex={rows.findIndex((row) => row.key === editing.rowKey)}
          onEvent={onEvent}
          onChoose={(choice) => {
            // `plannedGoals` because the edit is applied against the *stored* row rather than
            // against the sanitized one the grid drew: a row written before goals named turns
            // would otherwise be carried forward by a write instead of dropped by it.
            onCommit(open.key, (goals) =>
              goalsAfterChoice(plannedGoals(goals), turns[editing.turnIndex], choice)
            );
            onEvent({ kind: "closed" });
          }}
        />
      )}
    </div>
  );
}

/**
 * The popover's own dismiss layer and its opening focus.
 *
 * A layer of its own, so `Escape` closes the menu and leaves the pane open - the dismiss stack
 * gives the topmost surface the key, which is exactly what is wanted here. Kept apart from
 * `CellPopover` so that component stays hook-free and `renderToStaticMarkup` can walk it.
 */
function CellPopoverLayer(props: Parameters<typeof CellPopover>[0]) {
  useEscapeToDismiss(() => props.onEvent({ kind: "cancelled" }));
  const box = useRef<HTMLDivElement | null>(null);
  const cell = `${props.rowIndex}:${props.mode.turnIndex}`;
  const step = props.mode.kind;
  // Focus lands on a *row*, not on the wrapper. The arrow-key walk reads `data-row` off the
  // focused element, so focusing the wrapper would leave the `↑↓ to move` the foot promises doing
  // nothing at all until the player found a row with Tab. Keyed on **both** the cell and the
  // step: on the step so that coming back from the teach step - whose buttons have just
  // unmounted - lands on a row again rather than on `<body>`, and on the cell because clicking a
  // second cell while a dropdown is open moves this one rather than remounting it (`reduce`
  // answers `cell-opened` with `choosing` whatever it was in, and there is no outside-click
  // dismissal - `dismissLayer.ts` listens for Escape alone). Without the cell in the list, that
  // click would leave focus on the *previous* grid cell, which the cleanup below has just taken.
  // React runs every cleanup before every effect, so this focus always wins over that one.
  useEffect(() => {
    const root = box.current;
    if (root === null) {
      return;
    }
    const target =
      root.querySelector<HTMLElement>('[data-row][aria-pressed="true"]') ??
      root.querySelector<HTMLElement>("[data-row]") ??
      root.querySelector<HTMLElement>("button:not([disabled])") ??
      root;
    target.focus({ preventScroll: true });
    // ...and then brought into view inside its own list. `preventScroll` is there because the card
    // is still off-screen for the layout pass in which this runs, and letting the browser chase it
    // would move whatever it could reach; `scrollIntoView` afterwards is the narrow version of the
    // same thing - the list is the only scroller between the row and a fixed wrapper, and `nearest`
    // moves it as little as it can. Without it a mage with a plan opened on a row nobody could see,
    // which read as a menu with nothing chosen at all.
    target.scrollIntoView({ block: "nearest" });
  }, [cell, step]);
  // Focus goes back to the cell the dropdown came from, by the `[data-cell="r:c"]` address the
  // arrow-key walk and `focusCell` already use: anything else strands a keyboard player at the
  // top of the grid. Its own effect, so the step change above cannot fire this cleanup and throw
  // focus out of a dropdown that is still open.
  useEffect(
    () => () => {
      document.querySelector<HTMLElement>(`[data-cell="${cell}"]`)?.focus();
    },
    [cell]
  );
  return (
    <FloatingAtCell cell={cell}>
      <div ref={box} tabIndex={-1}>
        <CellPopover {...props} />
      </div>
    </FloatingAtCell>
  );
}

/**
 * A card that hangs off the grid cell at `cell` - the `row:turn` address the arrow-key walk and
 * `focusCell` already use - instead of sitting in the flow beneath the table.
 *
 * Fixed and portalled to the body, the way `UnitContextMenu` is: the planner is a modal whose body
 * scrolls and clips, and a menu anchored inside it would be cut off at the pane's edge on the very
 * rows - the last ones - where it is most likely to open.
 *
 * Placed in a layout effect the browser runs before it draws, from the cell measured then rather
 * than from a rect held in state: the grid scrolls under the card, so the anchor moves without
 * anything re-rendering. While it is still unmeasured it sits off-screen rather than hidden -
 * `CellPopoverLayer` focuses a row inside it on mount, and focus does not land on anything inside
 * a `visibility: hidden` box.
 */
function FloatingAtCell({ cell, children }: { cell: string; children: ReactNode }) {
  // The node is held as state rather than a ref so the effect below runs once it exists, as
  // `UnitContextMenu` does for the same reason.
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [placed, setPlaced] = useState<Placement | null>(null);

  useLayoutEffect(() => {
    if (node === null) {
      return;
    }
    const place = () => {
      const anchor = document.querySelector<HTMLElement>(`[data-cell="${cell}"]`);
      if (anchor === null) {
        return;
      }
      const box = anchor.getBoundingClientRect();
      const next = placeUnderAnchor(
        { left: box.left, top: box.top, width: box.width, height: box.height },
        { width: node.offsetWidth, height: node.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight }
      );
      // Same place, same object: the size observer below fires on every layout of the card, and a
      // fresh object each time would re-render the whole dropdown for nothing.
      setPlaced((was) =>
        was !== null && was.left === next.left && was.top === next.top ? was : next
      );
    };
    place();
    // The card changes size as its content does - the teach step is a different list from the
    // dropdown - and a taller card near the bottom edge has to flip.
    const sizes = new ResizeObserver(place);
    sizes.observe(node);
    window.addEventListener("resize", place);
    // Capture, because the grid's own scroller does not bubble its scroll events to the window.
    window.addEventListener("scroll", place, true);
    return () => {
      sizes.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [node, cell]);

  return createPortal(
    <div
      ref={setNode}
      style={{ left: placed?.left ?? -9999, top: placed?.top ?? -9999 }}
      // `w-max` up to a cap that no row reaches: a menu row is one line - `create phantasmal
      // demons 3 → 3  (180 of 300)` - and a wrapped one is read twice before it is understood.
      // A step smaller than the grid it hangs off (13px to 12px) for the same reason: it is what
      // takes the longest rows off the second line, and a menu is read one row at a time anyway.
      className="fixed z-50 w-max max-w-[32rem] text-pane-sm"
    >
      {children}
    </div>,
    document.body
  );
}

/** What the cell at `turn` already holds, as a `CellPick`, or null when nothing is planned. */
function pickOf(row: ScheduleRow, turn: number): CellPick | null {
  const goal = row.goals.find((one) => one.turn === turn);
  if (goal === undefined) {
    return null;
  }
  return goal.kind === "teach"
    ? { kind: "teach", students: [...goal.students], live: goal.live === true }
    : { kind: "study", skill: goal.skill };
}

/** The group heading's faction label, so the card words a faction the way the list does. */
function factionLabelOf(groups: readonly PlannerGroup[], factionId: string): string {
  return groups.find((group) => group.factionId === factionId)?.factionLabel ?? "";
}

/** The table itself. Hook-free, so the markup can be tested without a DOM. */
export function ScheduleGrid({
  rows,
  groups,
  turns,
  mode,
  onEvent,
  onAt,
  notices
}: {
  rows: readonly ScheduleRow[];
  groups: readonly PlannerGroup[];
  turns: readonly number[];
  mode: CellMode;
  onEvent: (event: CellEvent) => void;
  /**
   * Which cell the pointer or the focus is on, for the mage pane; `turnIndex` is null for the
   * mage's name. Never called with null: the pane keeps its last mage rather than emptying as the
   * pointer crosses a gap.
   */
  onAt?: (at: { rowKey: string; turnIndex: number | null }) => void;
  /** Everything the planner has to say, so a cell can be tinted and titled by what it raised. */
  notices?: readonly PlannerNotice[];
}) {
  const byKey = new Map(rows.map((row) => [row.key, row]));
  // Arrow keys walk the grid cell by cell; `Enter` is the button's own. Delegated from the table
  // rather than bound per cell, which is one listener instead of mages x turns of them.
  const indexOfRow = new Map(rows.map((row, index) => [row.key, index]));
  const walk = (event: {
    key: string;
    target: EventTarget | null;
    currentTarget: EventTarget | null;
    preventDefault: () => void;
  }) => {
    const step = GRID_STEPS[event.key];
    if (step === undefined) {
      return;
    }
    const from = (event.target as HTMLElement | null)?.dataset?.cell;
    if (from === undefined) {
      return;
    }
    const [rowIndex, turnIndex] = from.split(":").map(Number);
    if (rows[rowIndex + step.row] === undefined || turns[turnIndex + step.turn] === undefined) {
      return;
    }
    event.preventDefault();
    // Scoped to this table rather than the document: a second grid on the page would otherwise
    // steal the focus.
    (event.currentTarget as HTMLElement | null)
      ?.querySelector<HTMLButtonElement>(
        `[data-cell="${rowIndex + step.row}:${turnIndex + step.turn}"]`
      )
      ?.focus();
  };
  return (
    <table className="w-full border-collapse text-pane" onKeyDown={walk}>
      <thead>
        <tr>
          <th className="sticky left-0 top-0 z-20 bg-panel-raised px-2 py-1 text-left text-ink-soft">
            Mage
          </th>
          {turns.map((turn, index) => (
            <th
              key={turn}
              data-testid={`study-schedule-turn-${turn}`}
              className="sticky top-0 z-10 bg-panel-raised px-2 py-1 text-left text-ink-soft"
            >
              {index === 0 ? `${turn} · next` : `${turn}`}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {groups.map((group) => (
          <FactionRows
            key={group.factionId + group.source}
            group={group}
            byKey={byKey}
            turns={turns}
            mode={mode}
            onEvent={onEvent}
            onAt={onAt}
            notices={notices}
            indexOfRow={indexOfRow}
          />
        ))}
      </tbody>
    </table>
  );
}

/** Which way each arrow key moves, in rows and in turns. */
const GRID_STEPS: Record<string, { row: number; turn: number }> = {
  ArrowUp: { row: -1, turn: 0 },
  ArrowDown: { row: 1, turn: 0 },
  ArrowLeft: { row: 0, turn: -1 },
  ArrowRight: { row: 0, turn: 1 }
};

function FactionRows({
  group,
  byKey,
  indexOfRow,
  turns,
  mode,
  onEvent,
  onAt,
  notices
}: {
  group: PlannerGroup;
  byKey: ReadonlyMap<string, ScheduleRow>;
  /** Each row's position in the whole grid, for the arrow keys' `data-cell` address. */
  indexOfRow: ReadonlyMap<string, number>;
  turns: readonly number[];
  mode: CellMode;
  onEvent: (event: CellEvent) => void;
  onAt?: (at: { rowKey: string; turnIndex: number | null }) => void;
  notices?: readonly PlannerNotice[];
}) {
  return (
    <>
      <tr data-testid={`study-schedule-group-${group.factionId}`}>
        <td colSpan={turns.length + 1} className="bg-panel px-2 py-1 text-ink-soft">
          {group.heading}
        </td>
      </tr>
      {group.mages.map((mage) => {
        const row = byKey.get(mage.key);
        if (row === undefined) {
          return null;
        }
        return (
          <tr key={row.key} data-testid={`study-schedule-row-${row.unitId}`}>
            {/* The name fills the pane with the mage as he stands now - the one reading no column
                can give, every column being a month that has already happened. */}
            <td
              data-testid={`study-schedule-name-${row.unitId}`}
              onMouseEnter={() => onAt?.({ rowKey: row.key, turnIndex: null })}
              className="sticky left-0 z-10 bg-panel-raised px-2 py-1 align-top"
            >
              <span className="text-ink">
                {row.name} ({row.unitId})
              </span>
              {row.hasNote ? (
                <span data-testid={`study-schedule-note-${row.unitId}`} title="Has a note">
                  {" "}
                  ✎
                </span>
              ) : null}
              <span className="block text-ink-dim">{row.summary}</span>
            </td>
            {turns.map((turn, index) => {
              const cell = row.cells[index];
              const open =
                mode.kind !== "idle" && mode.rowKey === row.key && mode.turnIndex === index;
              const cellNotices = (notices ?? []).filter(
                (notice) => notice.rowKey === row.key && notice.turnIndex === index
              );
              const warned = cellNotices.some((notice) => notice.level === "warning");
              const tint =
                cell?.kind === "teach"
                  ? warned
                    ? STANDING_CHIP.ceiling
                    : STANDING_CHIP.maxed
                  : cell?.kind === "study" && cell.blocked !== null
                    ? STANDING_CHIP.ceiling
                    : cell?.kind === "study" && cell.gained
                      ? STANDING_CHIP.known
                      : "";
              return (
                <td key={turn} className="px-1 py-1 align-top">
                  <button
                    type="button"
                    data-testid={`study-schedule-cell-${row.unitId}-${turn}`}
                    data-cell={`${indexOfRow.get(row.key) ?? -1}:${index}`}
                    aria-expanded={open}
                    onMouseEnter={() => onAt?.({ rowKey: row.key, turnIndex: index })}
                    onFocus={() => onAt?.({ rowKey: row.key, turnIndex: index })}
                    title={
                      cellNotices.length > 0
                        ? cellNotices.map((notice) => notice.text).join(" ")
                        : cell?.kind === "study"
                          ? (cell.blocked ?? undefined)
                          : undefined
                    }
                    onClick={() =>
                      onEvent({ kind: "cell-opened", rowKey: row.key, turnIndex: index })
                    }
                    className={`w-full rounded border px-1 text-left ${tint}`}
                  >
                    {cellLabel(cell)}
                  </button>
                </td>
              );
            })}
          </tr>
        );
      })}
    </>
  );
}

/**
 * The pane beside the turns: what the mage under the pointer knows, and what he could study.
 *
 * Hook-free like every other piece of this file, and it holds no state of its own - what it shows
 * is `at` in `StudySchedule`, which the grid sets and nothing clears, so the pane keeps its last
 * mage when the pointer leaves the table.
 */
export function MagePaneView({ pane }: { pane: MagePane | null }) {
  if (pane === null) {
    return (
      <aside
        data-testid="study-schedule-mage-pane"
        className="min-h-0 overflow-y-auto border-l border-edge p-2"
      >
        <p className="m-0 text-ink-dim">
          Point at a mage, or at one of his months, to see what he knows and what he could study.
        </p>
      </aside>
    );
  }
  return (
    // `Knows` is a fact about the mage, so it is shown whole at any length and never scrolls: a
    // skill cut off the bottom of a half-height box reads as one he does not have, which is what
    // this pane is opened to answer. `Can study` is a list you browse rather than a fact you check,
    // so it takes whatever height is left and scrolls there, fading where it is cut. The pane's own
    // `overflow-y-auto` is what keeps the `Can study` heading and the footnote reachable when
    // `Knows` alone is taller than the pane.
    <aside
      data-testid="study-schedule-mage-pane"
      className="flex min-h-0 flex-col overflow-y-auto border-l border-edge p-2"
    >
      <div className="shrink-0">
        <p className="m-0 text-ink">{pane.heading}</p>
        <p className="m-0 text-ink-dim">{pane.sub}</p>
        {/* Above the skills, not below them: a note says where his studies are heading, which is
            the thing to have read before a month is chosen for him. `whitespace-pre-wrap` because
            the editor that wrote it takes several lines and keeps them. */}
        {pane.note === "" ? null : (
          <p
            data-testid="study-schedule-note"
            className="m-0 mt-2 border-l-2 border-edge pl-2 whitespace-pre-wrap text-ink-soft"
          >
            {pane.note}
          </p>
        )}
      </div>

      <p className="m-0 mt-2 shrink-0 text-ink-soft" data-testid="study-schedule-knows">
        {pane.knowsHeading}
      </p>
      <ul className="m-0 shrink-0 list-none p-0">
        {pane.knows.map((line) => (
          <li
            key={line.name}
            data-testid={`study-schedule-knows-${line.name.replace(/\s+/g, "-")}`}
            className={line.studying ? `rounded px-1 ${STANDING_CHIP.known}` : "px-1 text-ink"}
          >
            {line.name} <span className="text-ink-dim">{line.right}</span>
          </li>
        ))}
      </ul>

      <p className="m-0 mt-2 shrink-0 text-ink-soft" data-testid="study-schedule-can-study">
        {pane.canStudyHeading}
      </p>
      <ul className="fade-bottom m-0 min-h-0 flex-1 list-none overflow-y-auto p-0">
        {pane.canStudy.map((choice) => (
          <li
            key={choice.skill}
            data-testid={`study-schedule-can-study-${choice.skill}`}
            className="px-1 text-ink"
          >
            {choice.name}{" "}
            <span className={choice.taughtBy === null ? "text-ink-dim" : "text-ok"}>
              {choice.detail}
            </span>
          </li>
        ))}
      </ul>

      <p className="m-0 mt-2 shrink-0 text-ink-dim">{pane.foot}</p>
    </aside>
  );
}

/**
 * The teach dialog's heading, and its `aria-label` - one function so the accessible name and the
 * visible line cannot diverge. The em dash with a space either side is the navigator's wording
 * (ah-af7i).
 */
function teachHeading(mageName: string, turn: number, live: boolean): string {
  return live
    ? `${mageName} teaches on turn ${turn} — everyone eligible`
    : `${mageName} teaches on turn ${turn}`;
}

/**
 * The cell's dropdown, and the teach step behind it. Hook-free, so the markup can be tested
 * without a DOM.
 *
 * Choosing a skill or `— nothing` commits and closes: one choice is one click. Only teaching, where
 * several students are ticked, keeps `Cancel` and `Set`.
 */
export function CellPopover({
  menu,
  mode,
  mageName,
  turn,
  current,
  onEvent,
  onChoose
}: {
  menu: CellMenu;
  mode: Extract<CellMode, { kind: "choosing" } | { kind: "teaching" }>;
  mageName: string;
  turn: number;
  /** What the cell already holds, read by the caller from the row's stored plan. */
  current: CellPick | null;
  /** Which row of the grid this cell is in, for returning focus to it on close. */
  rowIndex: number;
  onEvent: (event: CellEvent) => void;
  onChoose: (choice: CellPick | null) => void;
}) {
  if (mode.kind === "teaching") {
    const warning = teachWarning(
      menu.teach.filter((choice) => mode.students.includes(choice.unitId)),
      turn,
      mageName
    );
    return (
      <div
        data-testid="study-schedule-popover"
        role="dialog"
        aria-label={teachHeading(mageName, turn, mode.live)}
        className="rounded border border-edge bg-panel-raised p-2 shadow-lg"
        // `Cmd/Ctrl+Enter` only. **Escape is not handled here and must not be**: the layer's
        // `useEscapeToDismiss` is a capture-phase document listener that stops propagation before
        // React dispatches, so a `cancel` branch on this element would be dead code reading like
        // the mechanism that takes the teach step back to the dropdown. That is the layer's.
        onKeyDown={(event) => {
          if (
            keyToAction({
              key: event.key,
              metaKey: event.metaKey,
              ctrlKey: event.ctrlKey
            }) === "set"
          ) {
            event.preventDefault();
            onChoose({ kind: "teach", students: [...mode.students], live: mode.live });
          }
        }}
      >
        <p className="m-0 text-ink">{teachHeading(mageName, turn, mode.live)}</p>
        <ul className="m-0 max-h-[45vh] list-none overflow-y-auto p-0">
          {menu.teach.map((choice) => (
            <li key={choice.unitId}>
              <button
                type="button"
                role="checkbox"
                data-testid={`study-schedule-teach-${choice.unitId}`}
                aria-checked={mode.students.includes(choice.unitId)}
                disabled={choice.blocked !== null}
                onPointerMove={(event) => event.currentTarget.focus({ preventScroll: true })}
                onClick={() => onEvent({ kind: "teach-toggled", unitId: choice.unitId })}
                className={`w-full rounded px-1 text-left ${
                  choice.blocked === null ? ROW_HIGHLIGHT : "text-ink-dim"
                }`}
              >
                <ChoiceMark on={mode.students.includes(choice.unitId)} />
                <span className="text-ink">{choice.label}</span>{" "}
                <span className="text-ink-dim">{choice.detail}</span>
              </button>
            </li>
          ))}
        </ul>
        {warning === null ? null : (
          <p data-testid="study-schedule-warning" className="m-0 mt-1 text-warn">
            {warning}
          </p>
        )}
        <div className="mt-2 flex gap-2">
          <span className="flex-1" />
          {/* Bordered, like every other action in this workspace: bare text beside bare text is a
              pair of labels rather than the two controls this step ends on. `Set` carries the
              brass of a commit, `Cancel` the plain edge of a way out. */}
          <button
            type="button"
            data-testid="study-schedule-cancel"
            onClick={() => onEvent({ kind: "cancelled" })}
            className="rounded border border-edge px-2 py-0.5 text-ink-soft hover:border-brass hover:text-brass"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="study-schedule-set"
            onClick={() =>
              onChoose({ kind: "teach", students: [...mode.students], live: mode.live })
            }
            className="rounded border border-brass px-2 py-0.5 text-brass"
          >
            Set
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="study-schedule-popover"
      role="dialog"
      aria-label={menu.heading}
      className="rounded border border-edge bg-panel-raised p-2 shadow-lg"
    >
      <p className="m-0 text-ink">{menu.heading}</p>
      <ul
        // Every list in this menu scrolls rather than grows, at the same height. A menu whose last
        // row is below the bottom edge cannot be chosen from and has nowhere left to flip to: the
        // teach step, the longest of them, stood 794px tall in a 720px window and put `Set` out of
        // reach. The cap is on the list rather than on the panel so the heading, the warning and
        // the buttons are on screen whatever the list holds.
        className="m-0 max-h-[45vh] list-none overflow-y-auto p-0"
        // `↑↓` move between the rows, wrapping at both ends; `↵` activates the focused button
        // natively, so nothing handles it. Scoped to this list, as `ScheduleGrid`'s own walk is.
        onKeyDown={(event) => {
          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
            return;
          }
          const rows = event.currentTarget.querySelectorAll<HTMLElement>("[data-row]");
          const from = (event.target as HTMLElement | null)?.dataset?.row;
          if (from === undefined || rows.length === 0) {
            return;
          }
          event.preventDefault();
          const step = event.key === "ArrowDown" ? 1 : -1;
          const next = (Number(from) + step + rows.length) % rows.length;
          event.currentTarget
            .querySelector<HTMLElement>(`[data-row="${next}"]`)
            ?.focus();
        }}
      >
        {rowsOf(menu, current).map((row, index) => (
          <li key={row.key}>
            <button
              type="button"
              data-testid={row.testId}
              data-row={index}
              aria-pressed={row.pressed}
              // The pointer moves the same highlight the arrows do, so the row a click would take
              // and the row `↵` would take are always the one row. `pointermove` rather than
              // `pointerenter`, for the reason the palette gives (`CommandPalette.tsx`): the list
              // scrolls, and entering a row that slid under a still mouse would hand the highlight
              // back from wherever the arrows had just put it. `preventScroll` because the arrows
              // are what should scroll this list, never the mouse.
              onPointerMove={(event) => event.currentTarget.focus({ preventScroll: true })}
              onClick={row.onClick(onEvent, onChoose, current)}
              className={`w-full rounded px-1 text-left ${ROW_HIGHLIGHT}`}
            >
              <ChoiceMark on={row.pressed} />
              <span className="text-ink">{row.name}</span>
              {row.detail === null ? null : (
                <>
                  {" "}
                  <span className={row.taught ? "text-ok" : "text-ink-dim"}>{row.detail}</span>
                </>
              )}
            </button>
          </li>
        ))}
      </ul>
      {menu.empty === null ? null : (
        <p data-testid="study-schedule-empty" className="m-0 mt-1 text-ink-dim">
          {menu.empty}
        </p>
      )}
      <p className="m-0 mt-2 text-ink-dim">↑↓ to move · ↵ to choose · Esc to close</p>
    </div>
  );
}

/**
 * What marks the row a click or `↵` would take.
 *
 * The browser's own ring is all this had, and it is a hairline the eye misses - and it is not
 * drawn at all when focus was moved by script rather than by Tab, which is every way into this
 * menu: opening it focuses a row, and the arrows focus the next one. A filled row is what says
 * "this one", and `bg-select/25` is what the unit dock already fills its current row with.
 */
const ROW_HIGHLIGHT = "hover:bg-select/25 focus:bg-select/25";

/**
 * The tick on the row that is already chosen - the cell's own study or teach, and each student
 * already named in the teach step.
 *
 * `aria-pressed` and `aria-checked` said this to a screen reader and to nobody else, so a menu
 * opened on a planned cell looked exactly like one opened on an empty cell. It is a mark rather
 * than a second background, because the row that is *chosen* and the row a click would *take* are
 * different things that are true at the same time - the menu opens with both on the same row, and
 * one arrow key separates them.
 *
 * A slot of a fixed width whether it holds the tick or not, so every label in the list starts at
 * the same column; `aria-hidden`, because the ARIA state above already says it and a screen reader
 * should not hear it twice.
 */
function ChoiceMark({ on }: { on: boolean }) {
  return (
    <span aria-hidden="true" className="inline-block w-4 text-select">
      {on ? "✓" : ""}
    </span>
  );
}

/**
 * The dropdown's rows in the agreed order: `— nothing`, `Teaches…`, then the skills. The
 * `Teaches…` row is always offered, whether or not anybody is yet teachable (ah-12h7).
 *
 * A list rather than three blocks of JSX, so the arrow-key walk can number them and the order is
 * one thing rather than three.
 */
function rowsOf(
  menu: CellMenu,
  current: CellPick | null
): {
  key: string;
  testId: string;
  name: string;
  detail: string | null;
  /** True for a month somebody would double: the row is drawn green rather than dim. */
  taught: boolean;
  pressed: boolean;
  onClick: (
    onEvent: (event: CellEvent) => void,
    onChoose: (choice: CellPick | null) => void,
    current: CellPick | null
  ) => () => void;
}[] {
  return [
    {
      key: "nothing",
      testId: "study-schedule-choice-nothing",
      name: "— nothing",
      detail: null,
      taught: false,
      pressed: current === null,
      onClick: (_onEvent, onChoose) => () => onChoose(null)
    },
    {
      key: "teach",
      testId: "study-schedule-choice-teach",
      name: "Teaches…",
      detail: menu.teachDetail,
      taught: false,
      pressed: current?.kind === "teach",
      onClick:
        (
          onEvent: (event: CellEvent) => void,
          onChoose: (pick: CellPick | null) => void,
          current: CellPick | null
        ) =>
        () => {
          // A frozen cell reopens with exactly its stored ticks; a live one stores none, so its
          // seed is recomputed (ah-af7i). With nothing tickable there is no second step to open,
          // so the row commits outright (ah-12h7).
          const click = teachClick(menu.teach, current);
          if (click.kind === "commit") {
            onChoose({ kind: "teach", students: [], live: true });
            return;
          }
          onEvent({ kind: "teach-opened", students: click.students, live: click.live });
        }
    },
    ...menu.choices.map((choice) => ({
      key: choice.skill,
      testId: `study-schedule-choice-${choice.skill}`,
      name: choice.name,
      detail: choice.detail,
      taught: choice.taughtBy !== null,
      pressed: current?.kind === "study" && current.skill === choice.skill,
      onClick:
        (
          _onEvent: (event: CellEvent) => void,
          onChoose: (pick: CellPick | null) => void
        ) =>
        () =>
          onChoose({ kind: "study", skill: choice.skill })
    }))
  ];
}
