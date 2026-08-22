/**
 * Which game is open, and how one comes to be.
 *
 * Deliberately a plain module rather than logic inside a component, in the same spirit as
 * `gameMemory`: the parts that can go wrong - a name that is only spaces, a ruleset this build does
 * not ship, a deleted game that was the one on screen - are testable without rendering anything.
 */

import type { CoreClient, GameManifest, OpenedGame } from "@atlantis/core-client";
import { rulesetById } from "./rulesets";
import type { MapShape } from "@atlantis/core-client";

/** The most recently opened game, or `null` when the player has none. */
export function newestGame(games: GameManifest[]): GameManifest | null {
  return games.reduce<GameManifest | null>(
    (newest, game) =>
      newest === null || game.lastOpenedAt > newest.lastOpenedAt ? game : newest,
    null
  );
}

/**
 * Which game to open once `deletedGameId` is gone.
 *
 * Deleting the game on screen has to land the player somewhere, and the same rule that picks a
 * game at startup picks the replacement. `null` means there is nothing left, and the workspace
 * gives way to the create screen.
 */
export function gameAfterDelete(
  games: GameManifest[],
  deletedGameId: string
): GameManifest | null {
  return newestGame(games.filter((game) => game.metadata.gameId !== deletedGameId));
}

/**
 * The name a game may be given: trimmed, and never empty. The one rule for a name, at creation and
 * on a rename alike — two copies would drift and one path would accept what the other refuses.
 */
export function gameNameOf(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === "") {
    throw new Error("a game needs a name");
  }
  return trimmed;
}

/**
 * The manifest for a game the player has just described.
 *
 * Both refusals are deliberate. An empty name would leave a game nothing can refer to in the
 * picker, and a ruleset this build cannot serve would leave the planner with no movement numbers -
 * which the ruleset contract says must fail loudly rather than fall back to a value that is
 * confidently wrong.
 *
 * `map` is spread in only when given, so a game created without one has no such key at all. That
 * absence is the record that nothing was stated, which is what lets Settings show the ruleset's
 * default as *assumed* rather than as the player's word - a distinction a default written in here
 * would destroy, and destroy irrecoverably.
 */
export function newGameManifest(
  gameName: string,
  rulesetId: string,
  now: string,
  gameId: string,
  map?: MapShape
): GameManifest {
  const trimmed = gameNameOf(gameName);
  if (rulesetById(rulesetId) === null) {
    throw new Error(`unknown ruleset: ${rulesetId}`);
  }

  return {
    manifestVersion: 1,
    metadata: { gameId, gameName: trimmed, rulesetId, ...(map === undefined ? {} : { map }) },
    reportSources: [],
    createdAt: now,
    lastOpenedAt: now
  };
}

/**
 * Where a game's ruleset is served from.
 *
 * Throws rather than returning a default, for the reason above: a missing ruleset is a real
 * problem and silence about it produces routes that are wrong without saying so.
 */
export function rulesetUrlFor(rulesetId: string): string {
  const ruleset = rulesetById(rulesetId);
  if (ruleset === null) {
    throw new Error(`this build does not have the ruleset ${rulesetId}`);
  }
  return ruleset.url;
}

/** A fresh identity for a game. Ids are never shown; they only have to be unique. */
export function newGameId(): string {
  return crypto.randomUUID();
}

/**
 * Opens the game the player was last in, if there is one.
 *
 * `null` means no games exist, which is the ordinary first run rather than a failure, and the
 * shell answers it with the create screen.
 */
export async function openNewestGame(
  client: CoreClient,
  now: string
): Promise<OpenedGame | null> {
  const newest = newestGame(await client.listGames());
  if (newest === null) {
    return null;
  }
  return client.openGame(newest.metadata.gameId, now);
}
