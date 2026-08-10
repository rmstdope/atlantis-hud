import type { ChangeEvent, DragEvent, ReactNode } from "react";
import { useRef } from "react";
import { describeTurnMessages } from "../turnMessages";

export type ImportStatus = {
  regionCount: number;
  unitCount: number;
  message: string | null;
  failed: boolean;
};

/** What the engine said about the loaded turn, as the report printed it. */
export type TurnMessages = {
  errors: string[];
  events: string[];
};

type AppHeaderProps = {
  platformLabel: string;
  gameName: string;
  /** Whether the picker is showing. The header owns the button; the shell owns the panel. */
  pickerOpen: boolean;
  onTogglePicker: () => void;
  /** The picker itself, rendered under the indicator when it is open. */
  picker: ReactNode;
  factionLabel: string | null;
  turnLabel: string | null;
  /** How many allied reports have been folded into this turn. Zero hides the chip entirely. */
  mergedCount: number;
  /** Whether the merged-factions panel is showing. Same split as the picker. */
  mergedOpen: boolean;
  onToggleMerged: () => void;
  /** The panel itself, rendered under the chip when it is open. */
  mergedPanel: ReactNode;
  status: ImportStatus | null;
  /** The loaded turn's errors and events, or null when no turn is loaded. */
  messages: TurnMessages | null;
  /** Whether the messages panel is showing. As with the picker, the shell owns the panel. */
  messagesOpen: boolean;
  onToggleMessages: () => void;
  /** The panel itself, rendered under the chip when it is open. */
  messagesPanel: ReactNode;
  /**
   * How many things order validation found across the whole map. Zero hides the chip entirely.
   *
   * Counted over every hex rather than the one on screen: the mistake that goes out with the turn
   * is the one in the hex nobody clicked on.
   */
  problemCount: number;
  /** Whether the problems panel is showing. Same split as the picker: the shell owns the panel. */
  problemsOpen: boolean;
  onToggleProblems: () => void;
  problemsPanel: ReactNode;
  busy: boolean;
  onLoadReport: (text: string, fileName: string) => void;
  onExportOrders: () => void;
  canExport: boolean;
  /** Whether the settings panel is showing. Same split as the picker: header owns the button. */
  settingsOpen: boolean;
  onToggleSettings: () => void;
  settings: ReactNode;
};

/**
 * Game, turn and faction, with report state alongside them.
 *
 * The game is a button rather than a label: it is both the answer to "which game am I in" and the
 * way to change it, which is the whole of what issue #33 asks the top menu for.
 *
 * Report loading lives here rather than in a panel of its own: it is something you do occasionally
 * and then want out of the way, and putting it in the header means it costs no map area at all.
 */
export function AppHeader({
  platformLabel,
  gameName,
  pickerOpen,
  onTogglePicker,
  picker,
  factionLabel,
  turnLabel,
  mergedCount,
  mergedOpen,
  onToggleMerged,
  mergedPanel,
  status,
  messages,
  messagesOpen,
  onToggleMessages,
  messagesPanel,
  problemCount,
  problemsOpen,
  onToggleProblems,
  problemsPanel,
  busy,
  onLoadReport,
  onExportOrders,
  canExport,
  settingsOpen,
  onToggleSettings,
  settings
}: AppHeaderProps) {
  const fileRef = useRef<HTMLInputElement | null>(null);

  const errorCount = messages?.errors.length ?? 0;
  const chipLabel = describeTurnMessages(errorCount, messages?.events.length ?? 0);

  const readFile = async (file: File) => {
    onLoadReport(await file.text(), file.name);
  };

  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) {
      void readFile(file);
    }
  };

  const onPick = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      void readFile(file);
    }
    // Cleared so choosing the same file twice still fires a change.
    event.target.value = "";
  };

  return (
    <header
      data-testid="app-header"
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
      className="flex h-9 flex-none items-center gap-3.5 border-b border-edge bg-panel px-3 text-[11.5px] whitespace-nowrap"
    >
      <span className="tracking-[0.06em] text-brass">ATLANTIS HUD</span>
      <span className="text-ink-soft">{platformLabel}</span>

      {/*
        The game indicator. Relative, because the picker hangs off it and should open under the
        name it belongs to rather than at the edge of the window.
      */}
      <span className="relative">
        <button
          type="button"
          data-testid="game-indicator"
          aria-haspopup="dialog"
          aria-expanded={pickerOpen}
          onClick={onTogglePicker}
          className="rounded border border-edge bg-panel-raised px-2 py-0.5 text-ink hover:border-brass"
        >
          {gameName}
          <span aria-hidden className="ml-1 text-ink-dim">
            ▾
          </span>
        </button>
        {pickerOpen ? picker : null}
      </span>
      {turnLabel ? (
        <span className="text-ink-soft">
          Turn <span className="rounded border border-edge bg-panel-raised px-2 py-0.5 text-ink">{turnLabel}</span>
        </span>
      ) : null}
      {/*
        The faction, and whose reports have been folded into it.

        Relative, because the merged-factions panel hangs off the chip. The chip answers "whose eyes
        am I looking through" right where the faction is named: merging an ally's report leaves this
        label saying the same thing it said before while the map quietly grows, and after a reload
        the status line that reported the merge is gone.
      */}
      {factionLabel ? (
        <span className="relative text-ink-soft">
          Faction <span className="text-ink">{factionLabel}</span>
          {mergedCount > 0 ? (
            <>
              <button
                type="button"
                data-testid="merged-factions-chip"
                aria-haspopup="dialog"
                aria-expanded={mergedOpen}
                onClick={onToggleMerged}
                className="ml-1.5 rounded border border-edge bg-panel-raised px-2 py-0.5 text-ink-soft hover:border-brass"
              >
                +{mergedCount} merged
                <span aria-hidden className="ml-1 text-ink-dim">
                  ▾
                </span>
              </button>
              {mergedOpen ? mergedPanel : null}
            </>
          ) : null}
        </span>
      ) : null}

      <span data-testid="import-status" className="flex items-center gap-1.5 text-ink-soft">
        {status ? (
          <>
            <span
              aria-hidden
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                status.failed ? "bg-danger" : errorCount > 0 ? "bg-warn" : "bg-ok"
              }`}
            />
            {status.message ??
              `${status.regionCount} region${status.regionCount === 1 ? "" : "s"} · ${status.unitCount} unit${status.unitCount === 1 ? "" : "s"}`}
          </>
        ) : (
          <span className="text-ink-dim">no report loaded</span>
        )}
      </span>

      {/*
        What the engine said about the turn, and the way to read it.

        A control of its own rather than more text in the status above, because that line shows a
        message *instead of* its counts whenever there is one - so on a restored turn the errors
        would have had nowhere to appear at all. Relative, because the panel hangs off it.

        Withheld while an import is failed: that status describes a report that did not load, and a
        chip beside it would be counting the turn still on screen, which is a different turn.
      */}
      {chipLabel && status && !status.failed ? (
        <span className="relative">
          <button
            type="button"
            data-testid="turn-messages-chip"
            aria-haspopup="dialog"
            aria-expanded={messagesOpen}
            onClick={onToggleMessages}
            className={`rounded border px-2 py-0.5 ${
              errorCount > 0
                ? "border-warn text-warn"
                : "border-edge bg-panel-raised text-ink-soft hover:border-brass"
            }`}
          >
            {errorCount > 0 ? <span aria-hidden>⚠ </span> : null}
            {chipLabel}
            <span aria-hidden className="ml-1 text-ink-dim">
              ▾
            </span>
          </button>
          {messagesOpen ? messagesPanel : null}
        </span>
      ) : null}

      {/*
        What order validation found across the whole map.

        Here rather than only in the region panel because the region panel shows the hex you are
        looking at, and the mistake that reaches the server is the one in the hex you are not.
        Hidden entirely when there is nothing wrong: a chip reading "0 problems" is a chip that
        earns none of the room it takes.
      */}
      {problemCount > 0 ? (
        <span className="relative">
          <button
            type="button"
            data-testid="problems-chip"
            aria-haspopup="dialog"
            aria-expanded={problemsOpen}
            onClick={onToggleProblems}
            className="rounded border border-warn px-2 py-0.5 text-warn"
          >
            <span aria-hidden>⚠ </span>
            {problemCount} problem{problemCount === 1 ? "" : "s"}
            <span aria-hidden className="ml-1 text-ink-dim">
              ▾
            </span>
          </button>
          {problemsOpen ? problemsPanel : null}
        </span>
      ) : null}

      <span className="flex-1" />

      <input
        ref={fileRef}
        type="file"
        accept=".rep,.txt,.report,text/plain"
        onChange={onPick}
        className="hidden"
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => fileRef.current?.click()}
        className="rounded border border-brass px-2.5 py-1 text-brass disabled:opacity-50"
      >
        {busy ? "Loading…" : "Load report…"}
      </button>
      <button
        type="button"
        disabled={!canExport}
        onClick={onExportOrders}
        className="rounded border border-edge bg-panel-raised px-2.5 py-1 text-ink disabled:opacity-40"
      >
        Export orders
      </button>

      {/* Relative for the same reason the game indicator is: the panel hangs off this button. */}
      <span className="relative">
        <button
          type="button"
          data-testid="settings-indicator"
          aria-haspopup="dialog"
          aria-expanded={settingsOpen}
          aria-label="Settings"
          onClick={onToggleSettings}
          className="rounded border border-edge bg-panel-raised px-2 py-1 text-ink-soft hover:border-brass hover:text-ink"
        >
          <span aria-hidden>⚙</span>
        </button>
        {settingsOpen ? settings : null}
      </span>
    </header>
  );
}
