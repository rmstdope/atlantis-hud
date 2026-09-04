import { useEffect, useRef } from "react";
import { STANDING_CHIP } from "./standingChip";
import { useEscapeToDismiss } from "./dismissLayer";
import type { MagicTree } from "../magicTree";
import type { StudyGoal } from "@atlantis/core-client";
import {
  goalsAfterClear,
  goalsAfterSet,
  cellMenu,
  cellWarning,
  type CellMenu
} from "../studyCell";
import { hoverCard, type ScheduleRow } from "../studySchedule";
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
  saveError
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
}) {
  if (turns.length === 0) {
    return (
      <div data-testid="study-schedule" className="min-h-0 overflow-auto p-3">
        <p className="text-ink-dim">Load a report and the coming six turns appear here.</p>
      </div>
    );
  }

  const open = mode.kind === "editing" ? rows.find((row) => row.key === mode.rowKey) ?? null : null;
  const menu =
    open === null || mode.kind !== "editing"
      ? null
      : cellMenu({
          mageName: open.name,
          turn: turns[mode.turnIndex],
          standing: open.standings[mode.turnIndex] ?? new Map(),
          tree
        });

  return (
    <div data-testid="study-schedule" className="min-h-0 overflow-auto">
      {saveError === null ? null : (
        <p data-testid="study-schedule-error" className="m-0 px-2 py-1 text-warn">
          {saveError}
        </p>
      )}
      <ScheduleGrid rows={rows} groups={groups} turns={turns} mode={mode} onEvent={onEvent} />
      {menu === null || open === null || mode.kind !== "editing" ? null : (
        <CellPopoverLayer
          menu={menu}
          mode={mode}
          mageName={open.name}
          turn={turns[mode.turnIndex]}
          onEvent={onEvent}
          onSet={(goal) => {
            onCommit(open.key, goalsAfterSet(open.goals, open, mode.turnIndex, goal));
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

/** The table itself. Hook-free, so the markup can be tested without a DOM. */
export function ScheduleGrid({
  rows,
  groups,
  turns,
  mode,
  onEvent
}: {
  rows: readonly ScheduleRow[];
  groups: readonly PlannerGroup[];
  turns: readonly number[];
  mode: CellMode;
  onEvent: (event: CellEvent) => void;
}) {
  const byKey = new Map(rows.map((row) => [row.key, row]));
  return (
    <table className="w-full border-collapse text-pane">
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
          />
        ))}
      </tbody>
    </table>
  );
}

function FactionRows({
  group,
  byKey,
  turns,
  mode,
  onEvent
}: {
  group: PlannerGroup;
  byKey: ReadonlyMap<string, ScheduleRow>;
  turns: readonly number[];
  mode: CellMode;
  onEvent: (event: CellEvent) => void;
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
              const tint =
                cell?.kind === "study" && cell.blocked !== null
                  ? STANDING_CHIP.ceiling
                  : cell?.kind === "study" && cell.gained
                    ? STANDING_CHIP.known
                    : "";
              return (
                <td key={turn} className="px-1 py-1 align-top">
                  <button
                    type="button"
                    data-testid={`study-schedule-cell-${row.unitId}-${turn}`}
                    aria-expanded={open}
                    title={cell?.kind === "study" ? (cell.blocked ?? undefined) : undefined}
                    onClick={() =>
                      onEvent({
                        kind: "cell-clicked",
                        rowKey: row.key,
                        turnIndex: index,
                        skill: cell?.kind === "study" ? cell.skill : null,
                        targetLevel: null
                      })
                    }
                    className={`w-full rounded border px-1 text-left ${tint}`}
                  >
                    {cell === undefined || cell.kind === "idle"
                      ? "+"
                      : `${cell.name} ${cell.level}`}
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
  onEvent,
  onSet,
  onClear
}: {
  menu: CellMenu;
  mode: Extract<CellMode, { kind: "editing" }>;
  mageName: string;
  turn: number;
  onEvent: (event: CellEvent) => void;
  onSet: (goal: StudyGoal) => void;
  onClear: () => void;
}) {
  const chosen = [...menu.raise, ...menu.begin, ...menu.notYet].find(
    (choice) => choice.skill === mode.skill
  );
  const warning = chosen === undefined ? null : cellWarning(chosen, turn, mageName);

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
        } else if (action === "set" && chosen !== undefined) {
          event.preventDefault();
          onSet({ skill: chosen.skill, targetLevel: mode.targetLevel });
        }
      }}
    >
      <p className="m-0 text-ink">{menu.heading}</p>
      {menu.sub === null ? null : <p className="m-0 text-ink-dim">{menu.sub}</p>}

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
                  aria-pressed={mode.skill === choice.skill}
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
          value={mode.targetLevel === null ? "" : String(mode.targetLevel)}
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
          disabled={chosen === undefined}
          onClick={() =>
            chosen === undefined
              ? undefined
              : onSet({ skill: chosen.skill, targetLevel: mode.targetLevel })
          }
        >
          Set
        </button>
      </div>
    </div>
  );
}
