/**
 * The combat skills recovered from this game's battle rosters, held in memory for the open game.
 *
 * Second child of `ah-1mpx.6`. Deliberately simpler than `armiesStore.ts` and `hexNotesStore.ts`
 * beside it: **it never writes anything.** There is no save, no optimistic update and no rollback,
 * because nothing here is persisted. `imported_turns.raw_report` already keeps every turn's text,
 * so the whole map is rebuilt by a scan whenever a game opens - no migration, no IndexedDB version
 * bump, no backup field.
 */

import { create } from "zustand";
import type { CoreClient, OpenedGame, RosterSkills } from "@atlantis/core-client";

import {
  mergedDerived,
  NO_DERIVED_SKILLS,
  withRosterSkills,
  type DerivedSkills
} from "./battleSkills";

export type BattleSkillsStatus = "idle" | "scanning" | "ready";

export type BattleSkillsState = {
  /** The game the map belongs to; a map for another game is stale and is not read. */
  gameId: string | null;
  status: BattleSkillsStatus;
  skills: DerivedSkills;
  /**
   * How many stored turns the last scan could not read. Decision F1: the scan carries on with the
   * turns that did read, and the export dialog says how many it missed.
   */
  unreadTurns: number;
  /** Reads every stored turn of the game. Never rejects. */
  scan: (client: CoreClient, game: OpenedGame) => Promise<void>;
  /** One turn's rosters folded in - decision N1. A no-op when `gameId` is not the open game. */
  foldIn: (gameId: string, entries: readonly RosterSkills[], turn: number) => void;
  clear: () => void;
};

export const useBattleSkillsStore = create<BattleSkillsState>()((set, get) => ({
  gameId: null,
  status: "idle",
  skills: NO_DERIVED_SKILLS,
  unreadTurns: 0,

  scan: async (client, game) => {
    const gameId = game.manifest.metadata.gameId;
    set({ gameId, status: "scanning", skills: NO_DERIVED_SKILLS, unreadTurns: 0 });

    const { skills, unreadTurns } = await scanStoredTurns(client, game);

    // A game switch mid-scan leaves a late result for a game that is no longer open.
    if (get().gameId !== gameId) {
      return;
    }
    // `state.skills` is whatever `foldIn` wrote while the scan was running, and it wins - both by
    // the merge rule (it is the newest turn) and by being `incoming` on a tie.
    set((state) => ({
      status: "ready",
      skills: mergedDerived(skills, state.skills),
      unreadTurns
    }));
  },

  foldIn: (gameId, entries, turn) => {
    if (get().gameId !== gameId) {
      return;
    }
    set((state) => ({ skills: withRosterSkills(state.skills, entries, turn) }));
  },

  clear: () => {
    set(DEFAULT_STATE);
  }
}));

/**
 * Every stored turn of the game, read for its battle rosters.
 *
 * **Every turn, whoever's report it is** - decision F1 of round 1. A battle roster is a fact about
 * the world and every report in the game was imported by the player, so this does not filter by
 * faction the way `listComparableTurns` (`comparisonActions.ts`) does.
 *
 * Serial rather than parallel: `listImportedTurns` is returned in turn-ascending order by
 * `createCoreClient` (`sortImportedTurnSummaries`), each turn is a whole report crossing the
 * boundary, and the merge rule makes the order irrelevant to the answer anyway - so there is
 * nothing to buy by holding several in memory at once. Two reports for the same turn from different
 * factions are both read, faction id ascending, so the higher faction id wins a disagreement;
 * deterministic, and it does not matter which, since both saw the same battle.
 *
 * Never rejects. A turn that will not load or will not parse is counted in `unreadTurns` and the
 * walk carries on (decision F1). A failure of `listImportedTurns` itself is logged and answered
 * with nothing recovered and `unreadTurns: 0`: the count F1's sentence needs is the number of turns
 * that failed, and when the listing is what failed there is no such number to give. That case is
 * storage being unavailable, which the Armies list and the turn picker will already be showing.
 */
export async function scanStoredTurns(
  client: Pick<CoreClient, "listImportedTurns" | "loadImportedTurn" | "rosterSkills">,
  game: OpenedGame
): Promise<{ skills: DerivedSkills; unreadTurns: number }> {
  const gameId = game.manifest.metadata.gameId;

  let summaries;
  try {
    summaries = await client.listImportedTurns(game.databasePath, gameId);
  } catch (error) {
    console.warn("could not list this game's stored turns for battle rosters", error);
    return { skills: NO_DERIVED_SKILLS, unreadTurns: 0 };
  }

  let skills: DerivedSkills = NO_DERIVED_SKILLS;
  let unreadTurns = 0;
  for (const { key } of summaries) {
    try {
      const record = await client.loadImportedTurn(
        game.databasePath,
        gameId,
        key.factionId,
        key.turnNumber
      );
      if (record === null) {
        unreadTurns += 1;
        continue;
      }
      skills = withRosterSkills(
        skills,
        await client.rosterSkills(record.rawReport),
        key.turnNumber
      );
    } catch (error) {
      console.warn(`could not read turn ${key.turnNumber}'s battle rosters`, error);
      unreadTurns += 1;
    }
  }

  return { skills, unreadTurns };
}

const DEFAULT_STATE = {
  gameId: null,
  status: "idle" as const,
  skills: NO_DERIVED_SKILLS,
  unreadTurns: 0
};

/** Test helper, like `resetArmiesStore` (armiesStore.ts). */
export function resetBattleSkillsStore(): void {
  useBattleSkillsStore.setState(DEFAULT_STATE);
}
