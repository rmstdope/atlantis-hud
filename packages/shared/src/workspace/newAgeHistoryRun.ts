/**
 * Fetching a list of earlier turns from a New Age world, one at a time.
 *
 * A pure async function over injected effects, so the rules that matter - stop on a 401 and
 * remember what is left, carry on past every other failure, report progress before each turn - are
 * unit-testable with fakes rather than only through the browser.
 */

import type { NewAgeResult } from "./newAgeApi";
import { HISTORY_NOT_STORED, historyRowFailure } from "./newAgeHistoryView";

export type HistoryRunOutcome = {
  /** Turns fetched and stored, in the order they landed. */
  stored: number[];
  /**
   * Why each failed turn failed, as `historyRowFailure` phrased it. Keyed by `String(turnNumber)`,
   * so the outcome is a plain comparable value in a test.
   */
  failed: Map<string, string>;
  /**
   * Set when a 401 stopped the run: the turns still owed, this one first. `null` otherwise. The
   * caller opens the sign-in dialog and resumes with exactly this list.
   */
  remaining: number[] | null;
};

/**
 * Fetches each turn in order and hands each report to `store`.
 *
 * Serial, not parallel: the reason `battleSkillsStore.ts` gives for walking turns one at a time -
 * each turn is a whole report crossing the IPC boundary and being parsed, and a burst of them
 * starves the window. It also makes `onProgress` mean something.
 *
 * `store` resolves `true` when the turn reached the game's history and `false` when it did not; a
 * `false` is a failed row carrying `HISTORY_NOT_STORED`, not a thrown error, because the caller's
 * `loadReport` reports its own reason on the status line and must not also reject.
 */
export async function runHistoryFetch(
  turns: readonly number[],
  effects: {
    fetch: (turnNumber: number) => Promise<NewAgeResult<string>>;
    store: (turnNumber: number, reportText: string) => Promise<boolean>;
    /** Called before each turn is asked for: how many have been attempted so far. */
    onProgress: (turnNumber: number, done: number) => void;
    /**
     * True once the run has been abandoned - Escape, or the dialog closing. Checked before each
     * turn, so a run stops at the next boundary rather than mid-write.
     */
    abandoned: () => boolean;
  }
): Promise<HistoryRunOutcome> {
  const stored: number[] = [];
  const failed = new Map<string, string>();

  for (let index = 0; index < turns.length; index += 1) {
    if (effects.abandoned()) {
      return { stored, failed, remaining: null };
    }
    const turnNumber = turns[index];
    effects.onProgress(turnNumber, index);
    const result = await effects.fetch(turnNumber);
    if (result.kind === "unauthorized") {
      return { stored, failed, remaining: [...turns.slice(index)] };
    }
    if (result.kind !== "ok") {
      failed.set(String(turnNumber), historyRowFailure(result));
      continue;
    }
    const kept = await effects.store(turnNumber, result.value);
    if (kept) {
      stored.push(turnNumber);
    } else {
      failed.set(String(turnNumber), HISTORY_NOT_STORED);
    }
  }

  return { stored, failed, remaining: null };
}
