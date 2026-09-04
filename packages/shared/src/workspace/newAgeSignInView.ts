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

import { NEW_AGE_API_ORIGIN, type NewAgeFaction, type NewAgeFailure } from "./newAgeApi";

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

/** Under the fields, in every frame this is embedded in. */
export const SIGN_IN_NOTE = "Kept only while the app is open. Nothing is written to this machine.";

/** The popover's second line. */
export const SIGNED_OUT_ON_CLOSE = "Nothing is stored: closing Atlantis HUD signs you out.";

/** What a caller shows when a call came back `unauthorized` - `ah-lbd9.3` and `.4` embed this. */
export const SESSION_ENDED = "Your session has ended. Sign in again to continue.";

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

/** `Sign in to New Age: Arcanum` - the dialog's heading, from the ruleset's own label. */
export function signInTitle(rulesetLabel: string): string {
  return `Sign in to ${rulesetLabel}`;
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
  host: string
): { message: string; retype: boolean } {
  switch (failure.kind) {
    case "unauthorized":
      return {
        message: "The world did not accept that faction number and password.",
        retype: true
      };
    case "unreachable":
      return { message: `Could not reach ${host}. Nothing was sent.`, retype: false };
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

/** `Sign in to Arcanum` - the header control, signed out. */
export function signedOutLabel(worldName: string): string {
  return `Sign in to ${worldName}`;
}

/** The faction's own name when it has one, else `Faction <id>`. */
function factionName(faction: NewAgeFaction): string | null {
  return faction.name.trim() === "" ? null : faction.name.trim();
}

/** `Merchant Guild` - the header control, signed in. Falls back to the id when there is no name. */
export function signedInLabel(faction: NewAgeFaction): string {
  return factionName(faction) ?? `Faction ${faction.id}`;
}

/** `Merchant Guild (27)` - the faction as the popover names it. */
export function factionLabelOfNewAge(faction: NewAgeFaction): string {
  const name = factionName(faction);
  return name === null ? `Faction ${faction.id}` : `${name} (${faction.id})`;
}

/** `Signed in to New Age: Arcanum as Merchant Guild (27).` */
export function signedInSummary(rulesetLabel: string, faction: NewAgeFaction): string {
  return `Signed in to ${rulesetLabel} as ${factionLabelOfNewAge(faction)}.`;
}

/** Whether these two fields can be sent as they stand. */
export function signInIsReady(
  factionNumber: string,
  password: string,
  phase: NewAgeSignInPhase
): boolean {
  return (
    phase.kind !== "signingIn" &&
    password.trim() !== "" &&
    factionNumberProblem(factionNumber, { blankIsAProblem: true }) === null
  );
}
