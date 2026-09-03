import type { OrderDiagnostic, ReportUnit } from "@atlantis/core-client";
import { useMemo } from "react";
import type { HexNode } from "../hexMapModel";
import { readableTime, type SaveState } from "../orderDraft";
import {
  diagnosticsForUnit,
  offendingText,
  summarizeOrderValidation,
  type ValidatedOrders
} from "../orderEditor";
import { SeverityMark } from "./primitives";
import type { CaretLookup } from "../orderCompletion";
import type { OrderSnippet } from "../orderSnippets";
import { readUnitOrders } from "../ordersDocument";
import { describeLock, lockFor, type Lock } from "./ordersLock";
import { useSettingsStore } from "../settingsStore";
import type { Ref } from "react";
import { CollapsiblePanel } from "./CollapsiblePanel";
import { OrdersEditor, type OrdersEditorHandle } from "./OrdersEditor";

type OrdersPanelProps = {
  unit: ReportUnit | null;
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
};

export function OrdersPanel({
  unit,
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
  walkPosition
}: OrdersPanelProps) {
  // Read here rather than in the editor: the panel re-renders on a settings change, which is what
  // keeps the editor's `latest` ref current without rebuilding the view.
  const orderOcd = useSettingsStore((state) => state.orderOcd);
  const unitId = unit?.unitId ?? null;
  const block = unitId === null ? null : readUnitOrders(document, unitId);
  const lock = lockFor(unit, hex);

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
        : diagnosticsForUnit(validated.text, unitId, validated.diagnostics),
    [locked, unitId, validated]
  );
  // The text those line and column numbers were counted in, which validation being debounced means
  // is not always the draft on screen. Quoting a token out of the draft instead would occasionally
  // quote whatever now sits at those columns.
  const validatedBlock =
    unitId === null ? "" : (readUnitOrders(validated.text, unitId) ?? "");
  const here = summarizeOrderValidation({ diagnostics: problems });
  // What the rest of the faction has wrong, counted apart from this unit's own. A whole-document
  // total sitting beside a per-unit count reads as though the two should be added together.
  const elsewhere = summarizeOrderValidation(validated).errorCount - here.errorCount;

  return (
    <CollapsiblePanel
      panel="orders"
      title="Orders"
      hint={unit ? `— unit ${unit.unitId}` : undefined}
      className="min-h-0"
      actions={<WalkProblems onWalk={onWalkProblems} position={walkPosition ?? null} />}
    >
      {lock ? (
        <LockNotice lock={lock} ownFaction={ownFactionName} />
      ) : (
        <div className="flex h-full min-h-0 flex-col">
          <OrdersEditor
            ref={editorRef}
            unitId={unit?.unitId ?? ""}
            text={block ?? ""}
            externalRevision={externalRevision}
            savedAt={save.kind === "saved" ? save.at : null}
            ariaLabel={`Orders for unit ${unit?.unitId ?? ""}`}
            problems={problems}
            commands={commands}
            orderVocabulary={orderVocabulary}
            orderOcd={orderOcd}
            snippets={snippets}
            caretCompletions={caretCompletions}
            onChange={(text) => {
              if (unit) {
                onChange(unit.unitId, text);
              }
            }}
          />
          <p
            data-testid="orders-status"
            className="m-0 flex items-center gap-3 border-t border-edge pt-1.5 text-pane-sm text-ink-soft"
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
          {problems.length > 0 ? <ProblemList problems={problems} text={validatedBlock} /> : null}
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
 * What is wrong with this unit's orders, line by line.
 *
 * Counts alone told the player a number and left them to find it. The line is the one the editor
 * above is showing, so it can be counted down to; scrolled rather than allowed to grow, because the
 * panel's height is fixed and the editor is what the space is for.
 *
 * The parser knows which token is wrong and not merely which line, so the token is quoted beside the
 * message - "line 4, swords" beats "line 4" on a line with four arguments on it. `text` is the text
 * the diagnostics were counted in rather than the draft on screen, so the quote is of what was
 * actually found wrong; a span that no longer fits goes unquoted rather than quoting the wrong thing.
 */
function ProblemList({ problems, text }: { problems: OrderDiagnostic[]; text: string }) {
  return (
    <ul
      data-testid="orders-diagnostics"
      className="m-0 max-h-20 list-none overflow-y-auto p-0 pt-1 text-pane-sm leading-snug"
    >
      {problems.map((problem, index) => {
        const found = offendingText(text, problem);

        return (
          <li
            key={`${problem.code}-${problem.lineStart}-${index}`}
            data-testid="orders-diagnostic"
            data-severity={problem.severity}
            className="flex gap-2"
          >
            <SeverityMark severity={problem.severity} />
            <span className="shrink-0 tabular-nums text-ink-dim">line {problem.lineStart}</span>
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
