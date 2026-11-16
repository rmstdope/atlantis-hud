/**
 * One press of Fetch, end to end: sign in, bring this turn's report, and optionally every earlier
 * turn the world holds that this game does not.
 *
 * A pure async function over injected effects, the shape `newAgeHistoryRun.ts` and `newAgeSend.ts`
 * already have, and for the same reason: this package has no jsdom (ah-nass), so the order of the
 * steps and the failure rules are pinned by unit tests rather than by reading a component.
 *
 * **The token lives here and nowhere else.** It is a local `const` for the length of one call: not
 * React state, not persisted, never rendered and never logged. That is the whole of what "no
 * session" means.
 */

import type { NewAgeFailure, NewAgeLogin, NewAgeResult } from "./newAgeApi";
import {
  fetchFailureReason,
  type NewAgeFetchPhase,
  type NewAgeFetchScope
} from "./newAgeFetchView";
import { runHistoryFetch } from "./newAgeHistoryRun";
import { earlierTurns, missingTurns } from "./newAgeHistoryView";
import { NEW_AGE_HOST, signInFailure } from "./newAgeSignInView";

/** What asking for earlier turns came to. Present only for `thisTurnAndHistory`. */
export type NewAgeHistoryResult =
  /** The listing call failed; this turn still landed. Never `unauthorized` - that is `ran`, refused. */
  | { kind: "listFailed"; failure: Exclude<NewAgeFailure, { kind: "unauthorized" }> }
  /** The world lists no turn earlier than the one on screen. */
  | { kind: "noneEarlier" }
  /** It lists earlier turns, and the game already holds every one of them. */
  | { kind: "nothingMissing" }
  /** At least one turn was asked for. */
  | {
      kind: "ran";
      stored: number[];
      failed: Map<string, string>;
      refusedMidRun: boolean;
      /** The turns a mid-run refusal left unasked: 0 unless `refusedMidRun`. */
      unfetched: number;
    };

/**
 * What `arrival` says about this turn's report, read before it is stored (ah-1y7yi).
 *
 * `store` is every case that asks nothing here: nothing on screen, an older turn, another
 * faction's report - `loadReport` routes those itself, as it always has. The two ask kinds are the
 * report that would replace the turn on screen, and is held back for the player's answer.
 */
export type NewAgeArrival = { kind: "store" } | NewAgeHeldArrival;
export type NewAgeHeldArrival =
  | { kind: "askNewer"; currentTurn: number; incomingTurn: number }
  | { kind: "askSame"; turnNumber: number };

export type NewAgeFetchOutcome =
  /** Nothing was fetched: the login itself failed. `message`/`retype` go straight to `ready`. */
  | { kind: "refused"; message: string; retype: boolean }
  /** This turn's report could not be had. `reason` is `fetchFailureReason`'s half-sentence. */
  | { kind: "reportFailed"; reason: string }
  /** The turn landed; `history` is `null` for `thisTurn` and present otherwise. */
  | { kind: "done"; history: NewAgeHistoryResult | null }
  /**
   * The turn arrived and was NOT stored: it would replace the turn on screen, so the run ends at
   * the question rather than awaiting it - the rule `runNewOriginsFetch` set, and for its reason.
   * Every earlier turn was already stored; `history` says how that went.
   */
  | {
      kind: "held";
      arrival: NewAgeHeldArrival;
      reportText: string;
      history: NewAgeHistoryResult | null;
    }
  /** Cancel or Escape, at a boundary. Whatever landed before it stays. */
  | { kind: "abandoned" };

export type NewAgeFetchEffects = {
  login: (factionNumber: string, password: string) => Promise<NewAgeResult<NewAgeLogin>>;
  report: (token: string) => Promise<NewAgeResult<string>>;
  /** Whether this turn's report may be stored, or must wait for the player (ah-1y7yi). */
  arrival: (reportText: string) => Promise<NewAgeArrival>;
  historyTurns: (token: string) => Promise<NewAgeResult<number[]>>;
  historyReport: (token: string, turnNumber: number) => Promise<NewAgeResult<string>>;
  /**
   * `loadReport`, already bound to its name.
   *
   * Answers whether the game kept the report. Nothing reads it for this turn's own report - see
   * the call - and `runHistoryFetch` reads it for an earlier turn, where `false` becomes a failed
   * row carrying `HISTORY_NOT_STORED`.
   */
  store: (turnNumber: number | null, reportText: string) => Promise<boolean>;
  /** Which turns the game holds, and which is on screen - read AFTER this turn has landed. */
  heldTurns: () => { stored: readonly { turnNumber: number }[]; workingTurn: number | null };
  onPhase: (phase: NewAgeFetchPhase) => void;
  abandoned: () => boolean;
};

const ABANDONED = { kind: "abandoned" } as const;

export async function runNewAgeFetch(
  scope: NewAgeFetchScope,
  credentials: { factionNumber: string; password: string },
  worldName: string,
  effects: NewAgeFetchEffects,
  { fromBrowser = false }: { fromBrowser?: boolean } = {}
): Promise<NewAgeFetchOutcome> {
  if (effects.abandoned()) {
    return ABANDONED;
  }

  effects.onPhase({ kind: "signingIn" });
  const login = await effects.login(credentials.factionNumber, credentials.password);
  if (login.kind !== "ok") {
    // Nothing was being sent, so the unreachable sentence drops its `Nothing was sent.` clause.
    const { message, retype } = signInFailure(login, NEW_AGE_HOST, { nothingSent: false, fromBrowser });
    return { kind: "refused", message, retype };
  }
  const token = login.value.accessToken;

  if (effects.abandoned()) {
    return ABANDONED;
  }

  effects.onPhase({ kind: "fetchingReport" });
  const report = await effects.report(token);
  if (report.kind !== "ok") {
    // No point asking which turns exist for a fetch that could not deliver the one asked for.
    return { kind: "reportFailed", reason: fetchFailureReason(report, NEW_AGE_HOST) };
  }
  const arrival = await effects.arrival(report.value);
  const held = arrival.kind === "store" ? null : arrival;
  if (held === null) {
    // The boolean is deliberately not read: a report the game would not keep has already had its
    // own reason written to the status line by `loadReport`, and this turn still reached the world -
    // so the run carries on to the listing rather than claiming the fetch itself failed.
    await effects.store(null, report.value);
  }
  const finish = (history: NewAgeHistoryResult | null): NewAgeFetchOutcome =>
    held === null
      ? { kind: "done", history }
      : { kind: "held", arrival: held, reportText: report.value, history };

  if (scope === "thisTurn") {
    return finish(null);
  }

  if (effects.abandoned()) {
    return ABANDONED;
  }

  effects.onPhase({ kind: "listing" });
  const turns = await effects.historyTurns(token);
  if (turns.kind === "unauthorized") {
    // The world stopped accepting the token between the report and the listing: the agreed
    // "stopped accepting mid-run" state, not a list that could not be fetched.
    return finish({ kind: "ran", stored: [], failed: new Map(), refusedMidRun: true, unfetched: 0 });
  }
  if (turns.kind !== "ok") {
    // This turn landed, so a failed listing is a warning rather than a failed fetch.
    return finish({ kind: "listFailed", failure: turns });
  }

  // Read now, not earlier: the turn just stored is the working turn, so it is excluded from the
  // bulk list rather than downloaded a second time. A held turn is not stored, so the run counts
  // back from it instead - turns between the screen and the held one are earlier turns too, and
  // the shell stores them for history without letting them take the screen.
  const holding = effects.heldTurns();
  const reference =
    held === null
      ? holding.workingTurn
      : held.kind === "askNewer"
        ? held.incomingTurn
        : held.turnNumber;
  if (earlierTurns(turns.value, reference).length === 0) {
    return finish({ kind: "noneEarlier" });
  }
  // The turn on screen is held whether or not the picker has listed it yet: counting back from a
  // held turn would otherwise fetch it again.
  const onScreen = holding.workingTurn === null ? [] : [{ turnNumber: holding.workingTurn }];
  const missing = missingTurns(turns.value, [...holding.stored, ...onScreen], reference);
  if (missing.length === 0) {
    return finish({ kind: "nothingMissing" });
  }

  const outcome = await runHistoryFetch(missing, {
    fetch: (turnNumber) => effects.historyReport(token, turnNumber),
    store: (turnNumber, reportText) => effects.store(turnNumber, reportText),
    onProgress: (turnNumber, done) =>
      effects.onPhase({ kind: "fetchingTurn", turnNumber, done, total: missing.length }),
    abandoned: effects.abandoned
  });

  // `remaining` is non-null only on a 401 and null both when the run finished and when it was
  // abandoned, so it cannot tell those two apart - `abandoned()` is asked directly. Whatever
  // landed before the Cancel stays landed; it is already in the game's history.
  if (outcome.remaining === null && effects.abandoned()) {
    return ABANDONED;
  }

  return finish({
    kind: "ran",
    stored: outcome.stored,
    failed: outcome.failed,
    refusedMidRun: outcome.remaining !== null,
    unfetched: outcome.remaining?.length ?? 0
  });
}
