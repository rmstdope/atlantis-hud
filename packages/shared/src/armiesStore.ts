/**
 * Armies, held in memory for the open game.
 *
 * Storage (`armies.ts`) is the truth; this store is a cache the units dock's source rail
 * (ah-1mpx.2) will read, kept in step optimistically by the mutations below and repaired on
 * failure. Deliberately **not persisted** — `useWorkspaceStore` is, but a persisted Armies cache
 * would show one game's Armies in another game's workspace after a reload.
 *
 * `refreshFor` is where the snapshot rules meet a loaded turn, and it lives here rather than in an
 * effect because `packages/shared` has no jsdom and an effect cannot be tested there (ah-nass).
 */

import { create } from "zustand";
import type { CoreClient, OpenedGame, ParsedReport, ReportUnit } from "@atlantis/core-client";
import {
  deleteArmy,
  loadArmies,
  newArmy,
  refreshedAgainst,
  renameArmy,
  saveArmy,
  sortArmies,
  unitsByIdIn,
  withMember,
  withoutMember,
  type ArmyRecord
} from "./armies";

export type ArmiesStatus = "idle" | "loading" | "ready" | "error";

export type ArmiesState = {
  /** The game the list belongs to; a list for another game is stale and is not shown. */
  gameId: string | null;
  status: ArmiesStatus;
  /** Every Army of the game, by name (`sortArmies`' order). */
  armies: ArmyRecord[];
  /** Replaces the list with the game's Armies. Failure → status "error", armies []. */
  load: (client: CoreClient, game: OpenedGame) => Promise<void>;
  /** Adds optimistically, then saves; on failure removes it again and rethrows. */
  create: (client: CoreClient, game: OpenedGame, name: string, now: string) => Promise<ArmyRecord>;
  /** Renames optimistically, then saves; on failure restores the old name and rethrows. */
  rename: (
    client: CoreClient,
    game: OpenedGame,
    armyId: string,
    name: string,
    now: string
  ) => Promise<void>;
  /** Removes optimistically, then deletes; on failure puts it back and rethrows. */
  remove: (client: CoreClient, game: OpenedGame, armyId: string) => Promise<void>;
  /** Adds a unit, or refreshes its snapshot when it is already a member. */
  addUnit: (
    client: CoreClient,
    game: OpenedGame,
    armyId: string,
    unit: ReportUnit,
    turn: number,
    now: string
  ) => Promise<void>;
  removeUnit: (
    client: CoreClient,
    game: OpenedGame,
    armyId: string,
    unitId: string,
    now: string
  ) => Promise<void>;
  /**
   * Refreshes every Army against a loaded turn, writing only the ones that actually changed.
   *
   * Does nothing when the report names no turn: `turnNumber` is nullable, and guessing one would
   * write a wrong `seenTurn` into every snapshot. In practice `judgeReportUsable` already refuses
   * such a report, but the type permits it.
   *
   * Fire and forget: a failed cache write is logged and swallowed, because a turn that loaded
   * correctly must not be rolled back over one. What did not reach storage is put back in the
   * cache, so the two never quietly disagree.
   */
  refreshFor: (
    client: CoreClient,
    game: OpenedGame,
    parsed: ParsedReport,
    now: string
  ) => Promise<void>;
  clear: () => void;
};

export const useArmiesStore = create<ArmiesState>()((set, get) => ({
  gameId: null,
  status: "idle",
  armies: [],

  load: async (client, game) => {
    const gameId = game.manifest.metadata.gameId;
    set({ gameId, status: "loading" });
    try {
      const armies = await loadArmies(client, game);
      // A game switch mid-load leaves a late result for a game that is no longer open; showing it
      // would put the wrong game's Armies on screen.
      if (get().gameId !== gameId) {
        return;
      }
      set({ gameId, status: "ready", armies });
    } catch {
      if (get().gameId !== gameId) {
        return;
      }
      set({ gameId, status: "error", armies: [] });
    }
  },

  create: async (client, game, name, now) => {
    const army = newArmy({ gameId: game.manifest.metadata.gameId, name, now });
    set((state) => ({ armies: sortArmies([...state.armies, army]) }));
    try {
      const saved = await saveArmy(client, game, army);
      set((state) => ({
        armies: sortArmies(state.armies.map((one) => (one.id === army.id ? saved : one)))
      }));
      return saved;
    } catch (error) {
      set((state) => ({ armies: state.armies.filter((one) => one.id !== army.id) }));
      throw error;
    }
  },

  rename: async (client, game, armyId, name, now) => {
    await replaceAndSave(set, get, client, game, armyId, (army) => renameArmy(army, name, now));
  },

  remove: async (client, game, armyId) => {
    const before = get().armies.find((one) => one.id === armyId);
    set((state) => ({ armies: state.armies.filter((one) => one.id !== armyId) }));
    try {
      await deleteArmy(client, game, armyId);
    } catch (error) {
      if (before) {
        set((state) => ({ armies: sortArmies([...state.armies, before]) }));
      }
      throw error;
    }
  },

  addUnit: async (client, game, armyId, unit, turn, now) => {
    await replaceAndSave(set, get, client, game, armyId, (army) =>
      withMember(army, unit, turn, now)
    );
  },

  removeUnit: async (client, game, armyId, unitId, now) => {
    await replaceAndSave(set, get, client, game, armyId, (army) =>
      withoutMember(army, unitId, now)
    );
  },

  refreshFor: async (client, game, parsed, now) => {
    const turn = parsed.header.turnNumber;
    if (turn === null) {
      return;
    }

    const before = get().armies;
    const units = unitsByIdIn(parsed);
    const refreshed = before.map((army) => refreshedAgainst(army, units, turn, now));
    // `refreshedAgainst` answers with the identical object when nothing moved, so this is what
    // keeps a turn load from rewriting every Army.
    const moved = refreshed.filter((army, index) => army !== before[index]);
    if (moved.length === 0) {
      return;
    }

    set({ armies: sortArmies(refreshed) });
    const written = await Promise.allSettled(moved.map((army) => saveArmy(client, game, army)));

    // Roll back exactly the Armies that did not reach storage, and leave the ones that did.
    //
    // Not `load`, and not a bare log. Re-reading storage would flip `status` back through
    // `loading` to `ready`, which the shell's refresh effect is keyed on - so a write that keeps
    // failing (a full disk, an exhausted quota) would refresh, fail, reload and refresh again
    // without bound. Logging alone would be worse the other way: the cache would show snapshots
    // that were never written, and the next refresh would find nothing changed and never retry.
    const unwritten = new Set(
      moved.filter((_army, index) => written[index].status === "rejected").map((army) => army.id)
    );
    if (unwritten.size === 0) {
      return;
    }

    console.warn(
      `could not save ${unwritten.size} refreshed ${unwritten.size === 1 ? "Army" : "Armies"}`,
      written.find((one) => one.status === "rejected")
    );
    const previous = new Map(before.map((army) => [army.id, army]));
    set((state) => ({
      armies: sortArmies(
        state.armies.map((army) =>
          unwritten.has(army.id) ? (previous.get(army.id) ?? army) : army
        )
      )
    }));
  },

  clear: () => set({ gameId: null, status: "idle", armies: [] })
}));

/**
 * One Army replaced by a pure change, optimistically, then saved — with the old Army put back and
 * the error rethrown when the save fails. Every single-Army mutation but `create` and `remove` has
 * exactly this shape.
 */
async function replaceAndSave(
  set: (partial: Partial<ArmiesState> | ((state: ArmiesState) => Partial<ArmiesState>)) => void,
  get: () => ArmiesState,
  client: CoreClient,
  game: OpenedGame,
  armyId: string,
  change: (army: ArmyRecord) => ArmyRecord
): Promise<void> {
  const before = get().armies.find((one) => one.id === armyId);
  if (!before) {
    return;
  }
  const after = change(before);
  set((state) => ({
    armies: sortArmies(state.armies.map((one) => (one.id === armyId ? after : one)))
  }));
  try {
    await saveArmy(client, game, after);
  } catch (error) {
    set((state) => ({
      armies: sortArmies(state.armies.map((one) => (one.id === armyId ? before : one)))
    }));
    throw error;
  }
}

const DEFAULT_TEST_STATE = { gameId: null, status: "idle" as const, armies: [] };

/** Test helper, like `resetHexNotesStore` (hexNotesStore.ts). */
export function resetArmiesStore(): void {
  useArmiesStore.setState(DEFAULT_TEST_STATE);
}
