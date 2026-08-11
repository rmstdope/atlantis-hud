import type { OrderDiagnostic, ReportUnit } from "@atlantis/core-client";
import { useEffect, useMemo, useState } from "react";
import type { HexNode } from "../hexMapModel";
import { readableTime, type SaveState } from "../orderDraft";
import {
  diagnosticsForUnit,
  draftAfterDocumentChange,
  draftAfterSave,
  offendingText,
  summarizeOrderValidation,
  type ValidatedOrders
} from "../orderEditor";
import type { OrderSnippet } from "../orderSnippets";
import { readUnitOrders } from "../ordersDocument";
import { CollapsiblePanel } from "./CollapsiblePanel";
import { OrdersEditor } from "./OrdersEditor";

/** Why the editor is refusing an edit. Each reason needs its own wording to be any use. */
type Lock =
  | { kind: "no-unit" }
  | { kind: "foreign"; factionName: string; factionId: string | null }
  | { kind: "not-in-turn"; lastSeenTurn: number | null }
  | { kind: "no-block" };

type OrdersPanelProps = {
  unit: ReportUnit | null;
  hex: HexNode | null;
  /** The whole faction document, of which this panel edits one unit's slice. */
  document: string;
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
  /** The player's snippet library, offered in the same popup. */
  snippets: readonly OrderSnippet[];
};

function lockFor(unit: ReportUnit | null, hex: HexNode | null, block: string | null): Lock | null {
  if (!unit) {
    return { kind: "no-unit" };
  }
  if (!unit.own) {
    return {
      kind: "foreign",
      factionName: unit.factionName ?? "another faction",
      factionId: unit.factionId
    };
  }
  // A unit carried over from an earlier turn cannot be ordered: you cannot command what you cannot
  // presently see, and the server would reject orders for it.
  if (hex?.knowledge === "stale") {
    return { kind: "not-in-turn", lastSeenTurn: hex.lastSeenTurn };
  }
  if (block === null) {
    return { kind: "no-block" };
  }
  return null;
}

export function OrdersPanel({
  unit,
  hex,
  document,
  ownFactionName,
  onChange,
  validated,
  save,
  commands,
  snippets
}: OrdersPanelProps) {
  const unitId = unit?.unitId ?? null;
  const block = unitId === null ? null : readUnitOrders(document, unitId);
  const lock = lockFor(unit, hex, block);
  const [draft, setDraft] = useState(block ?? "");
  const [draftUnit, setDraftUnit] = useState(unitId);

  // A different unit means a different draft *now*, in this very render - not an effect later.
  // Waiting for the effect below handed the editor the old unit's text for one commit, which
  // painted one unit's orders under another's name for a frame and made the editor mount with a
  // document it then had to be corrected out of.
  if (draftUnit !== unitId) {
    setDraftUnit(unitId);
    setDraft(block ?? "");
  }

  // Reload when this unit's own lines change, rather than on every edit anywhere in the
  // document: never reloading would show stale text, and reloading constantly would fight the
  // player's typing. `draftAfterDocumentChange` settles the case the two rules disagree about -
  // the text coming back from a document that cannot hold the blank line just typed at the end
  // of it.
  useEffect(() => {
    setDraft((current) => draftAfterDocumentChange(current, block ?? ""));
  }, [unitId, block]);

  // While the document stands saved, end the draft with the newline an orders file ends with -
  // which tidies a draft the moment its save lands, and a saved draft the moment it is browsed
  // to. Never while the document is dirty, so the tidying cannot land mid-sentence; and without
  // touching the document, which cannot hold a trailing blank line and so already stores the same
  // bytes either way. A functional update, deliberately: the reload above queues one too, and a
  // plain value computed from this render's draft would overwrite it with a stale unit's text.
  // The caret needs no bookkeeping here any more: the editor receives this as a minimal splice at
  // the end of the text and maps the selection through it.
  useEffect(() => {
    if (save.kind !== "saved") {
      return;
    }
    setDraft((current) => draftAfterSave(current));
  }, [save, draft]);

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
    >
      {lock ? (
        <LockNotice lock={lock} ownFaction={ownFactionName} />
      ) : (
        <div className="flex h-full min-h-0 flex-col">
          <OrdersEditor
            unitId={unit?.unitId ?? ""}
            value={draft}
            ariaLabel={`Orders for unit ${unit?.unitId ?? ""}`}
            problems={problems}
            commands={commands}
            snippets={snippets}
            onChange={(text) => {
              setDraft(text);
              if (unit) {
                onChange(unit.unitId, text);
              }
            }}
          />
          <p
            data-testid="orders-status"
            className="m-0 flex items-center gap-3 border-t border-edge pt-1.5 text-[10px] text-ink-soft"
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
      className="m-0 max-h-20 list-none overflow-y-auto p-0 pt-1 text-[10px] leading-snug"
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
            <span className="shrink-0 tabular-nums text-ink-dim">line {problem.lineStart}</span>
            {found === null ? null : (
              <code
                data-testid="orders-diagnostic-token"
                className="shrink-0 rounded bg-edge/40 px-1 font-mono text-ink-soft"
              >
                {found}
              </code>
            )}
            <span className={problem.severity === "error" ? "text-danger" : "text-warn"}>
              {problem.message}
            </span>
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
  const { badge, lines } = describe(lock, ownFaction);

  return (
    <div
      data-testid="orders-locked"
      data-lock={lock.kind}
      className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-ink-dim"
    >
      <span className="rounded border border-edge px-2.5 py-1 text-[10px] uppercase tracking-[0.08em] text-ink-soft">
        {badge}
      </span>
      {lines.map((line) => (
        <span key={line}>{line}</span>
      ))}
    </div>
  );
}

function describe(lock: Lock, ownFaction: string): { badge: string; lines: string[] } {
  switch (lock.kind) {
    case "no-unit":
      return { badge: "No unit", lines: ["Select a unit to write its orders."] };
    case "foreign":
      return {
        badge: "Read only",
        lines: [
          `This unit belongs to ${lock.factionName}${lock.factionId ? ` (${lock.factionId})` : ""}.`,
          `You can only write orders for units in ${ownFaction}.`
        ]
      };
    case "not-in-turn":
      return {
        badge: "Not in this turn",
        lines: [
          lock.lastSeenTurn === null
            ? "This unit is not in the current report."
            : `This unit was last seen on turn ${lock.lastSeenTurn} and is not in the current report.`,
          "Orders can only be written for units present in the current turn."
        ]
      };
    case "no-block":
      return {
        badge: "No orders block",
        lines: [
          "The report's orders template has no block for this unit.",
          "Adding one would produce a file the server rejects."
        ]
      };
  }
}
