/**
 * What this faction's own turns proved about where an inner passage comes out, held in memory for
 * the open game.
 *
 * `ah-3u7c.2.1`. Modelled on `resourceMemoryStore.ts` beside it, and for the same reason: **it
 * never writes anything.** `imported_turns.raw_report` and `order_drafts.order_text` already keep
 * every input, so the whole memory is rebuilt by a scan whenever the game - or the ruleset an
 * orders document is read against - changes. No migration, no IndexedDB version bump, no backup
 * field.
 *
 * Not persisted, for the reason `armiesStore.ts` gives about itself: a persisted cache would show
 * one game's answer in another game's workspace after a reload.
 */

import { create } from "zustand";
import type { CoreClient, OpenedGame, ParsedReport, PassageClaim } from "@atlantis/core-client";

import { NO_PASSAGE_MEMORY, withCrossings, type PassageMemory } from "./passageMemory";

export type PassageMemoryStatus = "idle" | "scanning" | "ready";

/** The client calls this memory needs, and no more, so a test can supply five functions. */
type PassageClient = Pick<
  CoreClient,
  "listImportedTurns" | "loadImportedTurn" | "loadOrderDraft" | "parseReportFull" | "passageClaims"
>;

export type PassageMemoryState = {
  /** The game the memory belongs to; a memory for another game is stale and is not read. */
  gameId: string | null;
  status: PassageMemoryStatus;
  memory: PassageMemory;
  /**
   * How many stored turns the last scan could not read. Kept because it costs nothing; shown
   * nowhere, there being no surface for it that the navigator has agreed to.
   */
  unreadTurns: number;
  /**
   * Which scan is the live one. The scan re-runs when the ruleset changes as well as when the game
   * does, so two scans of one game can overlap and the older must not write over the newer.
   */
  scanRun: number;
  /** Reads every stored turn of the game. Never rejects. */
  scan: (client: PassageClient, game: OpenedGame, rulesetJson: string | null) => Promise<void>;
  /**
   * The turn on screen answered against the turn before it, so a report imported this minute
   * counts at once without walking the whole game again.
   */
  learnLatest: (
    client: PassageClient,
    game: OpenedGame,
    after: ParsedReport,
    afterTurn: number,
    rulesetJson: string | null
  ) => Promise<void>;
  clear: () => void;
};

let runs = 0;
const nextScanRun = () => ++runs;

export const usePassageMemoryStore = create<PassageMemoryState>()((set, get) => ({
  gameId: null,
  status: "idle",
  memory: NO_PASSAGE_MEMORY,
  unreadTurns: 0,
  scanRun: 0,

  scan: async (client, game, rulesetJson) => {
    const gameId = game.manifest.metadata.gameId;
    const run = nextScanRun();
    set({
      gameId,
      status: "scanning",
      memory: NO_PASSAGE_MEMORY,
      unreadTurns: 0,
      scanRun: run
    });

    const { memory, unreadTurns } = await scanStoredTurns(client, game, rulesetJson);

    // A game switch, or a second scan started because the ruleset changed, leaves a late result
    // for a state that has moved on.
    if (get().gameId !== gameId || get().scanRun !== run) {
      return;
    }
    // Whatever `learnLatest` wrote while the scan was running is folded on top: it is the newest
    // turn, and a later turn replaces an earlier answer for the same key.
    set((state) => ({
      status: "ready",
      memory: mergedMemory(memory, state.memory),
      unreadTurns
    }));
  },

  learnLatest: async (client, game, after, afterTurn, rulesetJson) => {
    const gameId = game.manifest.metadata.gameId;
    const factionId = after.header.factionId;
    if (!factionId || afterTurn <= 0) {
      return;
    }

    const claims = await claimsOfTurn(client, game, factionId, afterTurn - 1, rulesetJson);
    if (claims.length === 0) {
      return;
    }

    // Only into the store this game already owns. `clear()` leaves `gameId` null, so accepting
    // null here would let a call still in flight when the game closed set it back and write that
    // game's memory into an empty workspace - the very thing the module header says persistence
    // was avoided to prevent.
    set((state) =>
      state.gameId === gameId
        ? { memory: withCrossings(state.memory, claims, after, afterTurn) }
        : state
    );
  },

  clear: () => {
    set(DEFAULT_STATE);
  }
}));

/**
 * Every stored turn of the game, read for what it proved about passages. Never rejects.
 *
 * Serial rather than parallel, for the reason `resourceMemoryStore.ts` gives: the summaries come
 * back turn-ascending, and each turn answers the claims of the turn before it. A turn that will not
 * load or will not parse is counted in `unreadTurns` and the walk carries on; a failure of
 * `listImportedTurns` itself is logged and answered with nothing recovered.
 *
 * Claims are held per faction, because two factions' turns interleave in one list and a claim of
 * one says nothing about the other.
 */
export async function scanStoredTurns(
  client: PassageClient,
  game: OpenedGame,
  rulesetJson: string | null
): Promise<{ memory: PassageMemory; unreadTurns: number }> {
  // An orders document is read against a world's own comment syntax (`ah-g9sf.3`), and `AppShell`
  // scans while the ruleset is still fetching - so without this the whole walk runs against a world
  // whose syntax it may be reading wrongly, and again the moment the ruleset lands.
  if (rulesetJson === null) {
    return { memory: NO_PASSAGE_MEMORY, unreadTurns: 0 };
  }

  const gameId = game.manifest.metadata.gameId;

  let summaries;
  try {
    summaries = await client.listImportedTurns(game.databasePath, gameId);
  } catch (error) {
    console.warn("could not list this game's stored turns for passage crossings", error);
    return { memory: NO_PASSAGE_MEMORY, unreadTurns: 0 };
  }

  let memory: PassageMemory = NO_PASSAGE_MEMORY;
  let unreadTurns = 0;
  const pending = new Map<string, { turn: number; claims: PassageClaim[] }>();

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
        pending.delete(key.factionId);
        continue;
      }

      const after = await client.parseReportFull(record.rawReport);
      const held = pending.get(key.factionId);
      if (held && held.turn === key.turnNumber - 1) {
        memory = withCrossings(memory, held.claims, after, key.turnNumber);
      }

      // The orders half is its own failure: the turn itself was read, so a draft that will not
      // load leaves this turn answering the one before it and simply claiming nothing of its own.
      // Counting it as unread would say the report could not be read, which is not what happened.
      pending.set(key.factionId, {
        turn: key.turnNumber,
        claims: await claimsFor(
          client,
          game,
          key.factionId,
          key.turnNumber,
          record.rawReport,
          rulesetJson
        )
      });
    } catch (error) {
      console.warn(`could not read turn ${key.turnNumber}'s report`, error);
      unreadTurns += 1;
      pending.delete(key.factionId);
    }
  }

  return { memory, unreadTurns };
}

/** One stored turn's claims, or none when it cannot be read. Never rejects. */
async function claimsOfTurn(
  client: PassageClient,
  game: OpenedGame,
  factionId: string,
  turnNumber: number,
  rulesetJson: string | null
): Promise<PassageClaim[]> {
  if (rulesetJson === null) {
    return [];
  }

  const gameId = game.manifest.metadata.gameId;
  try {
    const record = await client.loadImportedTurn(
      game.databasePath,
      gameId,
      factionId,
      turnNumber
    );
    if (record === null) {
      return [];
    }
    return await claimsFor(client, game, factionId, turnNumber, record.rawReport, rulesetJson);
  } catch (error) {
    console.warn(`could not read turn ${turnNumber}'s passage crossings`, error);
    return [];
  }
}

/**
 * One turn's claims, given its report text already in hand. Never rejects.
 *
 * A turn with no saved orders claims nothing, and asks the core nothing.
 */
async function claimsFor(
  client: PassageClient,
  game: OpenedGame,
  factionId: string,
  turnNumber: number,
  rawReport: string,
  rulesetJson: string
): Promise<PassageClaim[]> {
  try {
    const draft = await client.loadOrderDraft(
      game.databasePath,
      game.manifest.metadata.gameId,
      factionId,
      turnNumber
    );
    if (draft === null) {
      return [];
    }
    return await client.passageClaims(rawReport, draft.orderText, rulesetJson);
  } catch (error) {
    console.warn(`could not read turn ${turnNumber}'s ordered passage crossings`, error);
    return [];
  }
}

/**
 * Two memories folded together, the later answer for a key winning.
 *
 * The same rule `withCrossings` applies within one fold, so a scan and a `learnLatest` racing
 * settle the same way whichever finishes first.
 */
function mergedMemory(base: PassageMemory, incoming: PassageMemory): PassageMemory {
  if (incoming.size === 0) {
    return base;
  }
  const merged = new Map(base);
  for (const [key, passage] of incoming) {
    const held = merged.get(key);
    if (!held || held.learnedInTurn <= passage.learnedInTurn) {
      merged.set(key, passage);
    }
  }
  return merged;
}

const DEFAULT_STATE = {
  gameId: null,
  status: "idle" as const,
  memory: NO_PASSAGE_MEMORY,
  unreadTurns: 0,
  scanRun: 0
};

/** Test helper, like `resetResourceMemoryStore` (resourceMemoryStore.ts). */
export function resetPassageMemoryStore(): void {
  usePassageMemoryStore.setState(DEFAULT_STATE);
}
