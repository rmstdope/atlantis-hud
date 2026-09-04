/**
 * What fetching a New Age turn report says, decided apart from how it is drawn.
 *
 * Split out for the reason `newAgeSignInView.ts` and `sendOrdersView.ts` both give: this package
 * has no jsdom, so a rule is only testable by a unit test when it lives in a pure module.
 *
 * Nothing here ever renders a reply body. A New Age reply can carry a password in cleartext, so a
 * failure becomes one of five sentences and never the server's own words, except for the `detail`
 * of a refusal, which `newAgeApi.ts` has already redacted.
 */

import type { NewAgeFailure } from "./newAgeApi";
import { SESSION_ENDED, type NewAgeSignInPhase } from "./newAgeSignInView";

/**
 * Where a fetch has got to, or `null` when none is running.
 *
 * `reauth` is the whole of the expiry path: the world answered 401, this game's session has been
 * forgotten, and the sign-in dialog is up carrying its own phase. There is no `failed` kind -
 * every other failure is a status line, not a state.
 */
export type NewAgeFetchPhase =
  | { kind: "fetching" }
  | { kind: "reauth"; signIn: NewAgeSignInPhase };

/** The popover item, when nothing is running. */
export const FETCH_REPORT_ITEM = "Fetch this turn's report";

/** The popover item, while a fetch is in flight. Disabled, and it does not change width much. */
export const FETCH_REPORT_ITEM_BUSY = "Fetching…";

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
 * rather than a blank line in front of a player. The `unauthorized` arm exists for that
 * exhaustiveness and is not reached: the shell branches on that kind before asking.
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
      return "your session has ended";
  }
}

/** The heading, notice and buttons the sign-in dialog wears when a fetch ran the session out. */
export const FETCH_REAUTH_PURPOSE: {
  heading: string;
  notice: string;
  confirmLabel: string;
  ariaLabel: string;
} = {
  heading: FETCH_REPORT_ITEM,
  notice: SESSION_ENDED,
  confirmLabel: "Sign in and fetch",
  ariaLabel: "Sign in again to fetch a report"
};
