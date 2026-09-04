/**
 * What a New Age send says, decided apart from how it is drawn.
 *
 * Split out for the reason `sendOrdersView.ts` and `newAgeSignInView.ts` both give: this package
 * has no jsdom, so a rule that depends on what the world answered or what the player has typed can
 * only be pinned by a test when it lives in a pure module. The strings are the ones the navigator
 * approved on ah-lbd9.4 and are quoted, not paraphrased.
 *
 * Nothing here renders a reply body. The one place the world's own prose reaches a player is
 * `newAgeSendWorldMessage`, and `newAgeApi.ts` has already dropped `raw_output` and redacted every
 * remaining string before it gets here.
 */

import type { NewAgeOrderVerdict } from "./newAgeApi";
import {
  NEW_AGE_HOST,
  factionNumberProblem,
  type NewAgeSignInPhase
} from "./newAgeSignInView";
import { passwordProblem } from "./sendOrdersView";

/**
 * Where a New Age send has got to, or `null` when the dialog is closed.
 *
 * `ready.notice` is the expiry path: a sentence shown above the fields when the token ran out
 * mid-send. It is not a failure - nothing was refused, and the fields are live.
 *
 * `verdict` is neither a success nor a failure on its own. `saved` and `valid` are independent:
 * ask `newAgeSendSettles` and `newAgeSendAsksRetype`, never `verdict.valid` directly.
 */
export type NewAgeSendPhase =
  | { kind: "ready"; notice: string | null }
  | { kind: "signingIn" }
  | { kind: "sending" }
  | { kind: "failed"; message: string; retype: boolean }
  | { kind: "unreachable" }
  | { kind: "verdict"; verdict: NewAgeOrderVerdict };

/**
 * What one attempt produced, before the shell decides what to do about it.
 *
 * `expired` is a state of the *session* rather than of the dialog, which is why it is here and not
 * in `NewAgeSendPhase`: the shell drops the session and puts the dialog back to `ready` with a
 * notice. A phase that must never be stored would be a trap.
 */
export type NewAgeSendOutcome =
  | { kind: "verdict"; verdict: NewAgeOrderVerdict }
  | { kind: "unreachable" }
  | { kind: "expired" }
  | { kind: "failed"; message: string; retype: boolean };

/** How loudly a sentence reads. Mapped to a class by the dialog and nowhere else. */
export type NewAgeSendTone = "soft" | "ok" | "warn" | "danger";

/** `These orders cannot be sent as they are written.` */
export const NEW_AGE_ORDERS_UNSENDABLE = "These orders cannot be sent as they are written.";

/** The world took nothing: the password in the `#atlantis` line is the likeliest reason. */
export const NEW_AGE_NOT_SAVED =
  "The world did not save these orders. Check the faction password and try again.";

/**
 * A reply nobody could read claims nothing about what happened to the orders.
 *
 * The request may well have gone through - only the answer was unreadable - so saying either thing
 * definitely would be a guess.
 */
export const NEW_AGE_VERDICT_UNREADABLE =
  "The world answered something Atlantis HUD could not read. Your orders may or may not have been saved.";

/** Named for the host, so nothing types `atlantis-newage.com` a second time. */
export const NEW_AGE_SEND_UNREACHABLE = `Could not reach ${NEW_AGE_HOST}. Your orders were not sent — export them to a file if the turn is due.`;

/** `Send orders to Arcanum` - the dialog's heading, from the world's one short word. */
export function newAgeSendTitle(worldName: string): string {
  return `Send orders to ${worldName}`;
}

/** `Send`, or `Sign in and send` when the faction number is being asked for too. */
export function newAgeSendConfirmLabel(asksSignIn: boolean): string {
  return asksSignIn ? "Sign in and send" : "Send";
}

/** `The world refused the orders: ` + the detail, or `(` + the status + `)` when it gave none. */
export function newAgeSendRefused(status: number, detail: string | null): string {
  return detail === null
    ? `The world refused the orders (${status}).`
    : `The world refused the orders: ${detail}`;
}

/** Whether these fields can be sent as they stand. */
export function newAgeSendIsReady(
  asksSignIn: boolean,
  factionNumber: string,
  password: string,
  phase: NewAgeSendPhase
): boolean {
  if (phase.kind === "signingIn" || phase.kind === "sending" || newAgeSendSettles(phase)) {
    return false;
  }
  if (passwordProblem(password) !== null) {
    return false;
  }
  return !asksSignIn || factionNumberProblem(factionNumber) === null;
}

/** The phase `NewAgeSignInFields` should wear: busy while anything is in flight, else ready. */
export function newAgeSendFieldsPhase(phase: NewAgeSendPhase): NewAgeSignInPhase {
  return phase.kind === "signingIn" || phase.kind === "sending"
    ? { kind: "signingIn" }
    : { kind: "ready" };
}

/** Whether there is nothing further to do here, so the footer collapses to a single Close. */
export function newAgeSendSettles(phase: NewAgeSendPhase): boolean {
  return phase.kind === "unreachable" || (phase.kind === "verdict" && phase.verdict.saved);
}

/** Whether the password should be cleared and refocused, because retyping it is the fix. */
export function newAgeSendAsksRetype(phase: NewAgeSendPhase): boolean {
  if (phase.kind === "failed") {
    return phase.retype;
  }
  return phase.kind === "verdict" && !phase.verdict.saved;
}

/**
 * How many errors to name, and whether there are any at all.
 *
 * `errorCount` and `valid` are independent in the served spec and either can be the only evidence,
 * so the count falls back to the list's own length and "has errors" asks both.
 */
function errorTally(verdict: NewAgeOrderVerdict): { shownCount: number; hasErrors: boolean } {
  const shownCount = verdict.errorCount > 0 ? verdict.errorCount : verdict.errors.length;
  return { shownCount, hasErrors: !verdict.valid || shownCount > 0 };
}

/** `Orders for turn 84`, or `Orders` when no turn is known. Nothing else in a sentence moves. */
function subject(turnNumber: number | null): string {
  return turnNumber === null ? "Orders" : `Orders for turn ${turnNumber}`;
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/** The one sentence for this phase and how loudly it reads, or nothing while it is still asking. */
export function newAgeSendOutcome(
  phase: NewAgeSendPhase,
  turnNumber: number | null
): { text: string; tone: NewAgeSendTone } | null {
  switch (phase.kind) {
    case "ready":
      return null;
    case "signingIn":
      return { text: "Signing in…", tone: "soft" };
    case "sending":
      return { text: "Sending orders…", tone: "soft" };
    case "failed":
      return { text: phase.message, tone: "danger" };
    case "unreachable":
      return { text: NEW_AGE_SEND_UNREACHABLE, tone: "danger" };
    case "verdict": {
      const verdict = phase.verdict;
      if (!verdict.saved) {
        return { text: NEW_AGE_NOT_SAVED, tone: "danger" };
      }
      const { shownCount, hasErrors } = errorTally(verdict);
      if (hasErrors && shownCount > 0) {
        return {
          text: `${subject(turnNumber)} were saved, but the world found ${shownCount} ${plural(shownCount, "error", "errors")} in them.`,
          tone: "warn"
        };
      }
      if (hasErrors) {
        return {
          text: `${subject(turnNumber)} were saved, but the world found errors in them.`,
          tone: "warn"
        };
      }
      if (verdict.warnings.length > 0) {
        const count = verdict.warnings.length;
        return {
          text: `${subject(turnNumber)} were saved. The world found no errors, but raised ${count} ${plural(count, "warning", "warnings")}.`,
          tone: "ok"
        };
      }
      return {
        text: `${subject(turnNumber)} were saved. The world found nothing wrong with them.`,
        tone: "ok"
      };
    }
  }
}

/** The world's own errors, or an empty list. */
export function newAgeSendErrors(phase: NewAgeSendPhase): readonly string[] {
  return phase.kind === "verdict" ? phase.verdict.errors : [];
}

/** The world's own warnings, or an empty list. */
export function newAgeSendWarnings(phase: NewAgeSendPhase): readonly string[] {
  return phase.kind === "verdict" ? phase.verdict.warnings : [];
}

/**
 * The world's own `message`, but only when it is the only explanation there is.
 *
 * Shown when both lists are empty and the outcome is not the clean one - which is the refused-
 * outright case, where the API returns nothing else. Never alongside a list, so it cannot repeat
 * what is already set out above it. The prose can be in Russian; the navigator was shown that and
 * chose to keep it, because a refusal nobody anticipated is worse with no explanation at all.
 */
export function newAgeSendWorldMessage(phase: NewAgeSendPhase): string | null {
  if (phase.kind !== "verdict") {
    return null;
  }
  const verdict = phase.verdict;
  if (verdict.errors.length > 0 || verdict.warnings.length > 0) {
    return null;
  }
  const clean = verdict.saved && !errorTally(verdict).hasErrors;
  if (clean || verdict.message.trim() === "") {
    return null;
  }
  return verdict.message;
}
