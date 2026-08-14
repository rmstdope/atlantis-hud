import type { ChangeEvent, DragEvent, ReactNode } from "react";
import { useRef, useState } from "react";
import { describeTurnMessages } from "../turnMessages";
import { ExportMenu } from "./ExportMenu";

export type ImportStatus = {
  regionCount: number;
  unitCount: number;
  message: string | null;
  failed: boolean;
  /**
   * The import worked but something along the way did not - a turn that could not be remembered,
   * a draft that could not be read. Worth room in the header where a routine success is not.
   */
  warning: boolean;
};

/** What the engine said about the loaded turn, as the report printed it. */
export type TurnMessages = {
  errors: string[];
  events: string[];
};

/**
 * What the import button says while it is working.
 *
 * Counted only for a batch. One report is over before a count could be read, and "Importing 1/1…"
 * is a progress bar for a journey of one step.
 */
function importingLabel(progress: { done: number; total: number } | null): string {
  return progress === null ? "Importing…" : `Importing ${progress.done}/${progress.total}…`;
}

type AppHeaderProps = {
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
  /**
   * How many battles the loaded turn describes. Zero hides the chip entirely, as with the other
   * counted chips.
   */
  battleCount: number;
  /**
   * Whether the battles dialog is showing.
   *
   * Unlike the other chips, this one has no panel prop: the dialog it opens is centred over the
   * whole workspace rather than hung under the chip, for the reason `TurnMessagesPanel` documents
   * about the header being the one element that accepts a dropped report - a floating child of it
   * would become an invisible drop target over the map. The shell renders the dialog itself,
   * beside `MapExportDialog`, and only reads this flag back to decide the chip's pressed state.
   */
  battlesOpen: boolean;
  onToggleBattles: () => void;
  busy: boolean;
  /**
   * Every report the player chose, in the order the file dialog handed them over.
   *
   * A list rather than one report, because the order files arrive in is not the order they belong
   * in: the shell reads the turn out of each header and sorts them. One file is still one file and
   * still gets the questions a single report has always been given.
   */
  onImportReports: (files: File[]) => void;
  /**
   * How far a batch has got, or null when nothing is running or only one file is.
   *
   * A run of thirty turns is thirty database commits, which is long enough that a button reading
   * only "Importing…" looks like a hang.
   */
  progress: { done: number; total: number } | null;
  onExportOrders: () => void;
  canExport: boolean;
  /** The same export, with the server's long-format unit descriptions put back in. */
  onExportOrdersLong: () => void;
  /** Off when the loaded report carries no long-format template to restore descriptions from. */
  canExportLong: boolean;
  /** Opens the map export dialog. Off until a report is on screen to export a map of. */
  onExportMap: () => void;
  canExportMap: boolean;
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
  battleCount,
  battlesOpen,
  onToggleBattles,
  busy,
  onImportReports,
  progress,
  onExportOrders,
  canExport,
  onExportOrdersLong,
  canExportLong,
  onExportMap,
  canExportMap,
  settingsOpen,
  onToggleSettings,
  settings
}: AppHeaderProps) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  /**
   * Whether the export menu is showing.
   *
   * Held here rather than in the shell like the other header popovers, because nothing outside
   * this header opens it: the command palette runs the exports directly, so a shell that knew
   * about this state would only be passing it back down again.
   */
  const [exportOpen, setExportOpen] = useState(false);

  const errorCount = messages?.errors.length ?? 0;
  const chipLabel = describeTurnMessages(errorCount, messages?.events.length ?? 0);

  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    // Refused while one is already running, as the button is. A drop is the one way in that a
    // disabled button cannot cover, and a second batch started over the first would interleave two
    // walks writing the same turns, fight over the progress count, and leave only the later
    // summary - discarding the only account of what the first one skipped.
    if (busy) {
      return;
    }
    // Every file dropped, not just the first. A player dragging a folder's worth of turns onto the
    // bar means all of them, and taking one silently was the old behaviour's quietest failure.
    const files = [...event.dataTransfer.files];
    if (files.length > 0) {
      onImportReports(files);
    }
  };

  const onPick = (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    if (files.length > 0) {
      onImportReports(files);
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
      {/* Just the title: which build this is belongs to the About tab, not the title bar. */}
      <span className="tracking-[0.06em] text-brass">ATLANTIS HUD</span>

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

      {/*
        The import status, taking up room only when it has something to say: an import that
        failed, or one that worked with a warning. A loaded turn already announces itself through
        the Turn chip and the map, so the routine "restored turn 39" was the header saying the
        same thing twice. The line itself stays in the page - screen readers and the test suite
        key on its text - via `sr-only` rather than `hidden`, for exactly those two readers.
      */}
      <span
        data-testid="import-status"
        className={
          status?.failed || status?.warning
            ? "flex items-center gap-1.5 text-ink-soft"
            : "sr-only"
        }
      >
        {status ? (
          <>
            {status.failed || status.warning ? (
              <span
                aria-hidden
                className={`inline-block h-1.5 w-1.5 rounded-full ${
                  status.failed ? "bg-danger" : "bg-warn"
                }`}
              />
            ) : null}
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

      {/*
        The turn's battles, if it had any. Hidden entirely otherwise, for the same reason the
        problems chip is: a chip reading "0 battles" earns none of the room it takes.
      */}
      {battleCount > 0 ? (
        <button
          type="button"
          data-testid="battles-chip"
          aria-haspopup="dialog"
          aria-expanded={battlesOpen}
          onClick={onToggleBattles}
          className="rounded border border-edge bg-panel-raised px-2 py-0.5 text-ink-soft hover:border-brass"
        >
          {battleCount} battle{battleCount === 1 ? "" : "s"}
        </button>
      ) : null}

      <span className="flex-1" />

      <input
        ref={fileRef}
        type="file"
        multiple
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
        {busy ? importingLabel(progress) : "Import"}
      </button>
      {/* Relative, because the menu hangs off the button rather than off the window's edge. */}
      <span className="relative">
        <button
          type="button"
          data-testid="export-menu"
          aria-haspopup="dialog"
          aria-expanded={exportOpen}
          onClick={() => setExportOpen((open) => !open)}
          className="rounded border border-edge bg-panel-raised px-2.5 py-1 text-ink"
        >
          Export
          <span aria-hidden className="ml-1 text-ink-dim">
            ▾
          </span>
        </button>
        {exportOpen ? (
          <ExportMenu
            canExportOrders={canExport}
            canExportOrdersLong={canExportLong}
            canExportMap={canExportMap}
            onExportOrders={onExportOrders}
            onExportOrdersLong={onExportOrdersLong}
            onExportMap={onExportMap}
            onDismiss={() => setExportOpen(false)}
          />
        ) : null}
      </span>

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
