/**
 * The mages allies have shared, held in memory for the open game.
 *
 * Storage (`alliedMages.ts`) is the truth; this store is the cache the header chip (`ah-lyg6.1.3`)
 * and the study planner (`ah-lyg6.2`) will read, and what `routeReport` is asked against to decide
 * whether an arriving sheet is older than one already held. Deliberately **not persisted**, for the
 * reason the Armies store gives: a persisted cache would show one game's rows in another game's
 * workspace after a reload.
 */

import { create } from "zustand";
import type {
  AlliedMageKey,
  AlliedMageRecord,
  CoreClient,
  OpenedGame
} from "@atlantis/core-client";
import { loadAlliedMages, saveAlliedMages } from "./alliedMages";

export type AlliedMagesStatus = "idle" | "loading" | "ready" | "error";

export type AlliedMagesState = {
  /** The game the rows belong to; rows for another game are stale and are not read. */
  gameId: string | null;
  status: AlliedMagesStatus;
  /** Every allied mage of the game, in the client's order. */
  mages: AlliedMageRecord[];
  /** Replaces the rows with the game's. Failure gives status "error" and no rows. */
  load: (client: CoreClient, game: OpenedGame) => Promise<void>;
  /**
   * Writes one sheet's rows, then puts them in the cache.
   *
   * Write first, unlike the Armies store's optimistic add: a failed write must not leave mages on
   * screen that storage does not hold, and the caller only writes its status line once this
   * resolves. Rethrows.
   *
   * A row the sheet carries again replaces the one held for that unit, which is what storage does
   * too. A row it leaves out is *kept*: what becomes of one is the player's answer to the
   * missing-mages question, carried out by `discard`.
   */
  takeIn: (
    client: CoreClient,
    game: OpenedGame,
    rows: readonly AlliedMageRecord[]
  ) => Promise<void>;
  /** Drops the rows the player discarded, then removes them from the cache. Rethrows. */
  discard: (client: CoreClient, game: OpenedGame, keys: readonly AlliedMageKey[]) => Promise<void>;
  clear: () => void;
};

/** One row's identity as a cache key: which ally, and which unit of his. */
function keyText(factionId: string, unitId: string): string {
  return `${factionId} ${unitId}`;
}

export const useAlliedMagesStore = create<AlliedMagesState>()((set, get) => ({
  gameId: null,
  status: "idle",
  mages: [],

  load: async (client, game) => {
    const gameId = game.manifest.metadata.gameId;
    set({ gameId, status: "loading" });
    try {
      const mages = await loadAlliedMages(client, game);
      // A game switch mid-load leaves a late result for a game that is no longer open; showing it
      // would put another game's allied mages on screen.
      if (get().gameId !== gameId) {
        return;
      }
      set({ gameId, status: "ready", mages });
    } catch {
      if (get().gameId !== gameId) {
        return;
      }
      set({ gameId, status: "error", mages: [] });
    }
  },

  takeIn: async (client, game, rows) => {
    await saveAlliedMages(client, game, rows, []);
    const carried = new Set(rows.map((row) => keyText(row.factionId, row.unit.unitId)));
    set((state) => ({
      mages: [
        ...state.mages.filter((row) => !carried.has(keyText(row.factionId, row.unit.unitId))),
        ...rows
      ]
    }));
  },

  discard: async (client, game, keys) => {
    await saveAlliedMages(client, game, [], keys);
    const dropped = new Set(keys.map((key) => keyText(key.factionId, key.unitId)));
    set((state) => ({
      mages: state.mages.filter((row) => !dropped.has(keyText(row.factionId, row.unit.unitId)))
    }));
  },

  clear: () => set({ gameId: null, status: "idle", mages: [] })
}));

const DEFAULT_TEST_STATE = { gameId: null, status: "idle" as const, mages: [] };

/** Test helper, like `resetArmiesStore` (armiesStore.ts). */
export function resetAlliedMagesStore(): void {
  useAlliedMagesStore.setState(DEFAULT_TEST_STATE);
}
