import type { OrderDiagnostic, ReportUnit } from "@atlantis/core-client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { HexNode } from "../hexMapModel";
import type { OrderProcessing } from "../orderProcessing";
import { readableTime, type SaveState } from "../orderDraft";
import {
  offendingText,
  summarizeOrderValidation,
  type ValidatedOrders
} from "../orderEditor";
import { SeverityMark } from "./primitives";
import type { CaretLookup } from "../orderCompletion";
import type { OrderSnippet } from "../orderSnippets";
import { describeLock, lockFor, type FormedSelection, type Lock } from "./ordersLock";
import { useSettingsStore } from "../settingsStore";
import type { Ref } from "react";
import { CollapsiblePanel } from "./CollapsiblePanel";
import { OrdersEditor, type OrdersEditorHandle } from "./OrdersEditor";
import { revealRow, rowsBelow, walkedKey, walkedRowIndex } from "./problemListScroll";

type OrdersPanelProps = {
  unit: ReportUnit | null;
  /**
   * The selected unit's id, `new-1` included.
   *
   * Not read off `unit`: a unit this month's `FORM` orders create is selectable before - and
   * briefly after - the debounced forecast has a row for it.
   */
  unitId: string | null;
  /** The selection as a formed unit, when it is one (`ordersLock.formedSelectionFor`). */
  formed: FormedSelection | null;
  /** Every unit the report shows in the hex on screen, which is what scopes a `NEW n` alias. */
  regionUnitIds: ReadonlySet<string>;
  hex: HexNode | null;
  /** The whole faction document, of which this panel edits one unit's slice. */
  document: string;
  /** Moves when the document was written by something other than the editor — see `OrdersOrigin`; the editor reloads its block on it and on nothing else. */
  externalRevision: number;
  ownFactionName: string;
  onChange: (unitId: string, orders: string) => void;
  /**
   * Everything wrong with the faction's orders, and the text that was found wrong.
   *
   * Which of it is this unit's is worked out here, by line number - so it has to be worked out
   * against the document those line numbers were counted in, which validation being debounced means
   * is not always the one on screen.
   */
  validated: ValidatedOrders;
  save: SaveState;
  /** The core's order vocabulary, for the editor's completion popup. */
  commands: readonly string[];
  /** Every word the rules know, uppercase, for the Order OCD setting. */
  orderVocabulary: readonly string[];
  /** The player's snippet library, offered in the same popup. */
  snippets: readonly OrderSnippet[];
  /** What may stand at an argument position, asked of the core once per half-typed word. */
  caretCompletions: CaretLookup;
  /** The shell's line to the editor, for the shortcut layer's jumps and insertions. */
  editorRef?: Ref<OrdersEditorHandle>;
  /**
   * Step to the next or previous problem in the whole turn - the same walk F8 and Shift-F8 make.
   *
   * The shell's own `walkProblems`, passed down rather than reimplemented: one engine with two ways
   * in, so the mouse and the keyboard cannot keep two positions that drift apart.
   */
  onWalkProblems?: (direction: 1 | -1) => void;

  /**
   * Where the walk stands, one-based, or null when it is not standing on a problem at all.
   *
   * The walk wraps, so there is no end to bump into and no other way to know you have seen
   * everything (ah-9ess).
   */
  walkPosition?: { at: number; of: number } | null;

  /**
   * The problem the walk stands on, when it is one of this unit's - re-based to this unit's block
   * like every problem the panel lists - so the list can scroll to its row (ah-nup4). Null when the
   * walk stands nowhere, or on another unit's problem.
   */
  walkedProblem?: OrderDiagnostic | null;

  /** The open game's order-processing context. */
  orders: OrderProcessing;

  /** Goes to another hex and opens its Problems; see `OrdersEditor`'s prop (`ah-zjcj`). */
  onShowProblemsIn?: (regionId: string) => void;
};

export function OrdersPanel({
  unit,
  unitId,
  formed,
  regionUnitIds,
  hex,
  document,
  externalRevision,
  ownFactionName,
  onChange,
  validated,
  save,
  commands,
  orderVocabulary,
  snippets,
  caretCompletions,
  editorRef,
  onWalkProblems,
  walkPosition,
  walkedProblem,
  orders,
  onShowProblemsIn
}: OrdersPanelProps) {
  // Read here rather than in the editor: the panel re-renders on a settings change, which is what
  // keeps the editor's `latest` ref current without rebuilding the view.
  const orderOcd = useSettingsStore((state) => state.orderOcd);
  const block =
    unitId === null
      ? null
      : orders.readUnitOrders(document, unitId, regionUnitIds);
  const lock = lockFor(unit, hex, formed);

  // This unit's problems, and how many the rest of the faction has. The document-wide figure is
  // what stops a mistake in a unit nobody is looking at from reaching the server unnoticed. Not
  // worked out at all behind a lock: there is no editor under it to report anything about, and
  // finding a block means walking the whole document.
  // Memoised so the editor's diagnostics effect sees the same array until validation actually
  // moves - a fresh array every keystroke meant a needless editor transaction every keystroke.
  const locked = lock !== null;
  const problems = useMemo(
    () =>
      locked || unitId === null
        ? []
        : orders.diagnosticsForUnit(
            validated.text,
            unitId,
            validated.diagnostics,
            regionUnitIds
          ),
    [locked, unitId, validated, regionUnitIds, orders]
  );
  // The text those line and column numbers were counted in, which validation being debounced means
  // is not always the draft on screen. Quoting a token out of the draft instead would occasionally
  // quote whatever now sits at those columns.
  const validatedBlock =
    unitId === null
      ? ""
      : (orders.readUnitOrders(validated.text, unitId, regionUnitIds) ?? "");
  const here = summarizeOrderValidation({ diagnostics: problems });
  // What the rest of the faction has wrong, counted apart from this unit's own. A whole-document
  // total sitting beside a per-unit count reads as though the two should be added together.
  const elsewhere = summarizeOrderValidation(validated).errorCount - here.errorCount;

  return (
    <CollapsiblePanel
      panel="orders"
      title="Orders"
      hint={
        formed
          ? `— new ${formed.alias}${
              formed.formedBy === null ? "" : `, in unit ${formed.formedBy}'s block`
            }`
          : unitId
            ? `— unit ${unitId}`
            : undefined
      }
      className="min-h-0"
      actions={<WalkProblems onWalk={onWalkProblems} position={walkPosition ?? null} />}
    >
      {lock ? (
        <LockNotice lock={lock} ownFaction={ownFactionName} />
      ) : (
        <div className="flex h-full min-h-0 flex-col">
          <OrdersEditor
            ref={editorRef}
            unitId={unitId ?? ""}
            text={block ?? ""}
            externalRevision={externalRevision}
            savedAt={save.kind === "saved" ? save.at : null}
            ariaLabel={
              formed ? `Orders for new ${formed.alias}` : `Orders for unit ${unitId ?? ""}`
            }
            problems={problems}
            commands={commands}
            orderVocabulary={orderVocabulary}
            orders={orders}
            orderOcd={orderOcd}
            snippets={snippets}
            caretCompletions={caretCompletions}
            onShowProblemsIn={onShowProblemsIn}
            onChange={(text) => {
              if (unitId !== null) {
                onChange(unitId, text);
              }
            }}
          />
          <p
            data-testid="orders-status"
            className="m-0 flex flex-none items-center gap-3 border-t border-edge pt-1.5 text-pane-sm text-ink-soft"
          >
            <span className={here.errorCount > 0 ? "text-danger" : "text-ok"}>
              {here.errorCount} error{here.errorCount === 1 ? "" : "s"}
            </span>
            <span className={here.warningCount > 0 ? "text-warn" : "text-ok"}>
              {here.warningCount} warning{here.warningCount === 1 ? "" : "s"}
            </span>
            {elsewhere > 0 ? (
              <span className="text-ink-dim">{elsewhere} elsewhere</span>
            ) : null}
            <span className="flex-1" />
            <SaveNotice save={save} />
          </p>
          {problems.length > 0 ? (
            // Keyed on the unit, so another unit's list starts at the top rather than wherever
            // this one was scrolled to (ah-nup4). With its hex: two hexes can each hold a `new-1`.
            <ProblemList
              key={`${hex?.regionId ?? ""}:${unitId ?? ""}`}
              problems={problems}
              text={validatedBlock}
              walked={walkedProblem ?? null}
            />
          ) : null}
        </div>
      )}
    </CollapsiblePanel>
  );
}

/**
 * The mouse route into the turn's problems, beside the pane's title (ah-dlao).
 *
 * Never disabled and never hidden: the walk wraps, so there is no end to be at, and with no problems
 * at all the step is already a no-op - a disabled state would be a second source of truth about
 * whether there is anything to walk. The tooltips name the keys, so the mouse route teaches the
 * keyboard one.
 */
function WalkProblems({
  onWalk,
  position
}: {
  onWalk?: (direction: 1 | -1) => void;
  position: { at: number; of: number } | null;
}) {
  const style =
    "rounded px-1 text-pane-sm text-ink-dim hover:text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-brass";

  return (
    <span className="flex flex-none items-center gap-0.5">
      <button
        type="button"
        data-testid="walk-problem-prev"
        aria-label="Previous problem"
        title="Previous problem (Shift-F8)"
        onClick={() => onWalk?.(-1)}
        className={style}
      >
        ‹
      </button>
      {position ? (
        <span
          data-testid="walk-position"
          data-position={`${position.at}/${position.of}`}
          // Hidden below the sm breakpoint rather than dropped: the arrows and the unit hint keep
          // the narrow header whole, and the attribute stays readable to the smoke suite, which is
          // what makes the barrier exist at every width (ah-9ess).
          className="hidden rounded bg-brass/15 px-1 text-pane-sm text-brass sm:inline"
        >
          {position.at}/{position.of}
        </span>
      ) : null}
      <button
        type="button"
        data-testid="walk-problem-next"
        aria-label="Next problem"
        title="Next problem (F8)"
        onClick={() => onWalk?.(1)}
        className={style}
      >
        ›
      </button>
    </span>
  );
}

/**
 * The room every problem row leaves on its right for the "N more ↓" count (ah-8zbc,
 * docs/ui/ah-8zbc-count-room.html), so the count only ever sits over empty space and never over the
 * quoted token. 6em - 72px at the default 12px pane text - fits a two-digit count with its offset and
 * padding, and scales with the pane's text size. Kept whether or not the count shows, so the rows do
 * not re-wrap as it comes and goes.
 */
export const PROBLEM_ROW_COUNT_ROOM = "pr-[6em]";

/**
 * What is wrong with this unit's orders, line by line.
 *
 * Counts alone told the player a number and left them to find it. The line is the one the editor
 * above is showing, so it can be counted down to.
 *
 * The list shares the panel with the editor rather than taking what it wants (ah-nup4,
 * docs/ui/ah-nup4-orders-room.html): it is never taller than its old `max-h-20`, shrinks to as
 * little as one row when the editor needs the room for its three lines, and scrolls. While rows are
 * hidden below, "N more ↓" sits in its bottom-right corner - a sibling of the scrolling list rather
 * than a child, so it stays put while the rows move under it.
 *
 * The parser knows which token is wrong and not merely which line, so the token is quoted beside the
 * message - "line 4, swords" beats "line 4" on a line with four arguments on it. `text` is the text
 * the diagnostics were counted in rather than the draft on screen, so the quote is of what was
 * actually found wrong; a span that no longer fits goes unquoted rather than quoting the wrong thing.
 */
function ProblemList({
  problems,
  text,
  walked
}: {
  problems: OrderDiagnostic[];
  text: string;
  walked: OrderDiagnostic | null;
}) {
  const list = useRef<HTMLUListElement | null>(null);
  const [hidden, setHidden] = useState(0);
  // The one guaranteed row is the first row as it is drawn, wrapped or not; measured, since a
  // narrow rail wraps a long message onto several lines. The class below is the floor until then.
  const [floor, setFloor] = useState<number | null>(null);

  useEffect(() => {
    const element = list.current;
    if (!element) {
      return;
    }
    const measure = () => {
      const rows = Array.from(element.children) as HTMLElement[];
      setHidden(
        rowsBelow(
          rows.map((row) => row.offsetTop + row.offsetHeight),
          element.scrollTop + element.clientHeight,
          element.scrollHeight
        )
      );
      setFloor(rows[0] ? rows[0].offsetHeight : null);
    };
    measure();
    const resized = new ResizeObserver(measure);
    resized.observe(element);
    element.addEventListener("scroll", measure, { passive: true });
    return () => {
      resized.disconnect();
      element.removeEventListener("scroll", measure);
    };
  }, [problems]);

  // The walk's row into view when the walk moves to it - keyed on where it stands rather than on
  // the problem object, which a re-validation replaces, so a hand-scrolled list is left alone.
  const walkedAt = walkedKey(walked);
  useEffect(() => {
    const element = list.current;
    const index = walkedRowIndex(problems, walked);
    const row = index === null ? undefined : (element?.children[index] as HTMLElement | undefined);
    if (!element || !row) {
      return;
    }
    element.scrollTop = revealRow(
      { top: row.offsetTop, bottom: row.offsetTop + row.offsetHeight },
      { scrollTop: element.scrollTop, height: element.clientHeight }
    );
    // `problems` and `walked` are read for the walk that just happened, not watched: see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walkedAt]);

  return (
    <div
      data-testid="orders-diagnostics-room"
      className="relative flex max-h-20 min-h-[calc(1.375*var(--text-pane-sm))] shrink flex-col"
      style={floor === null ? undefined : { minHeight: `${floor}px` }}
    >
      <ul
        ref={list}
        data-testid="orders-diagnostics"
        // `relative`, so each row's offsetTop is measured from the list itself.
        className="relative m-0 min-h-0 list-none overflow-y-auto p-0 text-pane-sm leading-snug"
      >
        {problems.map((problem, index) => {
          const found = offendingText(text, problem);

          return (
            <li
              key={`${problem.code}-${problem.lineStart}-${index}`}
              data-testid="orders-diagnostic"
              data-severity={problem.severity}
              className={`flex gap-2 ${PROBLEM_ROW_COUNT_ROOM}`}
            >
              <SeverityMark severity={problem.severity} />
              {/* A finding on the unit as a whole has no line to count to, and says none (`ah-6c76`). */}
              {problem.lineStart === null ? null : (
                <span className="shrink-0 tabular-nums text-ink-dim">line {problem.lineStart}</span>
              )}
              {found === null ? null : (
                <code
                  data-testid="orders-diagnostic-token"
                  className="shrink-0 rounded bg-edge/40 px-1 font-mono text-ink-soft"
                >
                  {found}
                </code>
              )}
              <span className="text-ink">{problem.message}</span>
            </li>
          );
        })}
      </ul>
      {hidden > 0 ? (
        <span
          data-testid="orders-diagnostics-more"
          className="pointer-events-none absolute bottom-0 right-1.5 bg-pane px-1 text-pane-sm leading-snug text-ink-dim"
        >
          {hidden} more ↓
        </span>
      ) : null}
    </div>
  );
}

/**
 * What the document's last dealings with storage were.
 *
 * A failure is coloured and left standing rather than fading back to "unsaved changes": the player
 * needs to know their evening is not on disk, and needs to know why.
 */
function SaveNotice({ save }: { save: SaveState }) {
  switch (save.kind) {
    case "clean":
      return <span>not saved yet</span>;
    case "dirty":
      return <span className="text-warn">unsaved changes</span>;
    case "saving":
      return <span>saving…</span>;
    case "saved":
      return <span>saved {readableTime(save.at)}</span>;
    case "failed":
      return <span className="text-danger">could not save: {save.reason}</span>;
  }
}

function LockNotice({ lock, ownFaction }: { lock: Lock; ownFaction: string }) {
  const { badge, lines } = describeLock(lock, ownFaction);

  return (
    <div
      data-testid="orders-locked"
      data-lock={lock.kind}
      className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-ink-dim"
    >
      <span className="rounded border border-edge px-2.5 py-1 text-pane-sm uppercase tracking-[0.08em] text-ink-soft">
        {badge}
      </span>
      {lines.map((line) => (
        <span key={line}>{line}</span>
      ))}
    </div>
  );
}
