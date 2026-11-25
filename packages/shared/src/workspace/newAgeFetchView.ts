/**
 * What fetching from a New Age world says, decided apart from how it is drawn.
 *
 * Split out for the reason `newAgeSignInView.ts` and `sendOrdersView.ts` both give: this package
 * has no jsdom, so a rule is only testable by a unit test when it lives in a pure module.
 *
 * Nothing here ever renders a reply body. A New Age reply can carry a password in cleartext, so a
 * failure becomes one of five sentences and never the server's own words, except for the `detail`
 * of a refusal, which `newAgeApi.ts` has already redacted.
 */

import type { NewAgeFailure } from "./newAgeApi";
import { historyListing, runSummary } from "./newAgeHistoryView";
import { factionNumberProblem } from "./newAgeSignInView";
import { newerTurnQuestion, stillShowing } from "./newOriginsFetchView";
import { noticeStatus, type StatusLine } from "./shellStatus";
import { passwordProblem } from "./sendOrdersView";

/** What Fetch was asked to bring. Resets to `thisTurn` on every open (the navigator, round 3). */
export type NewAgeFetchScope = "thisTurn" | "thisTurnAndHistory";

/**
 * Where the Fetch dialog has got to, or `null` when it is closed.
 *
 * `ready` is the only phase with live fields. `message` is a refusal sentence or nothing, and
 * `retype` says whether the password should be cleared and refocused - carried on the phase rather
 * than derived by matching the message, the rule `NewAgeSignInPhase` already set.
 */
export type NewAgeFetchPhase =
  | { kind: "ready"; message: string | null; retype: boolean }
  | { kind: "signingIn" }
  | { kind: "fetchingReport" }
  | { kind: "listing" }
  | { kind: "fetchingTurn"; turnNumber: number; done: number; total: number }
  | NewAgeAskPhase;

/**
 * The question asked once the report is in and would replace the turn on screen (ah-1y7yi).
 *
 * Only turn numbers and counts: the report the question is about is held in the shell's own ref,
 * the rule `NewOriginsFetchPhase` set, so this stays a module about words. `earlierStored` and
 * `notFetched` are both 0 for a "Latest report" fetch; an "All reports" run fills them in, since
 * it asks once, after every earlier turn has already been stored.
 */
export type NewAgeAskPhase =
  | {
      kind: "askNewer";
      currentTurn: number;
      incomingTurn: number;
      earlierStored: number;
      notFetched: number;
    }
  | { kind: "askSame"; turnNumber: number; earlierStored: number; notFetched: number };

/** The header control. There is no signed-in state to name, so it never says anything else. */
export const FETCH_CONTROL_LABEL = "Fetch";
export const FETCH_CONFIRM = "Fetch";
export const FETCH_SIGNING_IN = "Signing in…";
export const FETCH_SCOPE_THIS_TURN = "Latest report";
export const FETCH_SCOPE_WITH_HISTORY = "All reports not yet fetched/imported";

/**
 * A 401 seconds after a successful login: a world changing its mind rather than an expiry, so it
 * stops the run instead of asking for the password a second time.
 */
export const FETCH_REFUSED_MID_RUN =
  "The world stopped accepting that faction number and password.";

/** `Fetch from New Age: Arcanum` - from the ruleset's own label, as `signInTitle` did. */
export function fetchDialogTitle(rulesetLabel: string): string {
  return `Fetch from ${rulesetLabel}`;
}

/** `Fetching this turn's report from Arcanum…` - the routine status while it is in flight. */
export function fetchingStatus(worldName: string): string {
  return `Fetching this turn's report from ${worldName}…`;
}

/**
 * `this turn's report from Arcanum` - what `loadReport` is given in place of a file name.
 *
 * It reaches the player only inside `runReported`'s prefix, as
 * `could not read this turn's report from Arcanum: <why>`, which is exactly how a file that would
 * not parse already reads.
 */
export function fetchedReportName(worldName: string): string {
  return `this turn's report from ${worldName}`;
}

/** In front of every fetch failure: `could not fetch this turn's report`. */
export const FETCH_FAILURE_PREFIX = "could not fetch this turn's report";

/**
 * Why the fetch produced no report, as the second half of that line - lower case, no full stop,
 * the shape `judgeReportUsable`'s reasons already have.
 *
 * Exhaustive over `NewAgeFailure` with no `default`, so a sixth kind is a typecheck failure here
 * rather than a blank line in front of a player.
 */
export function fetchFailureReason(failure: NewAgeFailure, host: string): string {
  switch (failure.kind) {
    case "unreachable":
      return `could not reach ${host}`;
    case "unreadable":
      return "the world has no report for you yet";
    case "refused":
      return failure.detail === null
        ? `the world refused the request (${failure.status})`
        : `the world refused the request: ${failure.detail}`;
    case "unsendable":
      return "the request could not be sent";
    case "unauthorized":
      return "the world did not accept that faction number and password";
  }
}

/** `Fetching turn 80 from Arcanum — 3 of 9…`. An em dash, as the mockup has it. */
export function fetchingTurnProgress(
  turnNumber: number,
  worldName: string,
  done: number,
  total: number
): string {
  return `Fetching turn ${turnNumber} from ${worldName} — ${done + 1} of ${total}…`;
}

/**
 * The one line the dialog shows in place of its fields, or `null` in `ready`.
 *
 * Exhaustive `switch` with no `default`, the rule every view module here follows.
 */
export function fetchWorkingLine(phase: NewAgeFetchPhase, worldName: string): string | null {
  switch (phase.kind) {
    case "ready":
      return null;
    case "signingIn":
      return FETCH_SIGNING_IN;
    case "fetchingReport":
      return fetchingStatus(worldName);
    case "listing":
      return historyListing(worldName);
    case "fetchingTurn":
      return fetchingTurnProgress(phase.turnNumber, worldName, phase.done, phase.total);
    case "askNewer":
    case "askSame":
      // The question takes the working line's place; the dialog draws it, not this.
      return null;
  }
}

/** `1 turn` / `2 turns`. */
function turnCount(count: number): string {
  return `${count} turn${count === 1 ? "" : "s"}`;
}

/**
 * The newer-turn question. With nothing counted it is the New Origins sentence word for word; an
 * "All reports" run counts its earlier turns, and any it could not fetch, rather than listing turn
 * numbers - a list breaks down once the earlier turns include gaps before the one on screen.
 */
export function newAgeNewerTurnQuestion(
  phase: Extract<NewAgeAskPhase, { kind: "askNewer" }>
): string {
  const { currentTurn, incomingTurn, earlierStored, notFetched } = phase;
  if (earlierStored === 0 && notFetched === 0) {
    return newerTurnQuestion(currentTurn, incomingTurn);
  }
  const arrived =
    earlierStored === 0
      ? `Turn ${incomingTurn} has arrived.`
      : `Turn ${incomingTurn} has arrived, along with ${earlierStored} earlier turn${earlierStored === 1 ? ", which is" : "s, which are"} stored for history.`;
  const failed = notFetched === 0 ? "" : ` ${turnCount(notFetched)} could not be fetched.`;
  return `${arrived}${failed} Opening turn ${incomingTurn} replaces turn ${currentTurn} on screen. Your notes come with you, and your turn ${currentTurn} orders are kept.`;
}

/** `Trident still has turn 21 — …` - the same-turn question, naming the world. */
export function newAgeSameTurnQuestion(worldName: string, turnNumber: number): string {
  return `${worldName} still has turn ${turnNumber} — the turn you already have. Loading it again refreshes the report on screen. Your orders and notes stay as they are.`;
}

/**
 * The status line after `Keep turn N` / `Keep what I have`, or `null` when the line the store
 * itself writes - `turn 22 stored for history; still showing turn 21.` - is already the right one.
 *
 * After an "All reports" run the newest turn is counted with the earlier ones, in `runSummary`'s
 * words, so the line agrees with the question that was just answered.
 */
export function newAgeKeepStatus(phase: NewAgeAskPhase): StatusLine | null {
  if (phase.kind === "askNewer") {
    // The newer-turn question named the failures, so the line after it counts them too.
    return phase.earlierStored > 0 || phase.notFetched > 0
      ? runSummary(phase.earlierStored + 1, phase.notFetched, phase.currentTurn)
      : null;
  }
  return sameTurnRunSummary(phase) ?? noticeStatus(stillShowing(phase.turnNumber));
}

/**
 * The run's own line after the same-turn question, or `null` for the agreed one. Only when earlier
 * turns were stored: with none, `runSummary` would read "no turns could be fetched" in red and,
 * after Load it again, cover the line saying the reload happened.
 */
function sameTurnRunSummary(
  phase: Extract<NewAgeAskPhase, { kind: "askSame" }>
): StatusLine | null {
  return phase.earlierStored > 0
    ? runSummary(phase.earlierStored, phase.notFetched, phase.turnNumber)
    : null;
}

/**
 * The status line after `Open turn M` / `Load it again`, or `null` when the load's own
 * `turn 22 loaded — 14 regions, 37 units.` stands. The same-turn question leaves its earlier
 * turns uncounted, so they are reported here, after the answer.
 */
export function newAgeOpenStatus(phase: NewAgeAskPhase): StatusLine | null {
  return phase.kind === "askNewer" ? null : sameTurnRunSummary(phase);
}

/**
 * Whether the fields can be sent as they stand. `ready` only.
 *
 * `passwordProblem` rather than a bare blank test: a password bound for the `#atlantis` header
 * must carry neither a double quote nor a line break, and the send path already asks this.
 */
export function newAgeFetchIsReady(
  factionNumber: string,
  password: string,
  phase: NewAgeFetchPhase
): boolean {
  return (
    phase.kind === "ready" &&
    passwordProblem(password, { blankIsAProblem: true }) === null &&
    factionNumberProblem(factionNumber, { blankIsAProblem: true }) === null
  );
}
