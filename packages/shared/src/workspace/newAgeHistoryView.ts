/**
 * What the earlier-turns dialog says, and every rule about what a row means, decided apart from
 * how it is drawn.
 *
 * Split out for the reason `newAgeSignInView.ts`, `sendOrdersView.ts` and `newAgeFetchView.ts` all
 * give: this package has no jsdom (ah-nass), so a rule is only testable by a unit test when it
 * lives in a pure module.
 *
 * Nothing here renders a reply body. A New Age reply can carry a password in cleartext, so a
 * failure becomes one of six short phrases and never the server's own words.
 */

import type { NewAgeFailure } from "./newAgeApi";
import { SESSION_ENDED, type NewAgeSignInPhase } from "./newAgeSignInView";
import { failedStatus, noticeStatus, warningStatus, type StatusLine } from "./shellStatus";

/** Where the turn dialog has got to, or `null` when it is closed. */
export type NewAgeHistoryPhase =
  | { kind: "listing" }
  /** The world answered, and named no turn this game does not already have. */
  | { kind: "empty" }
  /** The listing call itself failed. `message` is the whole sentence, ready to draw. */
  | { kind: "listFailed"; message: string }
  | {
      kind: "ready";
      /** Every turn the world listed, as it listed them. */
      worldTurns: readonly number[];
      /** Turns this visit has fetched and stored, so a row reads `stored` with no reload. */
      fetched: readonly number[];
      /** Why a row failed, this visit. Keyed by turn number. */
      failures: ReadonlyMap<number, string>;
      /** The run in progress, or null when nothing is in flight. */
      run: { turnNumber: number; done: number; total: number } | null;
    }
  /**
   * The session ran out mid-fetch. The dialog stays mounted behind the sign-in dialog, and
   * `remaining` is what the run still owed - signing in resumes exactly that (the navigator, E2).
   */
  | {
      kind: "reauth";
      signIn: NewAgeSignInPhase;
      behind: Extract<NewAgeHistoryPhase, { kind: "ready" }>;
      remaining: readonly number[];
    };

/** What one row of the list is. */
export type HistoryRowState =
  | { kind: "playing" }
  | { kind: "stored" }
  | { kind: "missing" }
  | { kind: "fetching" }
  | { kind: "failed"; reason: string };

export type HistoryRow = {
  turnNumber: number;
  /**
   * The season, when the game holds this turn. `null` - drawn as an em dash - when only the world
   * knows of it: the world's list is turn numbers and nothing else.
   */
  season: string | null;
  state: HistoryRowState;
};

/** The popover item that opens the dialog. Plural: the dialog behind it takes more than one. */
export const HISTORY_ITEM = "Fetch earlier turns…";

/** Under the heading, so nobody fears their screen is about to change. */
export const HISTORY_BLURB =
  "A fetched turn is stored for comparison. What is on screen does not change.";

export const HISTORY_CLOSE = "Close";
export const HISTORY_RETRY = "Try again";

/** A row's mark when the game would not store what the world gave. Not a `NewAgeFailure`. */
export const HISTORY_NOT_STORED = "not stored";

export function historyTitle(worldName: string): string {
  return `Earlier turns on ${worldName}`;
}

export function historyListing(worldName: string): string {
  return `Asking ${worldName} which turns it holds…`;
}

export function historyEmpty(worldName: string): string {
  return `${worldName} holds no earlier turns for you.`;
}

export function historyListFailed(worldName: string, reason: string): string {
  return `${worldName} would not say which turns it holds: ${reason}.`;
}

/**
 * A row's failure mark: a short phrase, not the whole sentence. A 24rem dialog has no room for
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

/** `Fetch 1 missing`, `Fetch all 4 missing`. */
export function fetchAllLabel(missingCount: number): string {
  return missingCount === 1 ? "Fetch 1 missing" : `Fetch all ${missingCount} missing`;
}

/** `Fetching 2 of 3…` - `done` is how many have been attempted before this one. */
export function runningLabel(done: number, total: number): string {
  return `Fetching ${done + 1} of ${total}…`;
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
 * The rows to draw, turn ascending - the order `TurnPicker` and `sortImportedTurnSummaries` both
 * use.
 *
 * `stored` beats `missing`, `playing` beats `stored`, and an in-flight or failed turn beats both:
 * a row says what is happening to it now, and what it is otherwise.
 */
export function historyRows(
  phase: Extract<NewAgeHistoryPhase, { kind: "ready" }>,
  stored: readonly { turnNumber: number; season: string | null }[],
  workingTurn: number | null
): HistoryRow[] {
  const seasons = new Map(stored.map((entry) => [entry.turnNumber, entry.season]));
  const fetched = new Set(phase.fetched);
  return [...phase.worldTurns]
    .sort((left, right) => left - right)
    .map((turnNumber) => ({
      turnNumber,
      season: seasons.has(turnNumber) ? (seasons.get(turnNumber) ?? null) : null,
      state: rowState(phase, seasons, fetched, turnNumber, workingTurn)
    }));
}

function rowState(
  phase: Extract<NewAgeHistoryPhase, { kind: "ready" }>,
  seasons: ReadonlyMap<number, string | null>,
  fetched: ReadonlySet<number>,
  turnNumber: number,
  workingTurn: number | null
): HistoryRowState {
  if (phase.run !== null && phase.run.turnNumber === turnNumber) {
    return { kind: "fetching" };
  }
  const failure = phase.failures.get(turnNumber);
  if (failure !== undefined) {
    return { kind: "failed", reason: failure };
  }
  if (turnNumber === workingTurn) {
    return { kind: "playing" };
  }
  return seasons.has(turnNumber) || fetched.has(turnNumber) ? { kind: "stored" } : { kind: "missing" };
}

/**
 * The turns a `Fetch all missing` press would ask for, turn ascending: every listed turn that is
 * neither the working turn nor already stored. A turn that failed earlier this visit is missing
 * again, so pressing the button retries it.
 */
export function missingTurns(
  phase: Extract<NewAgeHistoryPhase, { kind: "ready" }>,
  stored: readonly { turnNumber: number }[],
  workingTurn: number | null
): number[] {
  const held = new Set([...stored.map((entry) => entry.turnNumber), ...phase.fetched]);
  return [...phase.worldTurns]
    .sort((left, right) => left - right)
    .filter(
      (turnNumber) =>
        turnNumber !== workingTurn && (phase.failures.has(turnNumber) || !held.has(turnNumber))
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
  const tail = workingTurn === null ? "." : `; still showing turn ${workingTurn}.`;
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

/** The heading, notice and buttons the sign-in dialog wears when a history fetch ran out. */
export const HISTORY_REAUTH_PURPOSE: {
  heading: string;
  notice: string;
  confirmLabel: string;
  ariaLabel: string;
} = {
  // Singular: it is up because one turn failed.
  heading: "Fetch an earlier turn",
  notice: SESSION_ENDED,
  confirmLabel: "Sign in and fetch",
  ariaLabel: "Sign in again to fetch an earlier turn"
};
