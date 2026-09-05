import { PopoverFrame } from "./popover";
import { SIGNED_OUT_ON_CLOSE } from "./newAgeSignInView";
import { FETCH_REPORT_ITEM, FETCH_REPORT_ITEM_BUSY } from "./newAgeFetchView";
import { HISTORY_ITEM } from "./newAgeHistoryView";

/**
 * The popover behind the signed-in chip: who is signed in, that nothing is stored, and a way out.
 *
 * Split into a frame and a body for the reason `AddToArmyMenu` gives: `PopoverFrame` uses hooks and
 * focuses itself on mount, so a unit test in this package - which renders to static markup and runs
 * no effects - reaches the body rather than the frame.
 */
export function NewAgeWorldPanel({
  summary,
  fetching,
  historyBusy,
  onFetchReport,
  onFetchEarlierTurns,
  onSignOut
}: {
  summary: string;
  /** True while a fetch is in flight: the item is disabled and reads `Fetching…`. */
  fetching: boolean;
  /** True while the turn dialog is open or its list is being asked for. */
  historyBusy: boolean;
  onFetchReport: () => void;
  onFetchEarlierTurns: () => void;
  onSignOut: () => void;
}) {
  return (
    <PopoverFrame testId="newage-panel" label="New Age world" align="right" width="w-72">
      <NewAgeWorldPanelBody
        summary={summary}
        fetching={fetching}
        historyBusy={historyBusy}
        onFetchReport={onFetchReport}
        onFetchEarlierTurns={onFetchEarlierTurns}
        onSignOut={onSignOut}
      />
    </PopoverFrame>
  );
}

/** Everything inside the frame - the half a unit test here can reach. */
export function NewAgeWorldPanelBody({
  summary,
  fetching,
  historyBusy,
  onFetchReport,
  onFetchEarlierTurns,
  onSignOut
}: {
  summary: string;
  fetching: boolean;
  historyBusy: boolean;
  onFetchReport: () => void;
  onFetchEarlierTurns: () => void;
  onSignOut: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-ink">{summary}</p>
      <button
        type="button"
        data-testid="newage-fetch-report"
        disabled={fetching || historyBusy}
        onClick={onFetchReport}
        className="rounded border border-brass px-2 py-0.5 text-brass hover:bg-brass/10 disabled:border-edge disabled:text-ink-dim"
      >
        {fetching ? FETCH_REPORT_ITEM_BUSY : FETCH_REPORT_ITEM}
      </button>
      {/* Bordered in `edge` rather than `brass`: the brass item is the one a player wants nine
          times out of ten, and two brass buttons in a three-item popover is two primaries. */}
      <button
        type="button"
        data-testid="newage-fetch-history"
        disabled={fetching || historyBusy}
        onClick={onFetchEarlierTurns}
        className="rounded border border-edge px-2 py-0.5 text-ink-soft hover:border-brass hover:text-brass disabled:border-edge disabled:text-ink-dim"
      >
        {HISTORY_ITEM}
      </button>
      <p className="text-ink-dim">{SIGNED_OUT_ON_CLOSE}</p>
      <div className="flex justify-end">
        <button
          type="button"
          data-testid="newage-signout"
          onClick={onSignOut}
          className="rounded border border-edge px-2 py-0.5 text-ink-soft hover:border-brass hover:text-brass"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
