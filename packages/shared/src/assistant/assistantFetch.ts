/**
 * The assistant asking the HUD to fetch this turn's report (ah-9vmbx.3), decided apart from how it
 * is drawn and wired.
 *
 * The HUD's own Fetch dialog opens by itself with one extra line on top; the player's password is
 * the go-ahead and never leaves the dialog. Everything here is a rule over plain values - which
 * outcome a fetch came to, whether it answers a request still waiting its turn, what the assistant
 * is told - because this package has no jsdom and an effect cannot be tested in it
 * (`.cerebro/traps.md`). The person-facing strings are the ones agreed on the bead's acceptance and
 * are quoted, not paraphrased.
 */

import { withoutFactionPassword } from "../ordersDocument";
import type { ReportLoadOutcome } from "../reportLoad";
import type { NewAgeFetchOutcome } from "../workspace/newAgeFetchRun";
import type { NewOriginsArrival } from "../workspace/newOriginsFetchView";

/** The line at the top of the dialog while the assistant waits. */
export const ASSISTANT_FETCH_ASKS_LINE = "The assistant is asking for this turn's report.";

/** The same line once the assistant has stopped waiting. */
export const ASSISTANT_FETCH_STOPPED_LINE =
  "The assistant stopped waiting. You can still fetch this turn's report here.";

/** The note under the password, in this dialog only. */
export const ASSISTANT_FETCH_NOTE =
  "Used for this fetch only. The assistant never sees it, and nothing is written to this machine.";

/** The status line after Cancel or Escape. */
export const ASSISTANT_FETCH_DECLINED = "Fetch declined — the assistant has been told.";

/** What the open Fetch dialog adds: the asking line, or the stopped one. */
export type AssistantFetchPrompt = "asking" | "stopped";

/** How a fetch ended, for the one answer the assistant gets. */
export type AssistantFetchOutcome =
  /** The fetched turn is on screen. */
  | { kind: "loaded"; turnNumber: number | null }
  /** The player kept `showing`; `storedTurn` was filed for history, or null when it was the same turn. */
  | { kind: "kept"; showing: number; storedTurn: number | null }
  /** Older than the turn on screen: filed for history, screen unchanged. */
  | { kind: "storedOlder"; showing: number | null }
  /** Another faction's: the strip under the header asks the player. */
  | { kind: "foreign" }
  /** A report came, and the HUD would not load it; the status line says why. */
  | { kind: "notLoaded" }
  /** No report could be had; `reason` is the half-sentence the status line uses. */
  | { kind: "failed"; reason: string }
  | { kind: "declined" }
  | { kind: "notAnswered" }
  /** Refused before anything was shown; `reason` is the whole sentence. */
  | { kind: "refused"; reason: string };

/** The one answer the assistant gets: what is on screen now, or why nothing was fetched. */
export function assistantFetchAnswer(outcome: AssistantFetchOutcome): { text: string; isError: boolean } {
  switch (outcome.kind) {
    case "loaded":
      return {
        text: `${outcome.turnNumber === null ? "This turn" : `Turn ${outcome.turnNumber}`}'s report was fetched and is on screen in Atlantis HUD now. Read it with the usual tools.`,
        isError: false
      };
    case "kept":
      return {
        text:
          outcome.storedTurn === null
            ? `The report fetched was turn ${outcome.showing} again, which is already on screen; the player kept it as it was.`
            : `Turn ${outcome.storedTurn}'s report was fetched and stored for history, but the player kept turn ${outcome.showing} on screen.`,
        isError: false
      };
    case "storedOlder":
      return {
        text: `The report fetched is older than the turn on screen, so it was stored for history; ${outcome.showing === null ? "the turn on screen is unchanged" : `turn ${outcome.showing} is still on screen`}.`,
        isError: false
      };
    case "foreign":
      return {
        text: "The report fetched belongs to another faction. Atlantis HUD is asking the player what to do with it; the turn on screen is unchanged.",
        isError: false
      };
    case "notLoaded":
      return {
        text: "A report was fetched but Atlantis HUD could not load it; the player was shown why. The turn on screen is unchanged.",
        isError: true
      };
    case "failed":
      return { text: withoutFactionPassword(`Nothing was fetched: ${outcome.reason}.`), isError: true };
    case "declined":
      return { text: "The player declined to fetch this turn's report. Nothing was fetched.", isError: true };
    case "notAnswered":
      return {
        text: "The player did not answer the fetch request in Atlantis HUD. Nothing was fetched.",
        isError: true
      };
    case "refused":
      return { text: outcome.reason, isError: true };
  }
}

/**
 * Why the HUD refuses to show anything at all, or null when the request may wait for the player.
 * Another dialog being open is not a reason: the request waits its turn behind it.
 */
export function assistantFetchRefusal(facts: {
  gameOpen: boolean;
  /** Whether the header shows a Fetch for this game here. */
  fetchRoad: boolean;
  /** Whether an assistant's fetch request is already waiting or open. */
  requestWaiting: boolean;
}): string | null {
  if (!facts.gameOpen) {
    return "No game is open in Atlantis HUD. Nothing was fetched.";
  }
  if (!facts.fetchRoad) {
    return "Atlantis HUD cannot fetch reports for this game here; the player has to fetch or import it themselves. Nothing was fetched.";
  }
  if (facts.requestWaiting) {
    return "A fetch request is already waiting for the player in Atlantis HUD; its answer will come to that request.";
  }
  return null;
}

/**
 * Whether a report arrived. The only outcomes of the player's own Fetch that answer a request
 * still waiting its turn: this turn is then in hand, and opening a second dialog would ask again.
 */
export function fetchBroughtReport(outcome: AssistantFetchOutcome): boolean {
  return (
    outcome.kind === "loaded" ||
    outcome.kind === "kept" ||
    outcome.kind === "storedOlder" ||
    outcome.kind === "foreign"
  );
}

/** A New Origins run's arrival as an outcome; null while the player is asked Keep or Open. */
export function originsArrivalOutcome(
  arrival: NewOriginsArrival,
  incomingTurn: number | null,
  showing: number | null
): AssistantFetchOutcome | null {
  switch (arrival.kind) {
    case "load":
      return { kind: "loaded", turnNumber: incomingTurn };
    case "storeOnly":
      return { kind: "storedOlder", showing };
    case "foreign":
      return { kind: "foreign" };
    case "askNewer":
    case "askSame":
      return null;
  }
}

/** The player's Keep or Open on a New Origins question, as an outcome. */
export function originsChoiceOutcome(
  phase:
    | { kind: "askNewer"; currentTurn: number; incomingTurn: number }
    | { kind: "askSame"; turnNumber: number },
  choice: "keep" | "open"
): AssistantFetchOutcome {
  if (phase.kind === "askNewer") {
    return choice === "keep"
      ? { kind: "kept", showing: phase.currentTurn, storedTurn: phase.incomingTurn }
      : { kind: "loaded", turnNumber: phase.incomingTurn };
  }
  return choice === "keep"
    ? { kind: "kept", showing: phase.turnNumber, storedTurn: null }
    : { kind: "loaded", turnNumber: phase.turnNumber };
}

/**
 * A New Age run's end as an outcome. `landed` is what `loadReport` did with this turn's report, and
 * `showing` the turn on screen once it had. Null while the dialog stays up for another try (a
 * refused sign-in) and after the player dismissed it, which the dismissal itself answers.
 */
export function newAgeRunOutcome(
  outcome: NewAgeFetchOutcome,
  landed: ReportLoadOutcome | undefined,
  showing: number | null
): AssistantFetchOutcome | null {
  switch (outcome.kind) {
    case "refused":
    case "abandoned":
      return null;
    case "reportFailed":
      return { kind: "failed", reason: outcome.reason };
    case "done":
      switch (landed) {
        case "loaded":
          return { kind: "loaded", turnNumber: showing };
        case "stored":
          return { kind: "storedOlder", showing };
        case "asked":
          return { kind: "foreign" };
        default:
          // Refused by `loadReport` (it said why on the status line), or not a turn report at all.
          return { kind: "notLoaded" };
      }
  }
}
