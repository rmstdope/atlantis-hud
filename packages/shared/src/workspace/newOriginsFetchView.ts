/**
 * Every sentence the New Origins fetch dialog can show, and what an arriving report should do.
 *
 * Pure, and separate from the component for the reason `newAgeFetchView.ts` gives and
 * `.cerebro/traps.md` repeats: `packages/shared` has no jsdom, so a rule is only testable when it
 * lives outside a component.
 */

import {
  decideReportLoad,
  type LoadedReportIdentity
} from "../reportLoadDecision";
import { factionNumberProblem } from "./newAgeSignInView";

/**
 * Where the dialog has got to, or `null` when it is closed.
 *
 * `ready` is the only phase with live fields; `message` is a failure sentence or nothing, and
 * `retype` says whether the password should be cleared and refocused - carried on the phase rather
 * than derived by matching a string, the rule `NewAgeFetchPhase` set.
 *
 * The two `ask` phases carry only turn numbers. The report they are about is held in the shell's
 * own ref, so this module never imports a `ParsedReport` and stays a module about words.
 */
export type NewOriginsFetchPhase =
  | { kind: "ready"; message: string | null; retype: boolean }
  | { kind: "fetching" }
  | { kind: "askNewer"; currentTurn: number; incomingTurn: number }
  | { kind: "askSame"; turnNumber: number };

// `FETCH_CONFIRM` is not redefined here: `newAgeFetchView.ts` already owns the one `Fetch` this
// application's fetch dialogs confirm with, the way both dialogs share `FETCH_CONTROL_LABEL`.
export const FETCH_DIALOG_TITLE = "Fetch from New Origins";
export const FETCH_WORKING = "Fetching this turn's report from New Origins…";

/** The refusal shown when the site's own page carries no sentence of its own. */
export const REFUSED_WITHOUT_A_SENTENCE =
  "New Origins would not give up this turn's report. Check the faction number and password.";

/** The transport could not reach the site at all. */
export const UNREACHABLE = "Could not reach atlantis-pbem.com.";

/** Something came back that is not a report this application can read. */
export const UNREADABLE =
  "atlantis-pbem.com answered with something Atlantis HUD could not read. The site may have changed — downloading the report in a browser and dropping it here still works.";

/**
 * `Merchant Guild (27) · turn 83 · atlantis-pbem.com` - each part dropped when unknown, down to
 * the address alone.
 *
 * The faction is one part, not two: it is shown only when the name AND the number are both known,
 * because `(27)` alone reads as a typo and a bare number would need a word this design never
 * agreed. Turn and host are their own parts.
 */
export function fetchMetaLine(known: {
  factionName: string | null;
  factionNumber: string | null;
  turnNumber: number | null;
  host: string;
}): string {
  const parts: string[] = [];
  if (known.factionName !== null && known.factionNumber !== null) {
    parts.push(`${known.factionName} (${known.factionNumber})`);
  }
  if (known.turnNumber !== null) {
    parts.push(`turn ${known.turnNumber}`);
  }
  parts.push(known.host);
  return parts.join(" · ");
}

/** `this turn's report from New Origins` - what `loadReport` is given in place of a file name. */
export const FETCHED_REPORT_NAME = "this turn's report from New Origins";

/** `Turn 84 has arrived. …` - the newer-turn question. */
export function newerTurnQuestion(currentTurn: number, incomingTurn: number): string {
  return `Turn ${incomingTurn} has arrived. Opening it replaces turn ${currentTurn} on screen, and anything you have changed since it was loaded.`;
}

/** `Keep turn 83` */
export function keepTurnLabel(currentTurn: number): string {
  return `Keep turn ${currentTurn}`;
}

/** `Open turn 84` */
export function openTurnLabel(incomingTurn: number): string {
  return `Open turn ${incomingTurn}`;
}

/** `New Origins still has turn 83 — …` - the same-turn question. */
export function sameTurnQuestion(turnNumber: number): string {
  return `New Origins still has turn ${turnNumber} — the turn you already have. Loading it again replaces what is on screen, and anything you have changed since.`;
}

export const KEEP_WHAT_I_HAVE = "Keep what I have";
export const LOAD_IT_AGAIN = "Load it again";

/**
 * `turn 84 loaded — 4 regions, 11 units.`
 *
 * Written over `countsStatus` by a fetch alone: the player was just asked a question about turn
 * numbers, and it would be strange for the answer not to name the one they chose. Pluralised the
 * way `countsStatus` pluralises, so the two lines can never disagree about one region.
 */
export function loadedStatus(turnNumber: number, regionCount: number, unitCount: number): string {
  return `turn ${turnNumber} loaded — ${regionCount} region${regionCount === 1 ? "" : "s"}, ${unitCount} unit${unitCount === 1 ? "" : "s"}.`;
}

/** `still showing turn 83.` - keeping the turn already on screen files nothing. */
export function stillShowing(turnNumber: number): string {
  return `still showing turn ${turnNumber}.`;
}

/** What arriving report should do, given whatever is on screen. */
export type NewOriginsArrival =
  /** Nothing to replace, or nothing nameable to ask about. Loads with no question. */
  | { kind: "load" }
  | { kind: "askNewer"; currentTurn: number; incomingTurn: number }
  | { kind: "askSame"; turnNumber: number }
  /** Older than what is on screen: filed, screen untouched, no question. `loadReport` routes it. */
  | { kind: "storeOnly" }
  /** Another faction's: the strip under the header asks. `loadReport` routes it. */
  | { kind: "foreign" };

/**
 * What arriving report should do.
 *
 * Built on `decideReportLoad` rather than beside it: age and ownership are already decided there
 * (gh-208 and issue #53), and this only splits that function's `load` answer into the three cases
 * the agreed design distinguishes.
 */
export function decideArrival(
  current: LoadedReportIdentity | null,
  incoming: LoadedReportIdentity
): NewOriginsArrival {
  const decision = decideReportLoad(current, incoming);
  if (decision.kind === "storeOnly") {
    return { kind: "storeOnly" };
  }
  if (decision.kind === "ask") {
    return { kind: "foreign" };
  }
  if (current === null) {
    // Nothing on screen to replace: the first fetch of a fresh game asks nothing.
    return { kind: "load" };
  }
  if (typeof current.turnNumber !== "number" || typeof incoming.turnNumber !== "number") {
    // A question that cannot name both turns is not the question that was agreed, so it is not
    // asked. `judgeReportUsable` has already refused an incoming report with no turn, so in
    // practice this is the screen's own turn being unreadable.
    return { kind: "load" };
  }
  return current.turnNumber === incoming.turnNumber
    ? { kind: "askSame", turnNumber: incoming.turnNumber }
    : {
        kind: "askNewer",
        currentTurn: current.turnNumber,
        incomingTurn: incoming.turnNumber
      };
}

/**
 * Whether the fields can be sent as they stand.
 *
 * `factionNumberProblem` plus a non-blank password, and deliberately NOT `passwordProblem`: that
 * one also refuses a double quote and a line break, which a `#atlantis "<password>"` orders header
 * cannot carry - but this body is urlencoded, so both are perfectly sendable here, and complaining
 * about them would be a sentence this design never agreed.
 */
export function newOriginsFetchIsReady(
  factionNumber: string,
  password: string,
  phase: NewOriginsFetchPhase
): boolean {
  return (
    phase.kind === "ready" &&
    factionNumberProblem(factionNumber) === null &&
    password.trim() !== ""
  );
}
