import { useEffect, useRef } from "react";

import { useEscapeToDismiss } from "./dismissLayer";
import {
  HISTORY_BLURB,
  HISTORY_CLOSE,
  HISTORY_RETRY,
  fetchAllLabel,
  historyEmpty,
  historyListing,
  historyTitle,
  runningLabel,
  type HistoryRow,
  type HistoryRowState,
  type NewAgeHistoryPhase
} from "./newAgeHistoryView";

/**
 * The turns a New Age world still holds, and what has been done with each.
 *
 * Draws a `NewAgeHistoryPhase` and nothing else: no state of its own, no fetching, no knowledge of
 * the client. What a row means and what every line says is `newAgeHistoryView.ts`'s.
 */
export function NewAgeHistoryDialog({
  worldName,
  phase,
  rows,
  missingCount,
  onFetchTurn,
  onFetchAllMissing,
  onRetryList,
  onDismiss
}: {
  /** `Arcanum` - the world's one short word. */
  worldName: string;
  phase: NewAgeHistoryPhase;
  /** Already built by `historyRows`; this component sorts and decides nothing. */
  rows: HistoryRow[];
  /** From `missingTurns(...).length`; the primary button is absent at 0. */
  missingCount: number;
  onFetchTurn: (turnNumber: number) => void;
  onFetchAllMissing: () => void;
  onRetryList: () => void;
  onDismiss: () => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  // Whatever held focus when this mounted, so it can be given back on unmount - the rule
  // `NewAgeSendDialog` follows. This codebase has no focus trap and this dialog adds none.
  const openerRef = useRef<Element | null>(
    typeof document === "undefined" ? null : document.activeElement
  );

  useEscapeToDismiss(onDismiss);

  useEffect(() => {
    panelRef.current?.focus();
    const opener = openerRef.current;
    return () => {
      if (opener instanceof HTMLElement) {
        opener.focus();
      }
    };
  }, []);

  // `reauth` keeps the dialog mounted behind the sign-in dialog, showing what the run had got to.
  const ready = phase.kind === "ready" ? phase : phase.kind === "reauth" ? phase.behind : null;
  const running = ready !== null && ready.run !== null;

  const note =
    phase.kind === "listing"
      ? historyListing(worldName)
      : phase.kind === "empty"
        ? historyEmpty(worldName)
        : phase.kind === "listFailed"
          ? phase.message
          : HISTORY_BLURB;

  return (
    <div
      data-testid="newage-history-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onDismiss();
        }
      }}
      // The dialog mounts inside the header, which is the report drop target: a file dropped on
      // the backdrop must not be read as an import.
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => event.preventDefault()}
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/50"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        data-testid="newage-history-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Earlier turns on a New Age world"
        className="flex w-[24rem] flex-col gap-2 rounded border border-edge bg-panel-raised p-3 text-pane whitespace-normal shadow-lg"
      >
        <h2 className="text-ink">{historyTitle(worldName)}</h2>
        <p
          data-testid="newage-history-note"
          className={phase.kind === "listFailed" ? "text-danger" : "text-ink-soft"}
        >
          {note}
        </p>

        {ready === null ? null : (
          // A world holding forty turns must not push the buttons off screen - the rule
          // `NewAgeSendDialog`'s error list already follows.
          <ul
            data-testid="newage-history-list"
            className="flex max-h-[14rem] flex-col overflow-y-auto"
          >
            {rows.map((row) => (
              <li key={row.turnNumber}>
                <button
                  type="button"
                  data-testid={`newage-history-row-${row.turnNumber}`}
                  disabled={running}
                  onClick={() => onFetchTurn(row.turnNumber)}
                  className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left hover:bg-panel disabled:text-ink-dim"
                >
                  <span className="tabular-nums text-ink">{row.turnNumber}</span>
                  <span className="text-ink-dim">{row.season ?? "—"}</span>
                  <span className={`ml-auto text-pane-sm ${markClass(row.state)}`}>
                    {markText(row.state)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            data-testid="newage-history-close"
            onClick={onDismiss}
            className="rounded border border-edge px-2 py-0.5 text-ink-soft hover:border-brass hover:text-brass"
          >
            {HISTORY_CLOSE}
          </button>
          {phase.kind === "listFailed" ? (
            <button
              type="button"
              data-testid="newage-history-retry"
              onClick={onRetryList}
              className="rounded border border-brass px-2 py-0.5 text-brass hover:bg-brass/10"
            >
              {HISTORY_RETRY}
            </button>
          ) : null}
          {ready !== null && (missingCount > 0 || running) ? (
            <button
              type="button"
              data-testid="newage-history-fetch-all"
              disabled={running}
              onClick={onFetchAllMissing}
              className="rounded border border-brass px-2 py-0.5 text-brass hover:bg-brass/10 disabled:border-edge disabled:text-ink-dim"
            >
              {ready.run === null
                ? fetchAllLabel(missingCount)
                : runningLabel(ready.run.done, ready.run.total)}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function markText(state: HistoryRowState): string {
  switch (state.kind) {
    case "playing":
      return "playing";
    case "stored":
      return "stored";
    case "missing":
      return "fetch";
    case "fetching":
      return "fetching…";
    case "failed":
      return state.reason;
  }
}

function markClass(state: HistoryRowState): string {
  switch (state.kind) {
    case "playing":
    case "stored":
      return "text-ok";
    case "fetching":
      return "text-brass";
    case "failed":
      return "text-danger";
    case "missing":
      return "text-ink-dim";
  }
}
