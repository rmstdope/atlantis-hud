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
   * storage does not hold. Rethrows.
   */
  save: (client: CoreClient, game: OpenedGame, plan: StudyPlanRecord) => Promise<void>;
  /** Drops rows, then removes them from the cache. Rethrows. */
  remove: (client: CoreClient, game: OpenedGame, keys: readonly StudyPlanKey[]) => Promise<void>;
  clear: () => void;
};

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

  save: async (client, game, plan) => {
    await saveStudyPlans(client, game, [plan], []);
    const replaced = keyText(plan.factionId, plan.unitId);
    set((state) => ({
      plans: sortStudyPlans([
        ...state.plans.filter((row) => keyText(row.factionId, row.unitId) !== replaced),
        plan
      ])
    }));
  },

  remove: async (client, game, keys) => {
    await saveStudyPlans(client, game, [], keys);
    const dropped = new Set(keys.map((key) => keyText(key.factionId, key.unitId)));
    set((state) => ({
      plans: state.plans.filter((row) => !dropped.has(keyText(row.factionId, row.unitId)))
    }));
  },

  clear: () => set({ gameId: null, status: "idle", plans: [] })
}));

const DEFAULT_TEST_STATE = { gameId: null, status: "idle" as const, plans: [] };

/** Test helper, like `resetArmiesStore` (armiesStore.ts). */
export function resetStudyPlansStore(): void {
  useStudyPlansStore.setState(DEFAULT_TEST_STATE);
}
