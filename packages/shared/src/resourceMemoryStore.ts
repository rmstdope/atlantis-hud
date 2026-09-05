/**
 * What earlier turns proved about this game's hidden resources, held in memory for the open game.
 *
 * `ah-tgtp`. Modelled on `battleSkillsStore.ts` beside it, and for the same reason: **it never
 * writes anything.** `imported_turns.raw_report` already keeps every turn's text, so the whole
 * memory is rebuilt by a scan whenever the game - or the ruleset the verdicts are judged against -
 * changes. No migration, no IndexedDB version bump, no backup field.
 *
 * Not persisted, for the reason `armiesStore.ts` gives about itself: a persisted cache would show
 * one game's answer in another game's workspace after a reload.
 */

import { create } from "zustand";
import type { CoreClient, OpenedGame, ParsedReport } from "@atlantis/core-client";

import type { GameDataIndex } from "./gameData";
import {
  mergedMemory,
  NO_RESOURCE_MEMORY,
  withTurn,
  type ResourceMemory
} from "./resourceMemory";

export type ResourceMemoryStatus = "idle" | "scanning" | "ready";

export type ResourceMemoryState = {
  /** The game the memory belongs to; a memory for another game is stale and is not read. */
  gameId: string | null;
  status: ResourceMemoryStatus;
  memory: ResourceMemory;
  /**
   * How many stored turns the last scan could not read. Kept because it costs nothing; shown
   * nowhere, there being no surface for it that the navigator has agreed to.
   */
  unreadTurns: number;
  /**
   * Which scan is the live one. Unlike the battle-roster scan, this one is re-run when the ruleset
   * changes as well as when the game does, so two scans of one game can overlap and the older must
   * not write its answer over the newer.
   */
  scanRun: number;
  /** Reads every stored turn of the game. Never rejects. */
  scan: (client: CoreClient, game: OpenedGame, index: GameDataIndex | null) => Promise<void>;
  /** The turn on screen folded in, so a report imported this minute counts at once. */
  foldIn: (
    gameId: string,
    report: ParsedReport,
    turn: number,
    index: GameDataIndex | null
  ) => void;
  clear: () => void;
};

let runs = 0;
const nextScanRun = () => ++runs;

export const useResourceMemoryStore = create<ResourceMemoryState>()((set, get) => ({
  gameId: null,
  status: "idle",
  memory: NO_RESOURCE_MEMORY,
  unreadTurns: 0,
  scanRun: 0,

  scan: async (client, game, index) => {
    const gameId = game.manifest.metadata.gameId;
    const run = nextScanRun();
    set({
      gameId,
      status: "scanning",
      memory: NO_RESOURCE_MEMORY,
      unreadTurns: 0,
      scanRun: run
    });

    const { memory, unreadTurns } = await scanStoredTurns(client, game, index);

    // A game switch, or a second scan started because the ruleset changed, leaves a late result for
    // a state that has moved on.
    if (get().gameId !== gameId || get().scanRun !== run) {
      return;
    }
    // `state.memory` is whatever `foldIn` wrote while the scan was running, and it wins - both by
    // the merge rule (it is the newest turn) and by being `incoming` on a tie.
    set((state) => ({
      status: "ready",
      memory: mergedMemory(memory, state.memory),
      unreadTurns
    }));
  },

  foldIn: (gameId, report, turn, index) => {
    if (get().gameId !== gameId) {
      return;
    }
    set((state) => ({ memory: withTurn(state.memory, report, turn, index) }));
  },

  clear: () => {
    set(DEFAULT_STATE);
  }
}));

/**
 * Every stored turn of the game, read for what it proves about hidden resources. Never rejects.
 *
 * **Every turn, whoever's report it is**, and `own === true` is read as that report's own units: a
 * hunter is a hunter, and a report showing his skills proves what the hex holds. The same decision
 * `battleSkillsStore.ts` records for battle rosters.
 *
 * Serial rather than parallel: the summaries come back turn-ascending from
 * `sortImportedTurnSummaries`, and the merge rule makes the order irrelevant to the answer. A turn
 * that will not load or will not parse is counted in `unreadTurns` and the walk carries on; a
 * failure of `listImportedTurns` itself is logged and answered with nothing recovered.
 */
export async function scanStoredTurns(
  client: Pick<CoreClient, "listImportedTurns" | "loadImportedTurn" | "parseReportFull">,
  game: OpenedGame,
  index: GameDataIndex | null
): Promise<{ memory: ResourceMemory; unreadTurns: number }> {
  // Nothing can be judged without the catalogue, and `AppShell` scans while the ruleset is still
  // fetching - so without this the whole walk runs, parsing every stored turn over IPC, to hand
  // back nothing and be re-run the moment the ruleset lands.
  if (index === null) {
    return { memory: NO_RESOURCE_MEMORY, unreadTurns: 0 };
  }

  const gameId = game.manifest.metadata.gameId;

  let summaries;
  try {
    summaries = await client.listImportedTurns(game.databasePath, gameId);
  } catch (error) {
    console.warn("could not list this game's stored turns for resource verdicts", error);
    return { memory: NO_RESOURCE_MEMORY, unreadTurns: 0 };
  }

  let memory: ResourceMemory = NO_RESOURCE_MEMORY;
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
      memory = withTurn(memory, await client.parseReportFull(record.rawReport), key.turnNumber, index);
    } catch (error) {
      console.warn(`could not read turn ${key.turnNumber}'s resource verdicts`, error);
      unreadTurns += 1;
    }
  }

  return { memory, unreadTurns };
}

const DEFAULT_STATE = {
  gameId: null,
  status: "idle" as const,
  memory: NO_RESOURCE_MEMORY,
  unreadTurns: 0,
  scanRun: 0
};

/** Test helper, like `resetBattleSkillsStore` (battleSkillsStore.ts). */
export function resetResourceMemoryStore(): void {
  useResourceMemoryStore.setState(DEFAULT_STATE);
}
