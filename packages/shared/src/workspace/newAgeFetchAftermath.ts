import type { NewAgeFetchOutcome } from "./newAgeFetchRun";
import { FETCH_FAILURE_PREFIX, FETCH_REFUSED_MID_RUN } from "./newAgeFetchView";
import type { NewAgeFetchPhase } from "./newAgeFetchView";
import { runSummary } from "./newAgeHistoryView";
import { failedStatus, warningStatus, type StatusLine } from "./shellStatus";

/** What the shell knows the moment `runNewAgeFetch` returns. Every field is read, none is derived. */
export type NewAgeFetchAftermathInput = {
  outcome: NewAgeFetchOutcome;
  /**
   * The dialog is still this run's: it was not dismissed and no later Fetch replaced it. Read
   * from `fetchAbort.current === controller` BEFORE the shell clears that ref.
   */
  stillOurs: boolean;
  /** The run reached a per-turn fetch, so it may have stored earlier turns. */
  reachedTurns: boolean;
  /**
   * A later run has taken over. Read AFTER the shell clears its own controller, so a plain
   * cancel - a cleared controller - is not superseded.
   */
  superseded: boolean;
  /** The game open when Fetch was pressed is still the open one. */
  sameGame: boolean;
  /** The turn on screen as the run sees it, from `viewerRef` and never from a render. */
  workingTurn: number | null;
};

/** What the Fetch dialog is told. Three cases, because "say nothing" is not "close". */
export type NewAgeFetchDialogNext =
  /** Say nothing: it was dismissed or replaced while the run was in flight. */
  | { kind: "leave" }
  /** Close it: the run is over, whatever it did. */
  | { kind: "close" }
  /** Keep it up, asking again with the password cleared - the login was refused. */
  | { kind: "reopen"; phase: NewAgeFetchPhase };

export type NewAgeFetchAftermath = {
  dialog: NewAgeFetchDialogNext;
  /** The header line, or `null` when this run says nothing. */
  status: StatusLine | null;
  /** Whether the turn picker must be re-listed once this run is over. */
  relistTurns: boolean;
};

/**
 * What happens after one press of Fetch: what the dialog is told, what the header says, and
 * whether the turn picker must be re-listed.
 */
export function newAgeFetchAftermath(input: NewAgeFetchAftermathInput): NewAgeFetchAftermath {
  const { outcome, stillOurs } = input;
  return {
    dialog: !stillOurs
      ? { kind: "leave" }
      : outcome.kind === "refused"
        ? {
            kind: "reopen",
            phase: { kind: "ready", message: outcome.message, retype: outcome.retype }
          }
        : { kind: "close" },
    status: stillOurs ? statusFor(outcome, input.workingTurn) : null,
    relistTurns: relistTurns(input)
  };
}

/**
 * The header line for a run that is still this dialog's.
 *
 * Exhaustive with no `default` on purpose: a sixth outcome kind must fail the typecheck rather
 * than leave a blank line in front of a player.
 */
function statusFor(outcome: NewAgeFetchOutcome, workingTurn: number | null): StatusLine | null {
  switch (outcome.kind) {
    case "refused":
      // The dialog carries the message; the header says nothing.
      return null;
    case "reportFailed":
      return failedStatus(`${FETCH_FAILURE_PREFIX}: ${outcome.reason}`);
    case "done":
      if (outcome.listFailed !== null) {
        return warningStatus(outcome.listFailed);
      }
      if (outcome.history === null) {
        // A plain `thisTurn` fetch: `loadReport` has already written its own line for the turn
        // that just landed, and a second one would repeat it.
        return null;
      }
      return outcome.history.refusedMidRun
        ? failedStatus(FETCH_REFUSED_MID_RUN)
        : // `failed` is a Map, so `.size`: `.length` is `undefined` and reads as 0.
          runSummary(outcome.history.stored.length, outcome.history.failed.size, workingTurn);
    case "abandoned":
      // The player closed the dialog, and a line about a run they stopped is noise.
      return null;
  }
}

/**
 * Whether the turn picker must be re-listed once this run is over.
 *
 * Deliberately **not** gated on `stillOurs`: a run that stored earlier turns put them in the game
 * whether it finished or was cancelled, and a turn the picker cannot see is a turn the player
 * cannot compare against. That is what the old blanket early return broke.
 *
 * Three things have to be true, and each has a way of going wrong:
 *
 * - The run reached a per-turn fetch. `abandoned` is returned from three points before that, and
 *   none of them can have stored anything worth a core round trip.
 * - No later run has taken over. A second Fetch pressed after a cancel sets its own controller;
 *   the first run's list would then land on top of the second's and briefly hide turns the second
 *   one stored. A cleared controller is the plain cancel, and is fine - which is why `superseded`
 *   is read after the shell clears its own.
 * - The game has not changed under it. `dismissFetch` is what a game or ruleset switch calls too,
 *   so without this a run torn down by a switch would list the game the player just left and write
 *   that list into the shell now showing another one.
 */
function relistTurns(input: NewAgeFetchAftermathInput): boolean {
  const { outcome } = input;
  const storedSomething =
    input.reachedTurns &&
    (outcome.kind === "abandoned" || (outcome.kind === "done" && outcome.history !== null));
  return storedSomething && !input.superseded && input.sameGame;
}

/**
 * Whether the listing that has just come back may still be written to the shell.
 *
 * Asked on the far side of the await, and not folded into `newAgeFetchAftermath`: the listing is a
 * core round trip, and a second Fetch or a game switch during it makes this list the older answer.
 * Last write wins only if the last writer is the one that checked last.
 *
 * One window is left, knowingly: a second run that both starts and finishes inside that await
 * clears the controller back to null, and this older list would then write over its newer one.
 * Closing it wants a run counter rather than a controller identity, and the window is a whole
 * fetch inside one listing round trip.
 */
export function newAgeListingStillCurrent(input: {
  sameGame: boolean;
  /** `fetchAbort.current === null || fetchAbort.current === controller`, read now, not earlier. */
  controllerIsOursOrCleared: boolean;
}): boolean {
  return input.sameGame && input.controllerIsOursOrCleared;
}
