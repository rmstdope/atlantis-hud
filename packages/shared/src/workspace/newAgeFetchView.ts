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
import { historyListing } from "./newAgeHistoryView";
import { factionNumberProblem } from "./newAgeSignInView";
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
  | { kind: "fetchingTurn"; turnNumber: number; done: number; total: number };

/** The header control. There is no signed-in state to name, so it never says anything else. */
export const FETCH_CONTROL_LABEL = "Fetch";
export const FETCH_CONFIRM = "Fetch";
export const FETCH_SIGNING_IN = "Signing in…";
export const FETCH_SCOPE_THIS_TURN = "This turn's report";
export const FETCH_SCOPE_WITH_HISTORY = "This turn's report and every earlier turn not yet loaded";

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
  }
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
