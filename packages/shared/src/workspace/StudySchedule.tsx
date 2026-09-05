import { useEffect, useRef, useState } from "react";
import { STANDING_CHIP } from "./standingChip";
import { useEscapeToDismiss } from "./dismissLayer";
import type { MagicTree } from "../magicTree";
import type { StudyGoal } from "@atlantis/core-client";
import { cellMenu, goalsAfterChoice, teachWarning, type CellMenu } from "../studyCell";
import { hoverCard, worthMark, type ScheduleRow } from "../studySchedule";
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
 * **Split hook-free**, the way `MagePicker` and `StudyPlannerList` are: `packages/shared` has no
 * jsdom (ah-nass), so `ScheduleGrid`, `ScheduleHoverCard` and `CellPopover` take everything as
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
  // The card follows the *focused* cell as well as the hovered one, or it would be unreachable
  // without a mouse - and the grid is walked with the arrow keys, which is what moves focus.
  const [at, setAt] = useState<{ rowKey: string; turnIndex: number } | null>(null);
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
  const card =
    hovered === null || at === null
      ? null
      : hoverCard(
          hovered,
          at.turnIndex,
          turns,
          tree,
          factionLabelOf(groups, hovered.factionId),
          new Map(rows.map((row) => [row.key, row.name] as const))
        );

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
      {card === null ? null : <ScheduleHoverCard card={card} />}
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
            onCommit(open.key, (goals) =>
              goalsAfterChoice(goals, turns[editing.turnIndex], choice)
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
    target.focus();
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
    <div ref={box} tabIndex={-1}>
      <CellPopover {...props} />
    </div>
  );
}

/** What the cell at `turn` already holds, as a `CellPick`, or null when nothing is planned. */
function pickOf(row: ScheduleRow, turn: number): CellPick | null {
  const goal = row.goals.find((one) => one.turn === turn);
  if (goal === undefined) {
    return null;
  }
  return goal.kind === "teach"
    ? { kind: "teach", students: [...goal.students] }
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
  /** Which cell the pointer or the focus is on, for the hover card. Null when neither is. */
  onAt?: (at: { rowKey: string; turnIndex: number } | null) => void;
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
    <table
      className="w-full border-collapse text-pane"
      onKeyDown={walk}
      onMouseLeave={() => onAt?.(null)}
    >
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
  onAt?: (at: { rowKey: string; turnIndex: number } | null) => void;
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
            <td className="sticky left-0 z-10 bg-panel-raised px-2 py-1 align-top">
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
                    {cell === undefined || cell.kind === "idle"
                      ? "—"
                      : cell.kind === "teach"
                        ? cell.label
                        : `${cell.name} ${cell.level}${(() => {
                            const mark = worthMark(
                              cell.worth,
                              cell.taughtBy !== null || cell.unsheltered
                            );
                            return mark === "" ? "" : ` ${mark}`;
                          })()}`}
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

/** What a mage knows at the hovered or focused cell's turn, the studied skill highlighted. */
export function ScheduleHoverCard({ card }: { card: ReturnType<typeof hoverCard> }) {
  return (
    <div data-testid="study-schedule-hover" className="rounded border border-edge bg-panel p-2">
      <p className="m-0 text-ink">{card.heading}</p>
      <p className="m-0 text-ink-dim">{card.sub}</p>
      <ul className="m-0 list-none p-0">
        {card.lines.map((line) => (
          <li
            key={line.name}
            data-testid={`study-schedule-hover-${line.name.replace(/\s+/g, "-")}`}
            className={line.studying ? `rounded px-1 ${STANDING_CHIP.known}` : "px-1 text-ink"}
          >
            {line.name} <span className="text-ink-dim">{line.right}</span>
          </li>
        ))}
      </ul>
      <p className="m-0 text-ink-dim">{card.foot}</p>
    </div>
  );
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
        aria-label={`${mageName} teaches on turn ${turn}`}
        className="rounded border border-edge bg-panel-raised p-2"
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
            onChoose({ kind: "teach", students: [...mode.students] });
          }
        }}
      >
        <p className="m-0 text-ink">{`${mageName} teaches on turn ${turn}`}</p>
        <ul className="m-0 list-none p-0">
          {menu.teach.map((choice) => (
            <li key={choice.unitId}>
              <button
                type="button"
                role="checkbox"
                data-testid={`study-schedule-teach-${choice.unitId}`}
                aria-checked={mode.students.includes(choice.unitId)}
                disabled={choice.blocked !== null}
                onClick={() => onEvent({ kind: "teach-toggled", unitId: choice.unitId })}
                className={`w-full rounded px-1 text-left ${
                  choice.blocked === null ? "" : "text-ink-dim"
                }`}
              >
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
          <button
            type="button"
            data-testid="study-schedule-cancel"
            onClick={() => onEvent({ kind: "cancelled" })}
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="study-schedule-set"
            onClick={() => onChoose({ kind: "teach", students: [...mode.students] })}
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
      className="rounded border border-edge bg-panel-raised p-2"
    >
      <p className="m-0 text-ink">{menu.heading}</p>
      <ul
        className="m-0 list-none p-0"
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
              onClick={row.onClick(onEvent, onChoose, current)}
              className="w-full rounded px-1 text-left"
            >
              <span className="text-ink">{row.name}</span>
              {row.detail === null ? null : (
                <>
                  {" "}
                  <span className="text-ink-dim">{row.detail}</span>
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
 * The dropdown's rows in the agreed order: `— nothing`, `Teaches…` when it is offered, then the
 * skills.
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
      pressed: current === null,
      onClick: (_onEvent, onChoose) => () => onChoose(null)
    },
    ...(menu.teachDetail === null
      ? []
      : [
          {
            key: "teach",
            testId: "study-schedule-choice-teach",
            name: "Teaches…",
            detail: menu.teachDetail,
            pressed: current?.kind === "teach",
            onClick:
              (onEvent: (event: CellEvent) => void) =>
              () =>
                onEvent({
                  kind: "teach-opened",
                  students: current?.kind === "teach" ? current.students : []
                })
          }
        ]),
    ...menu.choices.map((choice) => ({
      key: choice.skill,
      testId: `study-schedule-choice-${choice.skill}`,
      name: choice.name,
      detail: choice.detail,
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
