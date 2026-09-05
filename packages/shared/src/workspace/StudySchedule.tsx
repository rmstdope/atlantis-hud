import { useEffect, useRef, useState } from "react";
import { STANDING_CHIP } from "./standingChip";
import { useEscapeToDismiss } from "./dismissLayer";
import type { MagicTree } from "../magicTree";
import type { StudyGoal } from "@atlantis/core-client";
import {
  goalsAfterClear,
  goalsAfterPick,
  cellMenu,
  cellWarning,
  teachWarning,
  type CellMenu
} from "../studyCell";
import { hoverCard, worthMark, type ScheduleRow } from "../studySchedule";
import { noticeSummary, type PlannerNotice } from "../studyTeaching";
import type { PlannerGroup } from "../studyPlanner";
import type { CellEvent, CellMode } from "./studyCellState";
import { keyToAction } from "./studyCellState";

/**
 * The Schedule view (`ah-lyg6.2.3`): every mage a row, the next six turns the columns.
 *
 * `docs/ui/ah-lyg6.2.3-schedule.html` and `-cell.html` are the design, chosen with the navigator.
 * The grid **is** the planner: clicking a cell says what that mage studies from that turn on, and
 * the cells to its right re-flow. Every rule about what a cell offers, what it says and what queue
 * a choice writes lives in `studyCell.ts` and `studySchedule.ts`; nothing here decides anything.
 *
 * **Split hook-free**, the way `MagePicker` and `StudyPlannerList` are: `packages/shared` has no
 * jsdom (ah-nass), so `ScheduleGrid`, `ScheduleHoverCard` and `CellPopover` take everything as
 * props and are what the unit tests render. Focus, the arrow keys and a popover actually opening
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
  /** Called with the whole new goal list for one mage when `Set` or `Clear from here` is pressed. */
  onCommit: (rowKey: string, goals: StudyGoal[]) => void;
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

  const open = mode.kind === "editing" ? rows.find((row) => row.key === mode.rowKey) ?? null : null;
  const menu =
    open === null || mode.kind !== "editing"
      ? null
      : cellMenu({
          mageName: open.name,
          turn: turns[mode.turnIndex],
          standing: open.standings[mode.turnIndex] ?? new Map(),
          tree,
          rows,
          turnIndex: mode.turnIndex,
          rowKey: mode.rowKey,
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
      {menu === null || open === null || mode.kind !== "editing" ? null : (
        <CellPopoverLayer
          menu={menu}
          mode={mode}
          mageName={open.name}
          turn={turns[startTurnIndex(open, mode.turnIndex)]}
          replacing={wasText(open, mode.turnIndex)}
          onEvent={onEvent}
          onSet={(goal) => {
            onCommit(open.key, goalsAfterPick(open.goals, open, mode.turnIndex, goal));
            onEvent({ kind: "set" });
          }}
          onClear={() => {
            onCommit(open.key, goalsAfterClear(open.goals, open, mode.turnIndex));
            onEvent({ kind: "set" });
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
  useEffect(() => {
    box.current?.focus();
  }, []);
  return (
    <div ref={box} tabIndex={-1}>
      <CellPopover {...props} />
    </div>
  );
}

/** The group heading's faction label, so the card words a faction the way the list does. */
function factionLabelOf(groups: readonly PlannerGroup[], factionId: string): string {
  return groups.find((group) => group.factionId === factionId)?.factionLabel ?? "";
}

/**
 * The turn a goal set at `turnIndex` will actually begin.
 *
 * On an idle cell the new goal is simply appended (`goalsAfterSet`), so it starts at the first
 * idle turn rather than at the one clicked. The popover says which turn it is talking about, so
 * it must say the turn the study will really start, not the column the pointer was over.
 */
function startTurnIndex(row: ScheduleRow, turnIndex: number): number {
  if (row.cells[turnIndex]?.kind !== "idle") {
    return turnIndex;
  }
  const first = row.cells.findIndex((cell) => cell.kind === "idle");
  return first === -1 ? turnIndex : Math.min(first, turnIndex);
}

/** `was: force 4, force 4, force 5` - the tail this choice will overwrite, or null. */
function wasText(row: ScheduleRow, turnIndex: number): string | null {
  const tail = row.cells
    .slice(startTurnIndex(row, turnIndex))
    .filter((cell) => cell.kind === "study")
    .map((cell) => (cell.kind === "study" ? `${cell.name} ${cell.level}` : ""));
  return tail.length === 0 ? null : `was: ${tail.join(", ")}`;
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
                mode.kind === "editing" && mode.rowKey === row.key && mode.turnIndex === index;
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
                      onEvent({
                        kind: "cell-clicked",
                        rowKey: row.key,
                        turnIndex: index,
                        pick:
                          cell?.kind === "study"
                            ? { kind: "study", skill: cell.skill, targetLevel: null }
                            : cell?.kind === "teach"
                              ? { kind: "teach", students: [...cell.students] }
                              : null
                      })
                    }
                    className={`w-full rounded border px-1 text-left ${tint}`}
                  >
                    {cell === undefined || cell.kind === "idle"
                      ? "+"
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

/** The cell's menu: three groups, a level, and the two buttons that end it. */
export function CellPopover({
  menu,
  mode,
  mageName,
  turn,
  replacing,
  onEvent,
  onSet,
  onClear
}: {
  menu: CellMenu;
  mode: Extract<CellMode, { kind: "editing" }>;
  mageName: string;
  turn: number;
  /** `was: force 4, force 4, force 5` - the tail this choice overwrites, or null. */
  replacing: string | null;
  onEvent: (event: CellEvent) => void;
  onSet: (goal: StudyGoal) => void;
  onClear: () => void;
}) {
  const picked = mode.pick;
  const chosen =
    picked?.kind === "study"
      ? [...menu.raise, ...menu.begin, ...menu.notYet].find(
          (choice) => choice.skill === picked.skill
        )
      : undefined;
  const ticked = picked?.kind === "teach" ? picked.students : [];
  const warning =
    picked?.kind === "teach"
      ? teachWarning(
          menu.teach.filter((choice) => ticked.includes(choice.unitId)),
          turn,
          mageName
        )
      : chosen === undefined
        ? null
        : cellWarning(chosen, turn, mageName);
  /** What Set would write, or null when nothing is picked. */
  const goal: StudyGoal | null =
    picked?.kind === "teach"
      ? { kind: "teach", students: [...picked.students] }
      : chosen === undefined
        ? null
        : { kind: "study", skill: chosen.skill, targetLevel: picked?.kind === "study" ? picked.targetLevel : null };

  return (
    <div
      data-testid="study-schedule-popover"
      role="dialog"
      aria-label={menu.heading}
      className="rounded border border-edge bg-panel-raised p-2"
      onKeyDown={(event) => {
        const action = keyToAction({
          key: event.key,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey
        });
        if (action === "cancel") {
          event.stopPropagation();
          onEvent({ kind: "cancelled" });
        } else if (action === "set" && goal !== null) {
          event.preventDefault();
          onSet(goal);
        }
      }}
    >
      <p className="m-0 text-ink">{menu.heading}</p>
      {menu.sub === null ? null : <p className="m-0 text-ink-dim">{menu.sub}</p>}
      {replacing === null ? null : (
        <p data-testid="study-schedule-was" className="m-0 text-ink-dim line-through">
          {replacing}
        </p>
      )}

      {menu.teach.length === 0 ? null : (
        <div data-testid="study-schedule-group-teach">
          <p className="m-0 mt-2 text-ink-soft">Teaches</p>
          <ul className="m-0 list-none p-0">
            {menu.teach.map((choice) => (
              <li key={choice.unitId}>
                <button
                  type="button"
                  role="checkbox"
                  data-testid={`study-schedule-teach-${choice.unitId}`}
                  aria-checked={ticked.includes(choice.unitId)}
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
        </div>
      )}

      {(
        [
          ["Raise", menu.raise, "raise"],
          ["Begin", menu.begin, "begin"],
          [`Not by turn ${turn}`, menu.notYet, "not-yet"]
        ] as const
      ).map(([heading, choices, key]) => (
        <div key={key} data-testid={`study-schedule-group-${key}`}>
          <p className="m-0 mt-2 text-ink-soft">{heading}</p>
          <ul className="m-0 list-none p-0">
            {choices.map((choice) => (
              <li key={choice.skill}>
                <button
                  type="button"
                  data-testid={`study-schedule-choice-${choice.skill}`}
                  aria-pressed={picked?.kind === "study" && picked.skill === choice.skill}
                  onClick={() => onEvent({ kind: "skill-chosen", skill: choice.skill })}
                  className="w-full rounded px-1 text-left"
                >
                  <span className="text-ink">{choice.name}</span>{" "}
                  <span className="text-ink-dim">{choice.detail}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}

      <label className="mt-2 block text-ink-soft">
        to{" "}
        <select
          data-testid="study-schedule-level"
          value={
            picked?.kind === "study" && picked.targetLevel !== null
              ? String(picked.targetLevel)
              : ""
          }
          onChange={(event) =>
            onEvent({
              kind: "level-chosen",
              targetLevel: event.target.value === "" ? null : Number(event.target.value)
            })
          }
        >
          <option value="">one month</option>
          {(chosen?.levels ?? []).map((level) => (
            <option key={level} value={String(level)}>
              {level}
            </option>
          ))}
        </select>
      </label>

      {warning === null ? null : (
        <p data-testid="study-schedule-warning" className="m-0 mt-1 text-warn">
          {warning}
        </p>
      )}

      <div className="mt-2 flex gap-2">
        <button type="button" data-testid="study-schedule-clear" onClick={onClear}>
          Clear from here
        </button>
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
          disabled={goal === null}
          onClick={() => (goal === null ? undefined : onSet(goal))}
        >
          Set
        </button>
      </div>
    </div>
  );
}
