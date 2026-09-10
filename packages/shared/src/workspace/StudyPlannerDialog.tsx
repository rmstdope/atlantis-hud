import { useEffect, useMemo, useRef, useState } from "react";
import { paletteKeyReduce, PALETTE_PAGE_ROWS } from "../commandPalette";
import {
  knownChip,
  openingPlannerMage,
  plannerAlliedNotice,
  unreportedLine,
  type PlannerAlliedStatus,
  type PlannerGroup,
  type PlannerMage
} from "../studyPlanner";
import { useEscapeToDismiss } from "./dismissLayer";
import { STANDING_CHIP, standingLimit, standingWords } from "./standingChip";
import type { StudyGoal, StudyPlanRecord } from "@atlantis/core-client";
import type { MagicTree } from "../magicTree";
import { planLine, scheduleRows, scheduleTurns } from "../studySchedule";
import { plannerNotices } from "../studyTeaching";
import { studyOrders } from "../studyOrders";
import { studyWritePlan } from "../studyOrdersWrite";
import type { StandingAfterOrders } from "../studyStanding";
import { mageShelters, type ShelterSeats } from "../studyShelter";
import { planFor, plannedGoals } from "../studyPlans";
import { STUDY_NOTE_MAX_CHARS, noteCountText } from "../studyNote";
import { createNoteAutosave, type NoteAutosave } from "./studyNoteAutosave";
import { StudySchedule } from "./StudySchedule";
import { StudyPlannerOrders } from "./StudyPlannerOrders";
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
  seats,
  structureNames,
  after,
  tree,
  plans,
  viewedTurn,
  saveError,
  onSavePlan,
  onSaveText,
  ordersError,
  ordersDocument,
  regionBanner,
  onWriteOrdersDocument,
  onSaveNote,
  onDismiss
}: {
  groups: readonly PlannerGroup[];
  /** `plannerSummaryLine(groups, apprentices)`; null hides the sub-line. */
  summaryLine: string | null;
  emptyCopy: { headline: string; detail: string };
  /** The allied-mage store's status, for the loading and error lines. */
  alliedStatus: PlannerAlliedStatus;
  /** The workspace's selected unit, so the pane opens on him when he is a mage. */
  selectedUnitId: string | null;
  /** How a region id reads to a player. `AppShell`'s `hexLabel`. */
  label: (regionId: string) => string;
  /** `shelterSeats(...)` - every structure the report shows and the mages it seats. */
  seats: ShelterSeats;
  /** `shelterNames(...)` - what each of those structures is called, for a notice about one. */
  structureNames: ReadonlyMap<string, string>;
  /**
   * Where each own mage stands once this month's orders have run - `standingAfterOrders(...)`,
   * built in `AppShell` because it is the only place the preview and the report are both in hand.
   */
  after: ReadonlyMap<string, StandingAfterOrders>;
  /** The magic tree, for the Schedule's projection and its menus. */
  tree: MagicTree;
  /** Every stored plan of this game, from `useStudyPlansStore`. */
  plans: readonly StudyPlanRecord[];
  /** `report.header.turnNumber`, or null. Decides which turns the Schedule draws. */
  viewedTurn: number | null;
  /** `Could not save this plan.`, or null. Reported here rather than in the header status line,
   * which this dialog covers - the same choice `RegionNotes` made. */
  saveError: string | null;
  /** Turns a section's Save… into a file, through the shell's own `TextFileSaver`. */
  onSaveText: (fileName: string, text: string) => void;
  /** `Could not save these orders.`, or null. Drawn in the Orders tab, beside the Schedule's own. */
  ordersError: string | null;
  /** The orders document as it stands, so the Orders tab can say what writing into it would change. */
  ordersDocument: string;
  /** The `;***` banner a new block for a mage in this region goes under, or null. */
  regionBanner: (regionId: string) => string | null;
  /** Replaces the whole document, as an external write. `AppShell`'s `writeStudyOrdersDocument`. */
  onWriteOrdersDocument: (next: string) => void;
  /** The edit, not the result: it is applied against the stored row when the write runs. */
  onSavePlan: (
    factionId: string,
    unitId: string,
    edit: (current: readonly StudyGoal[]) => StudyGoal[]
  ) => void;
  onSaveNote: (factionId: string, unitId: string, comment: string) => void;
  onDismiss: () => void;
}) {
  useEscapeToDismiss(onDismiss);

  // Remembered no longer than the dialog, exactly as the picked mage is and for the reason
  // ah-lyg6.2.2 gave: a pane that opens differently depending on what you did last time is the
  // less predictable of the two.
  const [view, setView] = useState<"all" | "schedule" | "orders">("all");
  const [cellMode, setCellMode] = useState<CellMode>({ kind: "idle" });
  const turns = useMemo(() => scheduleTurns(viewedTurn), [viewedTurn]);
  // Memoized beside `turns` and `flat`: without it every keystroke in the popover - each skill
  // click, each level change - re-projects every mage over six turns.
  const factionLabels = useMemo(
    () => new Map(groups.map((group) => [group.factionId, group.factionLabel] as const)),
    [groups]
  );
  const rows = useMemo(
    () => scheduleRows({ groups, plans, tree, turns, seats, after }),
    [groups, plans, tree, turns, seats, after]
  );
  const shelters = useMemo(
    () => mageShelters({ groups, seats, names: structureNames, after }),
    [groups, seats, structureNames, after]
  );
  const notices = useMemo(
    () => plannerNotices({ rows, turns, label, factionLabels, shelters }),
    [rows, turns, label, factionLabels, shelters]
  );

  // Memoised beside `rows` and for the same reason: without it every keystroke in a cell popover
  // rebuilds every faction's text.
  const orders = useMemo(
    () => studyOrders({ groups, rows, turns, notices }),
    [groups, rows, turns, notices]
  );

  /**
   * The last write of this visit, or the fact that it was undone. Dies with the dialog, exactly as
   * `view` does - and so, deliberately, does the one undo this bead offers (`ah-lyg6.4.2`, U1).
   */
  type WriteNotice =
    | { kind: "wrote"; text: string; before: string; after: string }
    | { kind: "undone" };
  const [writeNotice, setWriteNotice] = useState<WriteNotice | null>(null);
  const [asking, setAsking] = useState(false);

  const ownEntries = useMemo(
    () => orders.sections.find((section) => section.source === "own")?.entries ?? [],
    [orders]
  );
  const writePlan = useMemo(
    () =>
      ownEntries.some((entry) => entry.order !== null)
        ? studyWritePlan({
            document: ordersDocument,
            entries: ownEntries,
            banner: regionBanner,
            label
          })
        : null,
    [ownEntries, ordersDocument, regionBanner, label]
  );

  // Never re-entered mid-question, and a stale Undo is never offered against a document that has
  // moved on while the player was on another tab.
  useEffect(() => {
    if (view !== "orders") {
      setAsking(false);
      setWriteNotice(null);
    }
  }, [view]);

  const flat = useMemo(() => groups.flatMap((group) => group.mages), [groups]);
  // Derived from `groups` rather than passed in: `groups` is already a prop, and a second source
  // for the same names could disagree with it.
  const names = useMemo(
    () => new Map(flat.map((mage) => [mage.unitId, mage.name] as const)),
    [flat]
  );
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

  // The Orders tab counts its own mages; every other tab keeps the planner's summary line.
  const subLine = (view === "orders" ? orders.summary : null) ?? summaryLine;

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
        //
        // 74rem rather than the 56 this was (navigator, 2026-09-07): the Schedule's mage pane takes
        // 20rem beside six turn columns, and All mages spends the same width on standing its three
        // lists side by side. One width for all three views, so the dialog does not resize under
        // the pointer as the tabs are walked.
        className="grid max-h-[80vh] w-[74rem] max-w-[94vw] grid-rows-[auto_auto_1fr] rounded border border-edge bg-panel-raised text-pane whitespace-normal shadow-lg"
      >
        <div className="flex items-center gap-2 border-b border-edge px-2 py-1.5">
          <span className="text-ink-soft">Study planner</span>
          <span role="tablist" aria-label="Study planner view" className="flex gap-1">
            <ViewTab view="all" label="Overview" open={view} onOpen={setView} />
            <ViewTab view="schedule" label="Planner" open={view} onOpen={setView} />
            <ViewTab view="orders" label="Orders" open={view} onOpen={setView} />
          </span>
          <span className="flex-1" />
          {view === "orders" && orders.sections.length > 0 ? (
            <button
              type="button"
              data-testid="study-planner-save-all"
              onClick={() => onSaveText(orders.allFileName, orders.allText)}
              className="rounded px-1.5 text-ink-dim hover:text-ink"
            >
              Save all…
            </button>
          ) : null}
          <button
            type="button"
            data-testid="study-planner-close"
            aria-label="Close study planner"
            title="Close study planner"
            onClick={onDismiss}
            className="rounded px-1.5 text-ink-dim hover:text-ink"
          >
            ×
          </button>
        </div>

        {/*
          An empty div rather than null: the box is `grid-rows-[auto_auto_1fr]`, so dropping this
          child would leave the body in the second, `auto` track instead of the `1fr` one, and the
          two columns would stop filling the box and stop scrolling inside it.
        */}
        {subLine === null && notice === null ? (
          <div />
        ) : (
        <div className="border-b border-edge px-2 py-1 text-ink-dim">
          {subLine === null ? null : (
            <span data-testid="study-planner-summary">{subLine}</span>
          )}
          {notice === null ? null : (
            <span
              data-testid="study-planner-allied-notice"
              className={subLine === null ? "text-warn" : "ml-2 text-warn"}
            >
              {notice}
            </span>
          )}
        </div>
        )}

        {view === "orders" ? (
          <StudyPlannerOrders
            orders={orders}
            emptyCopy={
              turns.length === 0
                ? {
                    headline: "Load a report and next turn's orders appear here.",
                    detail: ""
                  }
                : {
                    headline: `No mage has a plan for turn ${turns[0]}.`,
                    detail:
                      "Give a mage a study or a teach on the Schedule and his orders appear here."
                  }
            }
            error={ordersError}
            onSaveText={onSaveText}
            writePlan={writePlan}
            asking={asking}
            notice={
              writeNotice === null
                ? null
                : writeNotice.kind === "undone"
                  ? { text: "Put your orders back as they were.", undoable: false }
                  : {
                      text: writeNotice.text,
                      // U1: the Undo stands only while the document is byte for byte what the
                      // write left it. A keystroke, an import or a restore ends it.
                      undoable: ordersDocument === writeNotice.after
                    }
            }
            onAskWrite={() => setAsking(true)}
            onCancelWrite={() => setAsking(false)}
            onConfirmWrite={() => {
              if (writePlan === null) {
                return;
              }
              const before = ordersDocument;
              onWriteOrdersDocument(writePlan.next);
              setWriteNotice({
                kind: "wrote",
                text: writePlan.resultText,
                before,
                after: writePlan.next
              });
              setAsking(false);
            }}
            onUndoWrite={() => {
              if (writeNotice === null || writeNotice.kind !== "wrote") {
                return;
              }
              onWriteOrdersDocument(writeNotice.before);
              setWriteNotice({ kind: "undone" });
            }}
          />
        ) : view === "schedule" ? (
          <StudySchedule
            rows={rows}
            groups={groups}
            turns={turns}
            tree={tree}
            mode={cellMode}
            onEvent={(event) => setCellMode((mode) => reduceCell(mode, event))}
            onCommit={(rowKey, edit) => {
              const [factionId, unitId] = rowKey.split("/");
              onSavePlan(factionId, unitId, edit);
            }}
            saveError={saveError}
            notices={notices}
            label={label}
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
              turn={turns[0] ?? null}
              label={label}
              names={names}
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
/**
 * One of the planner's three views, as a chip that shows it can be pressed and whether it is open.
 *
 * The three were plain text on the top bar (navigator, 2026-09-07): nothing said they were
 * buttons, and nothing said which view was showing. Bordered, brass when open, is what
 * `SettingsDialog` and `ChangesDialog` already dress a dialog's tabs in, so this is the third
 * place that habit is kept rather than a fourth look. Hovering brightens rather than turning brass,
 * unlike those two: with a brass edge under the pointer as well as on the open tab, the two read
 * alike at a glance, and telling them apart is the whole of what this is for.
 *
 * No roving `tabIndex`, unlike those two: a tablist that takes one Tab stop needs the arrow keys
 * to reach the rest, and neither of them handles those - so three ordinary Tab stops is what
 * actually reaches all three views from a keyboard here.
 */
function ViewTab({
  view,
  label,
  open,
  onOpen
}: {
  view: "all" | "schedule" | "orders";
  label: string;
  /** Which view is showing. */
  open: "all" | "schedule" | "orders";
  onOpen: (view: "all" | "schedule" | "orders") => void;
}) {
  const selected = view === open;
  return (
    <button
      type="button"
      role="tab"
      data-testid={`study-planner-view-${view}`}
      aria-selected={selected}
      onClick={() => onOpen(view)}
      className={`rounded border px-2 py-0.5 ${
        selected
          ? "border-brass bg-panel text-brass"
          : "border-edge bg-panel-raised text-ink-soft hover:bg-panel hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}

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
                    ? "border-select bg-select/15 text-ink"
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
  turn,
  label,
  names = new Map(),
  tree,
  plan,
  saveError,
  onSaveNote
}: {
  mage: PlannerMage;
  /** The turn the plan line names - `turns[0]`, the next one; null before a report is loaded. */
  turn: number | null;
  label: (regionId: string) => string;
  /** Unit id to mage name, so a teach goal in the plan line reads as a name. */
  names?: ReadonlyMap<string, string>;
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
        {turn === null ? "Nothing planned." : planLine(plannedGoals(plan?.goals ?? []), turn, tree, names)}
      </p>

      <StudyPlannerNote
        key={mage.key}
        comment={plan?.comment ?? ""}
        saveError={saveError}
        onSave={onSaveNote}
      />

      {/* Three columns rather than three stacked lists (navigator, 2026-09-07): they answer one
          question between them - where this mage stands - and a reader who has to scroll from one
          to the next is holding two of the three answers in their head. The dialog is 74rem for
          the Schedule's pane anyway, so the width was already paid for. */}
      <div className="mt-3 grid grid-cols-3 gap-3">
        <section>
          <p className="m-0 text-ink-soft">Knows</p>
          <ul className="m-0 list-none p-0">
            {mage.knows.map((skill) => (
              <li
                key={skill.tag}
                data-testid={`study-planner-knows-${skill.tag}`}
                className="text-ink"
              >
                <span
                  className={`rounded border px-1 text-pane-xs ${STANDING_CHIP[skill.standing.kind]}`}
                >
                  {knownChip(skill)}
                </span>{" "}
                {/* Not `standingWords`: the chip beside it has just said `force 4`, and `at 4`
                    after it is the same number twice. The `Held back` list keeps the full wording,
                    having no chip of its own. */}
                <span className="text-ink-dim">{standingLimit(skill.standing)}</span>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <p className="m-0 text-ink-soft" data-testid="study-planner-can-study-heading">
            Can study now — {mage.canStudy.length}
          </p>
          <ul className="m-0 list-none p-0">
            {mage.canStudy.map((node) => (
              <li key={node.tag} data-testid={`study-planner-open-${node.tag}`}>
                <span className={`rounded border px-1 text-pane-xs ${STANDING_CHIP.open}`}>
                  {node.name}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <p className="m-0 text-ink-soft">Held back</p>
          {heldBack.length === 0 ? (
            <p className="m-0 text-ink-dim">Nothing he holds is at a prerequisite&apos;s ceiling.</p>
          ) : (
            <ul className="m-0 list-none p-0">
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
        </section>
      </div>
    </div>
  );
}

/**
 * The per-mage note. It saves as it is typed (ah-xbu3): no Save button, no shortcut, and nothing
 * on screen about storage unless a write fails. Everything else in this window already commits
 * itself - the Schedule writes a chosen month straight through - and this was the one field that
 * could be lost by doing what the rest of the screen taught.
 *
 * `hexNotes`' editor keeps its `Save` and `Cancel` on purpose (navigator, 2026-09-07): a hex note
 * is added to and removed from a list, so its editor is a form that opens and closes, while this
 * is one field always on screen.
 *
 * Keyed on the mage in its parent, so switching mages unmounts this and remounts it - which is
 * what makes the unmount flush the last write, and why the autosave is held in a ref rather than
 * in module scope.
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
  // `onSave` is a fresh closure on every render, so the autosave reaches it through a ref that is
  // reassigned each time - the same pattern `dismissLayer.ts` uses. A closure captured once at
  // construction would write through a stale one.
  const latestSave = useRef(onSave);
  latestSave.current = onSave;
  const autosave = useRef<NoteAutosave | null>(null);
  autosave.current ??= createNoteAutosave((next) => latestSave.current(next), comment);

  // Storage can move under a mounted editor: the unmount flush is fire-and-forget
  // (`AppShell`'s `void saveStudyPlan`), and the store caches only once the write has landed
  // (`studyPlansStore.save`), so closing the window and reopening it at once mounts this on the
  // note as it was *before* the last write. `draft` is seeded once, so without this the field
  // would show the stale note for the rest of the mount - and typing there would overwrite the
  // note that was actually saved.
  //
  // Adjusting state while rendering, rather than in an effect: React's own answer for state
  // derived from a prop, and it avoids a frame in which the stale text is on screen.
  const seen = useRef(comment);
  if (seen.current !== comment) {
    seen.current = comment;
    // What the player is typing always wins over what storage says: their text is newer, and it
    // is owed a write of its own.
    if (autosave.current !== null && !autosave.current.owes()) {
      autosave.current.adopted(comment);
      setDraft(comment);
    }
  }

  // The editor going away is the last chance to write: switching mage remounts this component and
  // closing the window unmounts it. `saveStudyPlan` lives in `AppShell`, which is not unmounting,
  // so the write started here completes.
  useEffect(() => {
    const writer = autosave.current;
    return () => writer?.flush();
  }, []);

  return (
    <div data-testid="study-planner-note" className="mt-3">
      <p className="m-0 text-ink-soft">Note</p>
      <textarea
        rows={3}
        maxLength={STUDY_NOTE_MAX_CHARS}
        value={draft}
        placeholder="Where his studies are heading."
        className="w-full rounded border border-edge bg-surface p-1.5 text-pane"
        onChange={(event) => {
          setDraft(event.target.value);
          autosave.current?.typed(event.target.value);
        }}
      />
      <span
        data-testid="study-planner-note-count"
        className={["mt-1 block", [...draft].length > 400 ? "text-warn" : "text-ink-dim"].join(" ")}
      >
        {noteCountText(draft)}
      </span>
      {saveError === null ? null : (
        <p data-testid="study-planner-note-error" className="m-0 text-warn">
          {saveError}
        </p>
      )}
    </div>
  );
}
