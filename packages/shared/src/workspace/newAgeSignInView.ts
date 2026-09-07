/**
 * What the New Age sign-in says, decided apart from how it is drawn.
 *
 * Split out for the reason `sendOrdersView.ts` gives: this package has no jsdom, so a rule that
 * depends on what the player has typed can only be pinned by a test when it lives in a pure
 * module. The strings are the ones the navigator approved on ah-lbd9.2 and are quoted, not
 * paraphrased.
 *
 * Nothing here ever renders a reply body: a New Age reply can carry a password in cleartext, so a
 * failure becomes one of six sentences and never the server's own words, except for the `detail`
 * of a refusal, which `newAgeApi.ts` has already redacted.
 */

import { NEW_AGE_API_ORIGIN, type NewAgeFailure } from "./newAgeApi";

/**
 * Where the sign-in has got to. `failed` carries a sentence and never a reply body.
 *
 * `retype` says whether the password should be cleared and refocused: true when the world refused
 * the credentials, false when it was never reached - an unreachable world says nothing about the
 * password. Carried on the phase rather than derived by matching the message, so the dialog never
 * compares strings to decide what to do.
 */
export type NewAgeSignInPhase =
  | { kind: "ready" }
  | { kind: "signingIn" }
  | { kind: "failed"; message: string; retype: boolean };

/** The host every sentence here names, from `NEW_AGE_API_ORIGIN` rather than typed out again. */
export const NEW_AGE_HOST: string = new URL(NEW_AGE_API_ORIGIN).host;

/**
 * Under the password field. `action` is the word the dialog's own verb uses.
 *
 * A credential is held for the length of one call and not beyond it, so this says what is true of
 * that call rather than of a session, which no longer exists.
 */
export function credentialNote(action: "fetch" | "send"): string {
  return `Used for this ${action} only. Nothing is written to this machine.`;
}

/** The one sentence for a faction number that is not digits, said in this surface's vocabulary. */
const DIGITS_ONLY = "A faction number is digits only.";

/**
 * Why this faction number cannot be sent as written, or nothing.
 *
 * A blank field the player has not finished typing in is not nagged at, which is the distinction
 * `passwordProblem`'s own `blankIsAProblem` already draws.
 */
export function factionNumberProblem(
  factionNumber: string,
  { blankIsAProblem = true }: { blankIsAProblem?: boolean } = {}
): string | null {
  if (factionNumber.trim() === "") {
    return blankIsAProblem ? "A faction number cannot be empty." : null;
  }
  if (!/^\d+$/.test(factionNumber.trim())) {
    return DIGITS_ONLY;
  }
  return null;
}

/** `atlantis-newage.com · turn 83`, or just the host when no report is loaded. */
export function signInMetaLine(host: string, turnNumber: number | null): string {
  return turnNumber === null ? host : `${host} · turn ${turnNumber}`;
}

/**
 * The one sentence for a failure, and whether the password should be retyped.
 *
 * A `switch` with no `default`, so a sixth `NewAgeFailure` kind fails the typecheck here rather
 * than falling through to a blank message in front of a player. The `unsendable` arm repeats the
 * digits sentence rather than passing `failure.reason` through: the client's own reason says *id*
 * where this surface says *number*, and the dialog refuses that case before calling at all.
 */
export function signInFailure(
  failure: NewAgeFailure,
  host: string,
  { nothingSent = true }: { nothingSent?: boolean } = {}
): { message: string; retype: boolean } {
  switch (failure.kind) {
    case "unauthorized":
      return {
        message: "The world did not accept that faction number and password.",
        retype: true
      };
    case "unreachable":
      return {
        message: nothingSent ? `Could not reach ${host}. Nothing was sent.` : `Could not reach ${host}.`,
        retype: false
      };
    case "refused":
      return {
        message:
          failure.detail === null
            ? `The world refused the sign-in (${failure.status}).`
            : `The world refused the sign-in: ${failure.detail}`,
        retype: false
      };
    case "unreadable":
      return { message: "The world answered something Atlantis HUD could not read.", retype: false };
    case "unsendable":
      return { message: DIGITS_ONLY, retype: false };
  }
}
