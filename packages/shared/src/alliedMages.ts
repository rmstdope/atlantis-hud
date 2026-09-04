/**
 * An ally's mages in storage, as the two calls the store makes.
 *
 * The same shape `armies.ts`' `loadArmies`/`saveArmy` have, and it exists for the same reason: the
 * store should not be reaching into `game.manifest.metadata` itself.
 */

import type {
  AlliedMageKey,
  AlliedMageRecord,
  CoreClient,
  OpenedGame
} from "@atlantis/core-client";

/** A game's stored allied mages, in the client's own order (`sortAlliedMages`). */
export async function loadAlliedMages(
  client: CoreClient,
  game: OpenedGame
): Promise<AlliedMageRecord[]> {
  return client.listAlliedMages(game.databasePath, game.manifest.metadata.gameId);
}

/** Stores one sheet's mages and drops the ones the player discarded, in one call. */
export async function saveAlliedMages(
  client: CoreClient,
  game: OpenedGame,
  mages: readonly AlliedMageRecord[],
  removed: readonly AlliedMageKey[]
): Promise<void> {
  await client.saveAlliedMages(game.databasePath, game.manifest.metadata.gameId, mages, removed);
}
