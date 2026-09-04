import { useEffect, useMemo, useRef, useState } from "react";
import { paletteKeyReduce, PALETTE_PAGE_ROWS } from "../commandPalette";
import {
  openingPlannerMage,
  plannerAlliedNotice,
  unreportedLine,
  type PlannerAlliedStatus,
  type PlannerGroup,
  type PlannerMage
} from "../studyPlanner";
import { useEscapeToDismiss } from "./dismissLayer";
import { STANDING_CHIP, standingWords } from "./standingChip";
import type { StudyGoal, StudyPlanRecord } from "@atlantis/core-client";
import type { MagicTree } from "../magicTree";
import { goalQueueText, scheduleRows, scheduleTurns } from "../studySchedule";
import { planFor } from "../studyPlans";
import { STUDY_NOTE_MAX_CHARS, noteCountText, normalizeStudyNote } from "../studyNote";
import { isMacPlatform } from "../shortcuts";
import { StudySchedule } from "./StudySchedule";
import { keyToAction as noteKeyToAction } from "./regionNotesState";
import { reduce as reduceCell, type CellMode } from "./studyCellState";

/**
 * The study planner (`ah-lyg6.2.2`): every mage the player can see, their own and their allies',
 * in one list with the chosen one read out beside it.
 *
 * `docs/ui/ah-lyg6.2.2-layout.html`, `-stale.html` and `-detail.html` are the design, chosen with
 * the navigator: a mage list beside a mage detail rather than a table, because the detail's room is
 * what `ah-lyg6.2.3`'s per-mage choice will need. The magic tree (F3) is the depth view - all
 * seventy skills for one mage - and this is the breadth view.
 *
 * `ah-lyg6.2.3` made it a planner. The header carries a two-view switch: **All mages**, the list
 * and detail this bead drew, and **Schedule**, a grid of every mage against the coming six turns
 * (`StudySchedule`). The detail gained a read-only line naming the goal queue and the per-mage
 * note; the grid is where a plan is actually written. Teaching is `ah-lyg6.3` and the export is
 * `ah-lyg6.4`.
 *
 * The frame is `GameDataDialog`'s, deliberately - a third reference pane must not invent a fourth.
 *
 * **Split hook-free** the way `MagePicker` is: `StudyPlannerList` and `StudyPlannerDetail` take
 * everything as props so a test in this package can walk them, since there is no jsdom here
 * (ah-nass). Focus, the arrow keys and scroll-into-view are therefore covered by the smoke suite.
 */
export function StudyPlannerDialog({
  groups,
  summaryLine,
  emptyCopy,
  alliedStatus,
  selectedUnitId,
  label,
  tree,
  plans,
  viewedTurn,
  saveError,
  onSavePlan,
  onSaveNote,
  onDismiss
}: {
  groups: readonly PlannerGroup[];
  /** `plannerSummaryLine(groups)`; null hides the sub-line. */
  summaryLine: string | null;
  emptyCopy: { headline: string; detail: string };
  /** The allied-mage store's status, for the loading and error lines. */
  alliedStatus: PlannerAlliedStatus;
  /** The workspace's selected unit, so the pane opens on him when he is a mage. */
  selectedUnitId: string | null;
  /** How a region id reads to a player. `AppShell`'s `hexLabel`. */
  label: (regionId: string) => string;
  /** The magic tree, for the Schedule's projection and its menus. */
  tree: MagicTree;
  /** Every stored plan of this game, from `useStudyPlansStore`. */
  plans: readonly StudyPlanRecord[];
  /** `report.header.turnNumber`, or null. Decides which turns the Schedule draws. */
  viewedTurn: number | null;
  /** `Could not save this plan.`, or null. Reported here rather than in the header status line,
   * which this dialog covers - the same choice `RegionNotes` made. */
  saveError: string | null;
  onSavePlan: (factionId: string, unitId: string, goals: StudyGoal[]) => void;
  onSaveNote: (factionId: string, unitId: string, comment: string) => void;
  onDismiss: () => void;
}) {
  useEscapeToDismiss(onDismiss);

  // Remembered no longer than the dialog, exactly as the picked mage is and for the reason
  // ah-lyg6.2.2 gave: a pane that opens differently depending on what you did last time is the
  // less predictable of the two.
  const [view, setView] = useState<"all" | "schedule">("all");
  const [cellMode, setCellMode] = useState<CellMode>({ kind: "idle" });
  const turns = useMemo(() => scheduleTurns(viewedTurn), [viewedTurn]);
  // Memoized beside `turns` and `flat`: without it every keystroke in the popover - each skill
  // click, each level change - re-projects every mage over six turns.
  const rows = useMemo(
    () => scheduleRows({ groups, plans, tree, turns }),
    [groups, plans, tree, turns]
  );

  const flat = useMemo(() => groups.flatMap((group) => group.mages), [groups]);
  // Not remembered between openings, unlike the tree's picked mage: a planner is a list, and
  // reopening it on your strongest mage is the more predictable of the two.
  const [pickedKey, setPickedKey] = useState<string | null>(
    () => openingPlannerMage(groups, selectedUnitId)?.key ?? null
  );
  const picked = flat.find((mage) => mage.key === pickedKey) ?? flat[0] ?? null;

  // Focus returns where it was summoned from, exactly as `GameDataDialog` does: this opens from F4
  // or from the palette, which itself opens from the orders editor.
  const summonedFrom = useRef<Element | null>(null);
  if (summonedFrom.current === null) {
    summonedFrom.current = typeof document === "undefined" ? null : document.activeElement;
  }
  useEffect(() => {
    return () => {
      const current = document.activeElement;
      if (
        (current === null || current === document.body) &&
        summonedFrom.current instanceof HTMLElement
      ) {
        summonedFrom.current.focus();
      }
    };
  }, []);

  // The selected row is scrolled into view whenever the selection changes. `block: "nearest"`
  // scrolls only when the row is actually off screen, so stepping between visible rows does not
  // jog the list - the same shape, and the same reason, as `GameDataDialog`'s.
  const list = useRef<HTMLUListElement | null>(null);

  // Focus opens inside the pane, because `aria-modal="true"` is only honest if it is - and the
  // arrow keys are the way the list is walked, so the list itself is what takes it. An effect
  // rather than `autoFocus`, which React applies to form controls and not to a `ul`.
  useEffect(() => {
    list.current?.focus();
  }, []);

  useEffect(() => {
    if (picked === null) {
      return;
    }
    const row = list.current?.querySelector(
      `[data-testid="study-planner-mage-${CSS.escape(picked.key)}"]`
    );
    row?.scrollIntoView({ block: "nearest" });
  }, [picked]);

  const notice = plannerAlliedNotice(
    alliedStatus,
    groups.some((group) => group.source === "own" && group.mages.length > 0)
  );

  const move = (key: string): boolean => {
    if (picked === null) {
      return false;
    }
    const at = flat.findIndex((mage) => mage.key === picked.key);
    const next = paletteKeyReduce(
      { index: at === -1 ? 0 : at, count: flat.length, pageSize: PALETTE_PAGE_ROWS },
      key
    );
    if (next === null) {
      return false;
    }
    const mage = flat[next];
    if (mage !== undefined) {
      setPickedKey(mage.key);
    }
    return true;
  };

  return (
    <div
      data-testid="study-planner-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onDismiss();
        }
      }}
      className="fixed inset-0 z-40 flex items-start justify-center bg-black/50 pt-[10vh]"
    >
      <div
        data-testid="study-planner-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Study planner"
        // 10vh below, matching the `pt-[10vh]` above: the two must be changed together. theme.css
        // caps every modal at 90vh as a `:where()` default at zero specificity, so this 80vh
        // simply wins with no `!` needed.
        className="grid max-h-[80vh] w-[56rem] max-w-[94vw] grid-rows-[auto_auto_1fr] rounded border border-edge bg-panel-raised text-pane whitespace-normal shadow-lg"
      >
        <div className="flex items-center gap-2 border-b border-edge px-2 py-1.5">
          <span className="text-ink-soft">Study planner</span>
          <span role="tablist" aria-label="Study planner view" className="flex gap-1">
            <button
              type="button"
              role="tab"
              data-testid="study-planner-view-all"
              aria-selected={view === "all"}
              onClick={() => setView("all")}
              className="rounded px-1.5"
            >
              All mages
            </button>
            <button
              type="button"
              role="tab"
              data-testid="study-planner-view-schedule"
              aria-selected={view === "schedule"}
              onClick={() => setView("schedule")}
              className="rounded px-1.5"
            >
              Schedule
            </button>
          </span>
          <span className="flex-1" />
          <button
            type="button"
            data-testid="study-planner-close"
            onClick={onDismiss}
            className="rounded px-1.5 text-ink-dim hover:text-ink"
          >
            Close
          </button>
        </div>

        {/*
          An empty div rather than null: the box is `grid-rows-[auto_auto_1fr]`, so dropping this
          child would leave the body in the second, `auto` track instead of the `1fr` one, and the
          two columns would stop filling the box and stop scrolling inside it.
        */}
        {summaryLine === null && notice === null ? (
          <div />
        ) : (
        <div className="border-b border-edge px-2 py-1 text-ink-dim">
          {summaryLine === null ? null : (
            <span data-testid="study-planner-summary">{summaryLine}</span>
          )}
          {notice === null ? null : (
            <span
              data-testid="study-planner-allied-notice"
              className={summaryLine === null ? "text-warn" : "ml-2 text-warn"}
            >
              {notice}
            </span>
          )}
        </div>
        )}

        {view === "schedule" ? (
          <StudySchedule
            rows={rows}
            groups={groups}
            turns={turns}
            tree={tree}
            mode={cellMode}
            onEvent={(event) => setCellMode((mode) => reduceCell(mode, event))}
            onCommit={(rowKey, goals) => {
              const [factionId, unitId] = rowKey.split("/");
              onSavePlan(factionId, unitId, goals);
            }}
            saveError={saveError}
          />
        ) : picked === null ? (
          <div data-testid="study-planner-empty" className="min-h-0 overflow-y-auto p-3">
            <p className="text-ink">{emptyCopy.headline}</p>
            <p className="text-ink-dim">{emptyCopy.detail}</p>
          </div>
        ) : (
          <div className="grid min-h-0 grid-cols-[17rem_1fr]">
            <StudyPlannerList
              listRef={list}
              groups={groups}
              picked={picked}
              onPick={setPickedKey}
              onMove={move}
            />
            <StudyPlannerDetail
              mage={picked}
              label={label}
              tree={tree}
              plan={planFor(plans, picked.factionId, picked.unitId)}
              saveError={saveError}
              onSaveNote={(comment) => onSaveNote(picked.factionId, picked.unitId, comment)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/** The mage list, grouped by faction with a sticky heading each. Hook-free, so a test can walk it. */
export function StudyPlannerList({
  groups,
  picked,
  onPick,
  onMove,
  listRef
}: {
  groups: readonly PlannerGroup[];
  picked: PlannerMage;
  onPick: (key: string) => void;
  /** Answers the arrow keys; true when it took the key. */
  onMove: (key: string) => boolean;
  listRef?: React.RefObject<HTMLUListElement | null>;
}) {
  return (
    <ul
      ref={listRef}
      data-testid="study-planner-list"
      role="listbox"
      aria-label="Mages"
      tabIndex={0}
      aria-activedescendant={`study-planner-option-${picked.key}`}
      onKeyDown={(event) => {
        if (onMove(event.key)) {
          event.preventDefault();
        }
      }}
      className="min-h-0 overflow-y-auto border-r border-edge outline-none"
    >
      {groups.map((group) => (
        <li key={group.factionId} role="presentation">
          <p
            data-testid={`study-planner-group-${group.factionId}`}
            className="sticky top-0 bg-panel-raised px-2 py-0.5 text-brass"
          >
            {group.heading}
          </p>
          <ul role="presentation">
            {group.mages.map((mage) => (
              <li
                key={mage.key}
                // Keyed on `mage.key`, not on the unit number: a report and an allied sheet can
                // carry the same one, and `aria-activedescendant` and the scroll below would then
                // both address the wrong row.
                id={`study-planner-option-${mage.key}`}
                role="option"
                data-testid={`study-planner-mage-${mage.key}`}
                aria-selected={mage.key === picked.key}
                onClick={() => onPick(mage.key)}
                // The stale tint is applied to unselected rows only: appended unconditionally it
                // would give every row of a stale group the selected row's background, and the
                // selection would come down to the ink alone.
                className={`cursor-pointer border-l-2 px-2 py-0.5 ${
                  mage.key === picked.key
                    ? "border-select bg-panel text-ink"
                    : `border-transparent text-ink-soft hover:text-ink ${
                        group.stale ? "bg-panel" : ""
                      }`
                }`}
              >
                <span>
                  {mage.name} ({mage.unitId})
                </span>
                <span className="block text-ink-dim">{mage.summary}</span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

/** One mage read out: where he is, what he knows, what he may begin, and what holds him back. */
export function StudyPlannerDetail({
  mage,
  label,
  tree,
  plan,
  saveError,
  onSaveNote
}: {
  mage: PlannerMage;
  label: (regionId: string) => string;
  tree: MagicTree;
  /** This mage's stored plan, or null when he has none. */
  plan: StudyPlanRecord | null;
  saveError: string | null;
  onSaveNote: (comment: string) => void;
}) {
  const unreported = unreportedLine(mage);
  const heldBack = mage.knows.filter((skill) => skill.standing.kind === "ceiling");
  const missing = mage.standing.missing;
  return (
    <div data-testid="study-planner-detail" className="min-h-0 overflow-y-auto p-3">
      <p className="text-ink">
        {mage.name} ({mage.unitId})
      </p>
      <p className="text-ink-dim">
        {`${mage.factionLabel} · ${label(mage.regionId)}`}
        {mage.sheetTurn === null ? " · from this turn's report" : ""}
      </p>
      {unreported === null ? null : (
        <p
          data-testid="study-planner-unreported"
          className="my-2 border-l-2 border-warn pl-2 text-warn"
        >
          {unreported}
        </p>
      )}

      {/* Read-only: the plan is written in the Schedule view, and two editors for one thing was
          the alternative the navigator rejected. */}
      <p data-testid="study-planner-plan-line" className="mt-2 text-ink-dim">
        {goalQueueText(plan?.goals ?? [], tree) ?? "nothing planned"}
      </p>

      <StudyPlannerNote
        key={mage.key}
        comment={plan?.comment ?? ""}
        saveError={saveError}
        onSave={onSaveNote}
      />

      <p className="mt-3 text-ink-soft">Knows</p>
      <ul>
        {mage.knows.map((skill) => (
          <li key={skill.tag} data-testid={`study-planner-knows-${skill.tag}`} className="text-ink">
            <span
              className={`rounded border px-1 text-pane-xs ${STANDING_CHIP[skill.standing.kind]}`}
            >
              {skill.projected === null
                ? `${skill.name} ${skill.level}`
                : `${skill.name} ${skill.level} → up to ${skill.projected}`}
            </span>{" "}
            <span className="text-ink-dim">{standingWords(skill.standing)}</span>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-ink-soft" data-testid="study-planner-can-study-heading">
        Can study now — {mage.canStudy.length}
      </p>
      <ul>
        {mage.canStudy.map((node) => (
          <li key={node.tag} data-testid={`study-planner-open-${node.tag}`}>
            <span className={`rounded border px-1 text-pane-xs ${STANDING_CHIP.open}`}>
              {node.name}
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-ink-soft">Held back</p>
      {heldBack.length === 0 ? (
        <p className="text-ink-dim">Nothing he holds is at a prerequisite&apos;s ceiling.</p>
      ) : (
        <ul>
          {heldBack.map((skill) => (
            <li key={skill.tag} className="text-ink">
              {`${skill.name} — ${standingWords(skill.standing)}`}
            </li>
          ))}
        </ul>
      )}

      {missing.length === 0 ? null : (
        <p className="mt-3 text-ink-dim" data-testid="study-planner-missing">
          {missing.length === 1
            ? "Also knows 1 skill this ruleset does not describe."
            : `Also knows ${missing.length} skills this ruleset does not describe.`}
        </p>
      )}
    </div>
  );
}

/**
 * The per-mage note, built like `RegionNotes`' editor and committed the same way - a `Save`
 * button, `⌘↩`, `Esc` to abandon. That is the only habit this application has for stored free
 * text, and a planner that saved as you type would be the first.
 *
 * Keyed on the mage in its parent, so switching mages starts a fresh draft rather than carrying
 * one across - `renderToStaticMarkup` runs no effects, so a `useEffect` reset would be untestable
 * here anyway.
 */
function StudyPlannerNote({
  comment,
  saveError,
  onSave
}: {
  comment: string;
  saveError: string | null;
  onSave: (comment: string) => void;
}) {
  const [draft, setDraft] = useState(comment);
  const mac = isMacPlatform();
  const save = () => onSave(normalizeStudyNote(draft));

  return (
    <div data-testid="study-planner-note" className="mt-3">
      <p className="m-0 text-ink-soft">Note</p>
      <textarea
        rows={3}
        maxLength={STUDY_NOTE_MAX_CHARS}
        value={draft}
        placeholder="Where his studies are heading."
        className="w-full rounded border border-edge bg-surface p-1.5 text-pane"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          const action = noteKeyToAction({
            key: event.key,
            metaKey: event.metaKey,
            ctrlKey: event.ctrlKey
          });
          if (action === "save") {
            event.preventDefault();
            save();
          } else if (action === "cancel") {
            event.stopPropagation();
            setDraft(comment);
          }
        }}
      />
      <div className="mt-1 flex items-center gap-2">
        <span
          data-testid="study-planner-note-count"
          className={[...draft].length > 400 ? "text-warn" : "text-ink-dim"}
        >
          {noteCountText(draft)}
        </span>
        <span className="flex-1" />
        <button type="button" data-testid="study-planner-note-save" onClick={save}>
          Save
        </button>
      </div>
      <p className="m-0 text-pane-sm text-ink-dim">
        {mac ? "⌘↩ saves · Esc cancels" : "Ctrl+↩ saves · Esc cancels"}
      </p>
      {saveError === null ? null : (
        <p data-testid="study-planner-note-error" className="m-0 text-warn">
          {saveError}
        </p>
      )}
    </div>
  );
}
