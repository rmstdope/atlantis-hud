/**
 * Next turn's study choices, held in memory for the open game.
 *
 * Storage (`studyPlans.ts`) is the truth; this store is the cache the study planner (`ah-lyg6.2.2`,
 * `ah-lyg6.2.3`) and the order export (`ah-lyg6.4`) will read. Deliberately **not persisted**, for
 * the reason the Armies store gives: a persisted cache would show one game's rows in another
 * game's workspace after a reload.
 */

import { create } from "zustand";
import type { CoreClient, OpenedGame } from "@atlantis/core-client";
import {
  loadStudyPlans,
  saveStudyPlans,
  sortStudyPlans,
  type StudyPlanKey,
  type StudyPlanRecord
} from "./studyPlans";

export type StudyPlansStatus = "idle" | "loading" | "ready" | "error";

export type StudyPlansState = {
  /** The game the rows belong to; rows for another game are stale and are not read. */
  gameId: string | null;
  status: StudyPlansStatus;
  /** Every study plan of the game, in the client's order. */
  plans: StudyPlanRecord[];
  /** Replaces the rows with the game's. Failure gives status "error" and no rows. */
  load: (client: CoreClient, game: OpenedGame) => Promise<void>;
  /**
   * Writes one mage's plan, then puts it in the cache, replacing any row with the same
   * (factionId, unitId).
   *
   * Write first rather than optimistically: a failed write must not leave a study on screen that
   * storage does not hold. Rethrows. Serialized against every other write - see `queued`.
   *
   * `update` is applied **inside** the queue, against the row the cache holds at the moment the
   * write runs, and is why this takes an edit rather than a finished record: a plan is one row
   * whose goals are written whole, so a second choice made while the first write is in flight
   * would otherwise be built from a row that does not hold the first yet, and would overwrite it.
   */
  save: (
    client: CoreClient,
    game: OpenedGame,
    key: StudyPlanKey,
    update: (current: StudyPlanRecord | null) => StudyPlanRecord
  ) => Promise<void>;
  /** Drops rows, then removes them from the cache. Rethrows. */
  remove: (client: CoreClient, game: OpenedGame, keys: readonly StudyPlanKey[]) => Promise<void>;
  clear: () => void;
};

/**
 * Writes are serialized, and this is the tail of the queue.
 *
 * Two writes in flight at once are two "replace this mage's row" calls whose *completion* order
 * decides what storage ends up holding, and the second one can land first: clicking two cells of
 * the schedule quickly enough - which ah-lyg6.2.3 made a one-click action - then loses the second
 * plan on the next reload. Chaining them keeps storage in the order the player made the choices.
 *
 * Module-level rather than in the store, because it is not state anything renders, and the store
 * is a singleton per process exactly as `plans` is.
 */
let writes: Promise<unknown> = Promise.resolve();

/** Runs `work` after every write queued before it, whether those succeeded or failed. */
function queued<T>(work: () => Promise<T>): Promise<T> {
  const next = writes.then(work, work);
  // The tail must not reject, or every later write would inherit the failure.
  writes = next.catch(() => undefined);
  return next;
}

/** One row's identity as a cache key: whose mage, and which unit of his. */
function keyText(factionId: string, unitId: string): string {
  return `${factionId} ${unitId}`;
}

export const useStudyPlansStore = create<StudyPlansState>()((set, get) => ({
  gameId: null,
  status: "idle",
  plans: [],

  load: async (client, game) => {
    const gameId = game.manifest.metadata.gameId;
    set({ gameId, status: "loading" });
    try {
      const plans = await loadStudyPlans(client, game);
      // A game switch mid-load leaves a late result for a game that is no longer open; showing it
      // would put another game's study plans on screen.
      if (get().gameId !== gameId) {
        return;
      }
      set({ gameId, status: "ready", plans });
    } catch {
      if (get().gameId !== gameId) {
        return;
      }
      set({ gameId, status: "error", plans: [] });
    }
  },

  save: async (client, game, key, update) =>
    queued(async () => {
      const replaced = keyText(key.factionId, key.unitId);
      // Read *here*, not when the call was made: the row may have been written by an edit that
      // was queued ahead of this one, and a plan's goals are written whole.
      const current =
        get().plans.find((row) => keyText(row.factionId, row.unitId) === replaced) ?? null;
      const plan = update(current);
      await saveStudyPlans(client, game, [plan], []);
      set((state) => ({
        plans: sortStudyPlans([
          ...state.plans.filter((row) => keyText(row.factionId, row.unitId) !== replaced),
          plan
        ])
      }));
    }),

  remove: async (client, game, keys) =>
    queued(async () => {
      await saveStudyPlans(client, game, [], keys);
      const dropped = new Set(keys.map((key) => keyText(key.factionId, key.unitId)));
      set((state) => ({
        plans: state.plans.filter((row) => !dropped.has(keyText(row.factionId, row.unitId)))
      }));
    }),

  clear: () => set({ gameId: null, status: "idle", plans: [] })
}));

/**
 * Test helper, like `resetArmiesStore` (armiesStore.ts).
 *
 * Builds the state fresh each time rather than handing every reset one module-level object: two
 * tests sharing a `plans` array instance is one in-place mutation away from leaking between them.
 */
export function resetStudyPlansStore(): void {
  useStudyPlansStore.setState({ gameId: null, status: "idle", plans: [] });
  // The write queue is module state too, and a test that left one in flight would otherwise hold
  // up every write of the next one.
  writes = Promise.resolve();
}
