/**
 * The async doing behind the picker's game-management actions (ah-k6i).
 *
 * Deliberately a plain module beside `gameSession.ts`, in the same spirit: the decisions here -
 * discarding the open draft before a delete destroys its database, a ruleset guard that refuses
 * silently to `null` versus throws, a cancelled backup leaving the picker where it was - are
 * testable without rendering `AppShell`. Everything that IS shell state (`enterGame`, the
 * workspace store, `flush`, the picker's own open/closed flag) stays there; each function here
 * hands back what it changed and lets the caller apply it.
 */

import type { CoreClient, GameManifest, OpenedGame } from "@atlantis/core-client";
import { gameAfterDelete, newGameId, newGameManifest } from "./gameSession";
import { rulesetById } from "./rulesets";

/** The slice of the client these actions need - a fake in the tests is an object literal. */
export type GameClient = Pick<
  CoreClient,
  "listGames" | "openGame" | "createGame" | "deleteGame" | "exportGame" | "importGame" | "setGameRuleset"
>;

/** What a game action leaves behind for the shell to apply. */
export type GameActionOutcome = {
  /** The game now open. */
  opened: OpenedGame;
  /** The list of games after the action, for the picker. */
  games: GameManifest[];
};

export async function openGame(client: GameClient, gameId: string, now: string): Promise<GameActionOutcome> {
  const opened = await client.openGame(gameId, now);
  return { opened, games: await client.listGames() };
}

export async function createGame(
  client: GameClient,
  name: string,
  rulesetId: string,
  now: string
): Promise<GameActionOutcome> {
  const opened = await client.createGame(newGameManifest(name, rulesetId, now, newGameId()));
  return { opened, games: await client.listGames() };
}

export async function importGameBackup(
  client: GameClient,
  backupJson: string,
  now: string
): Promise<GameActionOutcome> {
  const opened = await client.importGame(backupJson, now);
  return { opened, games: await client.listGames() };
}

/**
 * Deletes `gameId` and lands the player somewhere.
 *
 * `discardOpenDraft` is called - before the delete - only when the deleted game is `openGameId`:
 * its database is about to go, so nothing may be flushed into it. `closedOpenGame` is `true` when
 * the game on screen was the one deleted, in which case `opened` names where the player lands next
 * (`null` there means "close the workspace"). Deleting some other game leaves `opened: null,
 * closedOpenGame: false` and touches nothing else.
 */
export type DeleteGameOutcome = {
  /** Where the player lands, when the deleted game was the open one and another remains; `null`
   * when it was the open one and there is nowhere left, or when some other game was deleted. */
  opened: OpenedGame | null;
  games: GameManifest[];
  /** Whether the game on screen was the one deleted - `opened` only matters when this is `true`. */
  closedOpenGame: boolean;
};

export async function deleteGame(
  client: GameClient,
  gameId: string,
  openGameId: string | null,
  now: string,
  discardOpenDraft: () => void
): Promise<DeleteGameOutcome> {
  const deletingOpenGame = openGameId === gameId;
  if (deletingOpenGame) {
    discardOpenDraft();
  }
  await client.deleteGame(gameId);
  const games = await client.listGames();

  if (!deletingOpenGame) {
    return { opened: null, games, closedOpenGame: false };
  }

  const next = gameAfterDelete(games, gameId);
  const opened = next ? await client.openGame(next.metadata.gameId, now) : null;
  return { opened, games, closedOpenGame: true };
}

/**
 * Moves `game` to `rulesetId`. `null` when there is nothing to do (same ruleset already set).
 * Throws `Error("unknown ruleset: <id>")` for a ruleset this build does not ship - the caller's
 * reporter turns that into the same `gameError` text as today.
 */
export async function changeRuleset(
  client: GameClient,
  game: OpenedGame,
  rulesetId: string
): Promise<{ manifest: OpenedGame["manifest"]; games: GameManifest[] } | null> {
  if (game.manifest.metadata.rulesetId === rulesetId) {
    return null;
  }
  if (!rulesetById(rulesetId)) {
    throw new Error(`unknown ruleset: ${rulesetId}`);
  }
  const manifest = await client.setGameRuleset(game.manifest.metadata.gameId, rulesetId);
  return { manifest, games: await client.listGames() };
}
