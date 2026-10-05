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

import type {
  CoreClient,
  GameManifest,
  ManifestEdit,
  MapShape,
  MapSizes,
  OpenedGame,
  ParsedReport
} from "@atlantis/core-client";
import { backupAsCopy, backupGameIdentity } from "./gameBackup";
import { parseGameData, type GameDataIndex } from "./gameData";
import { rulesetGaps, type RulesetGaps } from "./rulesetGaps";
import { gameAfterDelete, gameNameOf, newGameId, newGameManifest } from "./gameSession";
import { rulesetById } from "./rulesets";
import { forgetMapView } from "./workspace/mapViewportStorage";

/** The slice of the client these actions need - a fake in the tests is an object literal. */
export type GameClient = Pick<
  CoreClient,
  | "listGames"
  | "openGame"
  | "createGame"
  | "deleteGame"
  | "exportGame"
  | "importGame"
  | "editGameManifest"
  | "resetGame"
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

/**
 * Creates a game the player has described.
 *
 * `map` is what they were asked for at creation, or `undefined` when they cleared the fields -
 * which records nothing, so the ruleset's declared default is assumed and the settings dialog
 * says as much.
 */
export async function createGame(
  client: GameClient,
  name: string,
  rulesetId: string,
  now: string,
  map?: MapShape,
  mapSizes?: MapSizes
): Promise<GameActionOutcome> {
  const opened = await client.createGame(
    newGameManifest(name, rulesetId, now, newGameId(), map, mapSizes)
  );
  return { opened, games: await client.listGames() };
}

export async function importGameBackup(
  client: GameClient,
  backupJson: string,
  now: string
): Promise<GameActionOutcome & { opened: OpenedGame }> {
  const opened = await client.importGame(backupJson, now);
  return { opened, games: await client.listGames() };
}

/** "Keep both": imports `backupJson` as a new game under a fresh id, named "<name> (imported)". */
export async function importGameBackupAsCopy(
  client: GameClient,
  backupJson: string,
  now: string
): Promise<GameActionOutcome & { opened: OpenedGame }> {
  return importGameBackup(client, backupAsCopy(backupJson, newGameId()), now);
}

/**
 * "Replace": deletes the game `backupJson` names, then imports the backup in its place, and
 * resolves `{ opened: the imported game, games }`.
 *
 * Order, and why: (1) `hooks.discardOpenDraft()` when the named game is `openGameId` - its
 * database is about to go, so nothing may be flushed into it (the rule `deleteGame` above states);
 * otherwise `await hooks.flush()`, as any other import does before the workspace lets go of the
 * open game. (2) `snapshot = await client.exportGame(gameId, now)` - the game as it stands. (3)
 * `client.deleteGame(gameId)`. (4) `client.importGame(backupJson, now)`. If (4) rejects, the
 * snapshot is imported back (`client.importGame(snapshot, now)`) before the error is rethrown, so a
 * backup the core refuses (a newer format version, say) costs the player nothing. If putting the
 * snapshot back also fails, the original error is still the one thrown; the second failure is
 * logged.
 *
 * When `backupGameIdentity` returns `null` there is nothing to delete: falls through to a plain
 * `client.importGame` and lets the core report the file.
 */
export async function replaceGameWithBackup(
  client: GameClient,
  backupJson: string,
  openGameId: string | null,
  now: string,
  hooks: { flush: () => Promise<void>; discardOpenDraft: () => void }
): Promise<GameActionOutcome & { opened: OpenedGame }> {
  const identity = backupGameIdentity(backupJson);
  if (!identity) {
    return importGameBackup(client, backupJson, now);
  }

  if (identity.gameId === openGameId) {
    hooks.discardOpenDraft();
  } else {
    await hooks.flush();
  }

  const snapshot = await client.exportGame(identity.gameId, now);
  await client.deleteGame(identity.gameId);
  try {
    return await importGameBackup(client, backupJson, now);
  } catch (error: unknown) {
    try {
      await client.importGame(snapshot, now);
    } catch (restoreError: unknown) {
      console.error(`could not restore ${identity.gameId} after a failed replace:`, restoreError);
    }
    throw error;
  }
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

/** What emptying a game leaves behind for the shell to apply. */
export type ResetGameOutcome = {
  /** The emptied game, ready to open. */
  opened: OpenedGame;
  games: GameManifest[];
  /** Whether the game that was emptied is the one on screen. */
  wasOpenGame: boolean;
};

/**
 * Empties `gameId` and keeps it: same id, name and ruleset, nothing else (ah-58n).
 *
 * The open draft is discarded first when the game being emptied is the open one, for exactly
 * `deleteGame`'s reason: the database its orders would be written to is about to be replaced, and a
 * flush on the way out would write into a game that no longer holds it.
 *
 * The saved map view goes with the rest. It lives in localStorage rather than in the game, so the
 * core cannot reach it and this is the only place it can be cleared.
 */
export async function resetGame(
  client: GameClient,
  gameId: string,
  openGameId: string | null,
  now: string,
  discardOpenDraft: () => void
): Promise<ResetGameOutcome> {
  const wasOpenGame = openGameId === gameId;
  if (wasOpenGame) {
    discardOpenDraft();
  }
  const opened = await client.resetGame(gameId, now);
  forgetMapView(gameId);
  return { opened, games: await client.listGames(), wasOpenGame };
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
  const edit: ManifestEdit = { kind: "ruleset", value: rulesetId };
  const manifest = await client.editGameManifest(game.manifest.metadata.gameId, edit);
  return { manifest, games: await client.listGames() };
}

/**
 * Every ruleset in `ids`, parsed, by id (each read once). Rejects naming the first that cannot be
 * read, since a check against a ruleset half-known would say less than it seems to.
 */
export async function readShippedRulesets(
  readRuleset: (rulesetId: string) => Promise<string>,
  ids: readonly string[]
): Promise<Map<string, GameDataIndex>> {
  const indexes = new Map<string, GameDataIndex>();
  for (const rulesetId of ids) {
    if (indexes.has(rulesetId)) {
      continue;
    }
    const index = parseGameData(await readRuleset(rulesetId));
    if (index === null) {
      throw new Error(`the ${rulesetId} ruleset could not be read`);
    }
    indexes.set(rulesetId, index);
  }
  return indexes;
}

/**
 * What every imported turn of `game` names that `targetId`'s ruleset does not define (ah-gicw),
 * checked before the ruleset is changed.
 *
 * `readRuleset` fetches a ruleset's text by id; `shippedIds` is every ruleset this build ships,
 * which `rulesetGaps` uses to tell a race from an item and to give a tag its singular name.
 *
 * Serial, as `scanStoredTurns` walks them. Unlike that walk this one throws on a turn it cannot read:
 * a check that skipped a turn would say "nothing missing" about names it never saw, and the change
 * would go through unwarned. Names need no classification, so `parseReportFull` is enough.
 */
export async function checkRulesetChange(
  client: Pick<CoreClient, "listImportedTurns" | "loadImportedTurn" | "parseReportFull">,
  game: OpenedGame,
  targetId: string,
  readRuleset: (rulesetId: string) => Promise<string>,
  shippedIds: readonly string[]
): Promise<RulesetGaps> {
  const indexes = await readShippedRulesets(readRuleset, [targetId, ...shippedIds]);
  const target = indexes.get(targetId) as GameDataIndex;
  const known = [target, ...[...indexes].filter(([id]) => id !== targetId).map(([, index]) => index)];

  const gameId = game.manifest.metadata.gameId;
  const summaries = await client.listImportedTurns(game.databasePath, gameId);
  const turns: { turnNumber: number; report: ParsedReport }[] = [];
  for (const { key } of summaries) {
    const record = await client.loadImportedTurn(game.databasePath, gameId, key.factionId, key.turnNumber);
    if (record === null) {
      throw new Error(`turn ${key.turnNumber} could not be read`);
    }
    turns.push({ turnNumber: key.turnNumber, report: await client.parseReportFull(record.rawReport) });
  }
  return rulesetGaps(turns, target, known, targetId);
}

/**
 * Renames `game` to `gameName` (trimmed by `gameNameOf`, which throws "a game needs a name" for
 * an empty one - the same rule creation applies). Resolves the new manifest and the refreshed
 * games list.
 */
export async function renameGame(
  client: GameClient,
  game: OpenedGame,
  gameName: string
): Promise<{ manifest: OpenedGame["manifest"]; games: GameManifest[] }> {
  const edit: ManifestEdit = { kind: "name", value: gameNameOf(gameName) };
  const manifest = await client.editGameManifest(game.manifest.metadata.gameId, edit);
  return { manifest, games: await client.listGames() };
}
