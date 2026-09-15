/**
 * What fetching earlier turns from a New Age world says, decided apart from how it is drawn.
 *
 * Split out for the reason `newAgeSignInView.ts`, `sendOrdersView.ts` and `newAgeFetchView.ts` all
 * give: this package has no jsdom (ah-nass), so a rule is only testable by a unit test when it
 * lives in a pure module.
 *
 * Nothing here renders a reply body. A New Age reply can carry a password in cleartext, so a
 * failure becomes one of six short phrases and never the server's own words.
 */

import type { NewAgeFailure } from "./newAgeApi";
import { failedStatus, noticeStatus, warningStatus, type StatusLine } from "./shellStatus";

/** A row's mark when the game would not store what the world gave. Not a `NewAgeFailure`. */
export const HISTORY_NOT_STORED = "not stored";

export function historyListing(worldName: string): string {
  return `Asking ${worldName} which turns it holds…`;
}

/** `; still showing turn 84.`, or a bare `.` when nothing is on screen. */
function stillShowing(workingTurn: number | null): string {
  return workingTurn === null ? "." : `; still showing turn ${workingTurn}.`;
}

/**
 * `turn 84 loaded`. `this turn loaded` for `null` is unreachable - the dialog opens only with a
 * report on screen, and this turn has just landed - but it words the clause rather than `turn null`.
 */
function turnLoaded(workingTurn: number | null): string {
  return workingTurn === null ? "this turn loaded" : `turn ${workingTurn} loaded`;
}

/** The list came back and Atlantis HUD could not make sense of it: the fault is the app's own. */
export function historyListNotUnderstood(worldName: string, workingTurn: number | null): StatusLine {
  return warningStatus(
    `${turnLoaded(workingTurn)}. Atlantis HUD did not understand ${worldName}'s list of earlier turns, so none were fetched — trying again will not help.`
  );
}

/** The list could not be had for a reason that is the network's or the world's. */
export function historyListNotFetched(
  worldName: string,
  reason: string,
  workingTurn: number | null
): StatusLine {
  return warningStatus(
    `${turnLoaded(workingTurn)}, but ${worldName}'s list of earlier turns could not be fetched: ${reason}.`
  );
}

/** The world lists earlier turns and the game already holds every one. Not a failure. */
export function historyNothingMissing(workingTurn: number | null): StatusLine {
  return noticeStatus(`every earlier turn was already loaded${stillShowing(workingTurn)}`);
}

/** The world lists nothing before the turn on screen. Not a failure. */
export function historyNoneEarlier(worldName: string, workingTurn: number | null): StatusLine {
  return noticeStatus(
    `${worldName} holds no earlier turns for this faction${stillShowing(workingTurn)}`
  );
}

/**
 * A failed turn's mark: a short phrase, not the whole sentence. A 24rem dialog has no room for
 * `could not reach atlantis-newage.com` in a right-aligned mark; the sentence goes to the status
 * line, where the single-turn path already puts it.
 *
 * Exhaustive over `NewAgeFailure` with no `default`, so a sixth kind is a typecheck failure here
 * rather than a blank mark in front of a player - the rule `fetchFailureReason` already follows.
 * The `unauthorized` arm exists for that exhaustiveness and is not reached: the run branches on
 * that kind first.
 */
export function historyRowFailure(failure: NewAgeFailure): string {
  switch (failure.kind) {
    case "unreachable":
      return "no answer";
    case "unreadable":
      return "no report";
    case "refused":
      return "refused";
    case "unsendable":
      return "not sent";
    case "unauthorized":
      return "session ended";
  }
}

/** In front of one turn's fetch failure on the status line: `could not fetch turn 80`. */
export function fetchTurnPrefix(turnNumber: number): string {
  return `could not fetch turn ${turnNumber}`;
}

/** The routine status while one turn is in flight. */
export function fetchingTurnStatus(turnNumber: number, worldName: string): string {
  return `Fetching turn ${turnNumber} from ${worldName}…`;
}

/**
 * `turn 80 from Arcanum` - what `loadReport` is given in place of a file name. It reaches the
 * player only inside `runReported`'s prefix, as `could not read turn 80 from Arcanum: <why>`,
 * matching how `fetchedReportName` already behaves.
 */
export function fetchedTurnName(worldName: string, turnNumber: number): string {
  return `turn ${turnNumber} from ${worldName}`;
}

/**
 * The turns a history fetch asks for, turn ascending: every listed *earlier* turn
 * that is neither the working turn nor already stored. A run is one pass, so there is nothing
 * fetched-this-visit to exclude: `stored` is read after this turn has landed and says everything.
 *
 * A turn **newer** than the one on screen is never asked for in bulk: `routeReport` answers `load`
 * for it, so loading it would take the screen, which a fetch of earlier turns must not do.
 */
export function missingTurns(
  worldTurns: readonly number[],
  stored: readonly { turnNumber: number }[],
  workingTurn: number | null
): number[] {
  const held = new Set(stored.map((entry) => entry.turnNumber));
  return earlierTurns(worldTurns, workingTurn).filter((turnNumber) => !held.has(turnNumber));
}

/** Listed turns before the one on screen, ascending. Every listed turn when nothing is on screen. */
export function earlierTurns(worldTurns: readonly number[], workingTurn: number | null): number[] {
  return [...worldTurns]
    .sort((left, right) => left - right)
    .filter(
      (turnNumber) =>
        turnNumber !== workingTurn && (workingTurn === null || turnNumber < workingTurn)
    );
}

/**
 * What the status line says when a run of several turns ends.
 *
 * Always returns a line: whether a run of **one** gets a summary at all is the caller's decision,
 * and it does not - `loadReport` has already said `turn 80 stored for history; still showing turn
 * 83.` in its own words, and a second line would repeat it (the navigator, E3).
 *
 * Singular below two, in both halves. `workingTurn` is `null` only when no report is on screen,
 * which the dialog cannot be opened from - the clause is then dropped rather than saying
 * `turn null`.
 */
export function runSummary(
  storedCount: number,
  failedCount: number,
  workingTurn: number | null
): StatusLine {
  const tail = stillShowing(workingTurn);
  const turns = (count: number): string => `${count} turn${count === 1 ? "" : "s"}`;
  if (storedCount === 0) {
    return failedStatus(`no turns could be fetched${tail}`);
  }
  if (failedCount === 0) {
    return noticeStatus(`${turns(storedCount)} stored for history${tail}`);
  }
  return warningStatus(
    `${turns(storedCount)} stored for history, ${failedCount} could not be fetched${tail}`
  );
}
