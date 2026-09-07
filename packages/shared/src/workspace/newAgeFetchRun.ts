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

import type { NewAgeLogin, NewAgeResult } from "./newAgeApi";
import {
  fetchFailureReason,
  type NewAgeFetchPhase,
  type NewAgeFetchScope
} from "./newAgeFetchView";
import { runHistoryFetch } from "./newAgeHistoryRun";
import { historyListFailed, missingTurns } from "./newAgeHistoryView";
import { NEW_AGE_HOST, signInFailure } from "./newAgeSignInView";

export type NewAgeFetchOutcome =
  /** Nothing was fetched: the login itself failed. `message`/`retype` go straight to `ready`. */
  | { kind: "refused"; message: string; retype: boolean }
  /** This turn's report could not be had. `reason` is `fetchFailureReason`'s half-sentence. */
  | { kind: "reportFailed"; reason: string }
  /** The turn landed; `history` is absent for `thisTurn` and present otherwise. */
  | {
      kind: "done";
      history: { stored: number[]; failed: Map<string, string>; refusedMidRun: boolean } | null;
      /** The listing call failed - the turn still landed. Whole sentence, for the status line. */
      listFailed: string | null;
    }
  /** Cancel or Escape, at a boundary. Whatever landed before it stays. */
  | { kind: "abandoned" };

export type NewAgeFetchEffects = {
  login: (factionNumber: string, password: string) => Promise<NewAgeResult<NewAgeLogin>>;
  report: (token: string) => Promise<NewAgeResult<string>>;
  historyTurns: (token: string) => Promise<NewAgeResult<number[]>>;
  historyReport: (token: string, turnNumber: number) => Promise<NewAgeResult<string>>;
  /** `loadReport`, already bound to its name. Resolves false when the game kept nothing. */
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
  effects: NewAgeFetchEffects
): Promise<NewAgeFetchOutcome> {
  if (effects.abandoned()) {
    return ABANDONED;
  }

  effects.onPhase({ kind: "signingIn" });
  const login = await effects.login(credentials.factionNumber, credentials.password);
  if (login.kind !== "ok") {
    // Nothing was being sent, so the unreachable sentence drops its `Nothing was sent.` clause.
    const { message, retype } = signInFailure(login, NEW_AGE_HOST, { nothingSent: false });
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
  await effects.store(null, report.value);

  if (scope === "thisTurn") {
    return { kind: "done", history: null, listFailed: null };
  }

  if (effects.abandoned()) {
    return ABANDONED;
  }

  effects.onPhase({ kind: "listing" });
  const turns = await effects.historyTurns(token);
  if (turns.kind !== "ok") {
    // This turn landed, so a failed listing is a warning rather than a failed fetch.
    return {
      kind: "done",
      history: null,
      listFailed: historyListFailed(worldName, fetchFailureReason(turns, NEW_AGE_HOST))
    };
  }

  // Read now, not earlier: the turn just stored is the working turn, so it is excluded from the
  // bulk list rather than downloaded a second time.
  const held = effects.heldTurns();
  const missing = missingTurns(turns.value, held.stored, held.workingTurn);

  const outcome = await runHistoryFetch(missing, {
    fetch: (turnNumber) => effects.historyReport(token, turnNumber),
    store: (turnNumber, reportText) => effects.store(turnNumber, reportText),
    onProgress: (turnNumber, done) =>
      effects.onPhase({ kind: "fetchingTurn", turnNumber, done, total: missing.length }),
    abandoned: effects.abandoned
  });

  return {
    kind: "done",
    // `remaining` is non-null only on a 401; it is null when the run was abandoned as well as
    // when it finished, so what landed is read from `stored` and `failed` either way.
    history: {
      stored: outcome.stored,
      failed: outcome.failed,
      refusedMidRun: outcome.remaining !== null
    },
    listFailed: null
  };
}
