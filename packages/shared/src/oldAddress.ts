/**
 * The old web address is closing down (ah-gup7g): the rules behind the dialog that says so.
 *
 * Kept free of React so every rule here is tested without a DOM (see `testing/README.md`); the
 * dialog in `workspace/OldAddressNotice.tsx` only draws what these return, and the web shell's
 * `App.tsx` is the one place that asks `isOldAddress`, so the desktop bundle never opens it.
 */

import { backupFileName } from "./gameBackup";

export const OLD_ADDRESS_HOST = "atlantis-hud.kurelid.se";
export const NEW_ADDRESS_LABEL = "atlantis-hud.rmstdope.eu";
export const NEW_ADDRESS_URL = `https://${NEW_ADDRESS_LABEL}`;
/** The last version deployed to the old address, as the team agreed it in the design session. */
export const LAST_OLD_ADDRESS_VERSION = "0.35.0";

/** True only on the old address itself: never the new one, local development or the desktop app. */
export function isOldAddress(hostname: string): boolean {
  return hostname.toLowerCase() === OLD_ADDRESS_HOST;
}

export function savingLabel(done: number, total: number): string {
  return `Saving… ${done} of ${total}`;
}

export function savedLine(fileNames: readonly string[]): string {
  const count = fileNames.length;
  return `Saved ${count} ${count === 1 ? "game" : "games"}: ${fileNames.join(", ")}`;
}

export function failedLine(gameName: string): string {
  return `Couldn’t save ${gameName}. Press the button to try again.`;
}

export type GameToSave = { gameId: string; gameName: string };

/** The files written, by name, and the games that were not, by name. */
export type SaveAllOutcome = { saved: string[]; failed: string[] };

/**
 * Saves one backup per game, one at a time and in the order given, so the browser's downloads
 * arrive in the order the dialog counts them.
 *
 * `saveOne` resolves with what the shell's saver resolves - `null` when a save was cancelled -
 * and a rejection or a `null` both count as that game failing; neither stops the rest. Every call
 * saves every game again, which is harmless: pressing the button twice only downloads twice.
 */
export async function saveAllGames<G extends GameToSave>(
  games: readonly G[],
  saveOne: (game: G) => Promise<string | null>,
  onProgress: (done: number, total: number) => void
): Promise<SaveAllOutcome> {
  const outcome: SaveAllOutcome = { saved: [], failed: [] };
  for (const [index, game] of games.entries()) {
    onProgress(index + 1, games.length);
    let written: string | null;
    try {
      written = await saveOne(game);
    } catch {
      written = null;
    }
    if (written === null) {
      outcome.failed.push(game.gameName);
    } else {
      outcome.saved.push(backupFileName(game.gameName));
    }
  }
  return outcome;
}

/**
 * What a failed line names when the games themselves could not be read: "Couldn’t save your
 * games. Press the button to try again." - the agreed failure sentence, about all of them at once.
 */
export const UNREAD_GAMES = "your games";

/**
 * `saveAllGames` for a dialog that opened without being able to read the games list (another tab
 * holding it, typically): the list is read again at the press, so a player who has games is never
 * told there is nothing to move, and one that still cannot be read is a failure to try again.
 */
export async function saveAllGamesListedBy<G extends GameToSave>(
  listGames: () => Promise<readonly G[]>,
  saveOne: (game: G) => Promise<string | null>,
  onProgress: (done: number, total: number) => void
): Promise<SaveAllOutcome> {
  let games: readonly G[];
  try {
    games = await listGames();
  } catch {
    return { saved: [], failed: [UNREAD_GAMES] };
  }
  return saveAllGames(games, saveOne, onProgress);
}
