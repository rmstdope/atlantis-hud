import type { ChangeEvent, DragEvent, ReactNode } from "react";
import { useRef } from "react";
import { describeTurnMessages } from "../turnMessages";
import { ExportMenu } from "./ExportMenu";
import { ChipPopover } from "./popover";
import type { StatusLine, StatusTone } from "./shellStatus";

/** The status line's dot colour by tone; `routine` has no dot (see the render site). */
function dotClass(tone: Exclude<StatusTone, "routine">): string {
  switch (tone) {
    case "notice":
      return "bg-ink-dim";
    case "warning":
      return "bg-warn";
    case "failure":
      return "bg-danger";
  }
}

/** What the engine said about the loaded turn, as the report printed it. */
export type TurnMessages = {
  errors: string[];
  events: string[];
};

/** The header's popovers, at most one of which is open. Dialogs (settings, battles, changes) are not popovers and keep their own flags. */
export type HeaderPopoverId =
  | "games"
  | "turns"
  | "merged"
  | "faction"
  | "messages"
  | "problems"
  | "export";

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
  /** Which header popover is open, if any - one at a time, owned by the shell. */
  openPopover: HeaderPopoverId | null;
  /** Opens the named popover (closing whichever was open), or closes all with null. */
  onOpenPopover: (id: HeaderPopoverId | null) => void;
  /** The picker itself, rendered under the indicator when it is open. */
  picker: ReactNode;
  factionLabel: string | null;
  turnLabel: string | null;
  /** The working turn's bare number, e.g. "71" - what the chip collapses to while comparing. */
  workingTurnNumber: string | null;
  /** The picker itself, rendered under the chip when it is open. */
  turnPicker: ReactNode;
  /**
   * The compared turn's number, or null when nothing is being compared. Set, it replaces the
   * chip's plain label with `<workingTurnNumber> ⇄ <compared>` - the compared half in brass - and
   * an inline way to stop.
   */
  comparedTurnLabel: string | null;
  onStopComparing: () => void;
  /** How many allied reports have been folded into this turn. Zero hides the chip entirely. */
  mergedCount: number;
  /** The panel itself, rendered under the chip when it is open. */
  mergedPanel: ReactNode;
  /** The panel itself, rendered under the faction name when it is open. */
  factionPanel: ReactNode;
  status: StatusLine | null;
  /** The loaded turn's errors and events, or null when no turn is loaded. */
  messages: TurnMessages | null;
  /** The panel itself, rendered under the chip when it is open. */
  messagesPanel: ReactNode;
  /**
   * How many things order validation found across the whole map. Zero hides the chip entirely.
   *
   * Counted over every hex rather than the one on screen: the mistake that goes out with the turn
   * is the one in the hex nobody clicked on.
   */
  problemCount: number;
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
  /**
   * Opens or closes the diff dialog (ah-jg6.4). The chip's *presence* is decided by
   * `comparedTurnLabel` alone - the prop the Turn chip already reuses for "a comparison is on" -
   * so this carries no parallel notion of that; `changesOpen` here is only the same
   * open/closed flag `battlesOpen` is, for the chip's pressed state and its toggle behaviour.
   */
  changesOpen: boolean;
  onToggleChanges: () => void;
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
  openPopover,
  onOpenPopover,
  picker,
  factionLabel,
  turnLabel,
  workingTurnNumber,
  turnPicker,
  comparedTurnLabel,
  onStopComparing,
  mergedCount,
  mergedPanel,
  factionPanel,
  status,
  messages,
  messagesPanel,
  problemCount,
  problemsPanel,
  battleCount,
  battlesOpen,
  onToggleBattles,
  changesOpen,
  onToggleChanges,
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
  const toggle = (id: HeaderPopoverId) => onOpenPopover(openPopover === id ? null : id);
  const close = () => onOpenPopover(null);

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
      className="flex flex-wrap min-h-9 flex-none items-center gap-x-3.5 border-b border-edge bg-panel px-3 text-[11.5px] whitespace-nowrap"
    >
      {/*
        Game state, grouped so it can wrap internally on a very narrow window without disturbing
        the actions group's own wrap onto a second row.
      */}
      <div className="flex min-h-9 flex-wrap items-center gap-3.5 min-w-0">
      {/* Just the title: which build this is belongs to the About tab, not the title bar. */}
      <span className="tracking-[0.06em] text-brass">ATLANTIS HUD</span>

      {/*
        The game indicator. Relative, because the picker hangs off it and should open under the
        name it belongs to rather than at the edge of the window.
      */}
      <ChipPopover open={openPopover === "games"} onDismiss={close} panel={picker}>
        <button
          type="button"
          data-testid="game-indicator"
          aria-haspopup="dialog"
          aria-expanded={openPopover === "games"}
          onClick={() => toggle("games")}
          className="rounded border border-edge bg-panel-raised px-2 py-0.5 text-ink hover:border-brass"
        >
          {gameName}
          <span aria-hidden className="ml-1 text-ink-dim">
            ▾
          </span>
        </button>
      </ChipPopover>
      {turnLabel ? (
        <span className="text-ink-soft">
          Turn{" "}
          {/*
            Its own `ChipPopover`, sibling to the game indicator's rather than sharing one - the
            same reason the faction and merged chips each get their own (see below).
          */}
          <ChipPopover open={openPopover === "turns"} onDismiss={close} panel={turnPicker}>
            <button
              type="button"
              data-testid="turn-chip"
              aria-haspopup="dialog"
              aria-expanded={openPopover === "turns"}
              onClick={() => toggle("turns")}
              className="rounded border border-edge bg-panel-raised px-2 py-0.5 text-ink hover:border-brass"
            >
              {comparedTurnLabel ? (
                <>
                  {workingTurnNumber ?? turnLabel}
                  <span className="text-brass-bright"> ⇄ {comparedTurnLabel}</span>
                </>
              ) : (
                <>
                  {turnLabel}
                  <span aria-hidden className="ml-1 text-ink-dim">
                    ▾
                  </span>
                </>
              )}
            </button>
            {comparedTurnLabel ? (
              <button
                type="button"
                aria-label="stop comparing"
                onClick={(event) => {
                  event.stopPropagation();
                  onStopComparing();
                }}
                className="ml-1 rounded px-1 text-ink-dim hover:text-ink"
              >
                ✕
              </button>
            ) : null}
          </ChipPopover>
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
        <span className="text-ink-soft">
          Faction{" "}
          {/*
            Its own `ChipPopover`, sibling to the merged chip's rather than sharing one - never one
            inside the other's wrapper, or a press on one chip would count as *inside* the other's
            popover and fail to dismiss it (ah-vp3.2's trap).
          */}
          <ChipPopover open={openPopover === "faction"} onDismiss={close} panel={factionPanel}>
            <button
              type="button"
              data-testid="faction-chip"
              aria-haspopup="dialog"
              aria-expanded={openPopover === "faction"}
              onClick={() => toggle("faction")}
              className="text-ink hover:text-brass"
            >
              {factionLabel}
              <span aria-hidden className="ml-1 text-ink-dim">
                ▾
              </span>
            </button>
          </ChipPopover>
          {mergedCount > 0 ? (
            <ChipPopover
              open={openPopover === "merged"}
              onDismiss={close}
              panel={mergedPanel}
              className="ml-1.5"
            >
              <button
                type="button"
                data-testid="merged-factions-chip"
                aria-haspopup="dialog"
                aria-expanded={openPopover === "merged"}
                onClick={() => toggle("merged")}
                className="rounded border border-edge bg-panel-raised px-2 py-0.5 text-ink-soft hover:border-brass"
              >
                +{mergedCount} merged
                <span aria-hidden className="ml-1 text-ink-dim">
                  ▾
                </span>
              </button>
            </ChipPopover>
          ) : null}
        </span>
      ) : null}

      {/*
        The status line, taking up room only when its tone is worth a glance: a notice, a
        warning or a failure. A loaded turn already announces itself through the Turn chip and
        the map, so the routine "11 regions · 42 units" or "restored turn 39" would be the header
        saying the same thing twice - it stays written for screen readers and the test suite via
        `sr-only` rather than `hidden`, for exactly those two readers.
      */}
      <span
        data-testid="import-status"
        className={
          status !== null && status.tone !== "routine"
            ? "flex items-center gap-1.5 text-ink-soft"
            : "sr-only"
        }
      >
        {status ? (
          <>
            {status.tone !== "routine" ? (
              <span
                aria-hidden
                className={`inline-block h-1.5 w-1.5 rounded-full ${dotClass(status.tone)}`}
              />
            ) : null}
            {status.text}
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

        Always shown when there is something to say: the chip counts the turn on screen, and
        stays whatever the status line says about it.
      */}
      {chipLabel ? (
        <ChipPopover open={openPopover === "messages"} onDismiss={close} panel={messagesPanel}>
          <button
            type="button"
            data-testid="turn-messages-chip"
            aria-haspopup="dialog"
            aria-expanded={openPopover === "messages"}
            onClick={() => toggle("messages")}
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
        </ChipPopover>
      ) : null}

      {/*
        What order validation found across the whole map.

        Here rather than only in the region panel because the region panel shows the hex you are
        looking at, and the mistake that reaches the server is the one in the hex you are not.
        Hidden entirely when there is nothing wrong: a chip reading "0 problems" is a chip that
        earns none of the room it takes.
      */}
      {problemCount > 0 ? (
        <ChipPopover open={openPopover === "problems"} onDismiss={close} panel={problemsPanel}>
          <button
            type="button"
            data-testid="problems-chip"
            aria-haspopup="dialog"
            aria-expanded={openPopover === "problems"}
            onClick={() => toggle("problems")}
            className="rounded border border-warn px-2 py-0.5 text-warn"
          >
            <span aria-hidden>⚠ </span>
            {problemCount} problem{problemCount === 1 ? "" : "s"}
            <span aria-hidden className="ml-1 text-ink-dim">
              ▾
            </span>
          </button>
        </ChipPopover>
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

      {/*
        Opens the diff dialog (ah-jg6.4). No `relative` wrapper, like the battles chip: its
        surface is a centred dialog, not something hung under this button. Present only while a
        comparison is on - the same `comparedTurnLabel` the Turn chip already reads, not a
        parallel flag.
      */}
      {comparedTurnLabel ? (
        <button
          type="button"
          data-testid="changes-chip"
          aria-haspopup="dialog"
          aria-expanded={changesOpen}
          onClick={onToggleChanges}
          className="rounded border border-edge bg-panel-raised px-2 py-0.5 text-ink-soft hover:border-brass"
        >
          Changes
        </button>
      ) : null}
      </div>

      {/*
        Import, Export and settings. `ml-auto` right-aligns this group on a shared row and, once it
        wraps, on its own row too - so it drops as one unit rather than trailing off wherever the
        game-state group happened to end.
      */}
      <div data-testid="header-actions" className="ml-auto flex h-9 items-center gap-3.5">
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
      {/* The menu hangs off the button rather than off the window's edge. */}
      <ChipPopover
        open={openPopover === "export"}
        onDismiss={close}
        panel={
          <ExportMenu
            canExportOrders={canExport}
            canExportOrdersLong={canExportLong}
            canExportMap={canExportMap}
            onExportOrders={onExportOrders}
            onExportOrdersLong={onExportOrdersLong}
            onExportMap={onExportMap}
            onDismiss={close}
          />
        }
      >
        <button
          type="button"
          data-testid="export-menu"
          aria-haspopup="dialog"
          aria-expanded={openPopover === "export"}
          onClick={() => toggle("export")}
          className="rounded border border-edge bg-panel-raised px-2.5 py-1 text-ink"
        >
          Export
          <span aria-hidden className="ml-1 text-ink-dim">
            ▾
          </span>
        </button>
      </ChipPopover>

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
      </div>
    </header>
  );
}
