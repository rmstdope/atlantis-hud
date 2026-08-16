/**
 * The shell's *peek* at a backup file (ah-c0m) - enough to know which game it names, so the picker
 * can ask before the core is involved, and a rewrite that makes a copy of one under a fresh id. The
 * core remains the only thing that validates and imports a backup; nothing here checks `version` or
 * anything else the core is the authority on.
 */

/** The game a backup file says it is. */
export type BackupIdentity = { gameId: string; gameName: string };

/** How an import resolves a backup whose game may already be here. */
export type BackupImportMode = "new" | "replace" | "copy";

/** Appended to the name of a game imported with "Keep both". */
export const IMPORTED_COPY_SUFFIX = " (imported)";

const BACKUP_FORMAT = "atlantis-hud-game-backup";

/**
 * Reads the game id and name out of a backup's manifest, or `null` when the text is not JSON, or
 * has no `manifest.metadata.gameId` / `gameName` strings, or does not declare
 * `format: "atlantis-hud-game-backup"`. `null` is not an error here: the caller imports it anyway
 * and lets the core say what is wrong with it, in the words it already uses.
 */
export function backupGameIdentity(backupJson: string): BackupIdentity | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(backupJson);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  if (record.format !== BACKUP_FORMAT) {
    return null;
  }
  const manifest = record.manifest;
  if (typeof manifest !== "object" || manifest === null) {
    return null;
  }
  const metadata = (manifest as Record<string, unknown>).metadata;
  if (typeof metadata !== "object" || metadata === null) {
    return null;
  }
  const { gameId, gameName } = metadata as Record<string, unknown>;
  if (typeof gameId !== "string" || typeof gameName !== "string") {
    return null;
  }
  return { gameId, gameName };
}

/**
 * The same backup as a new game: `manifest.metadata.gameId` becomes `newGameId` and
 * `manifest.metadata.gameName` gets `IMPORTED_COPY_SUFFIX`. Everything else is passed through
 * untouched (re-serialised with `JSON.stringify(parsed, null, 2)`, which the core re-parses).
 * Throws `Error("backup file is not valid JSON")` if it cannot be parsed - callers only reach this
 * after `backupGameIdentity` returned non-null, so that is a programming error, not a player
 * message.
 */
export function backupAsCopy(backupJson: string, newGameId: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(backupJson);
  } catch {
    throw new Error("backup file is not valid JSON");
  }
  const record = parsed as Record<string, unknown>;
  const manifest = record.manifest as Record<string, unknown>;
  const metadata = manifest.metadata as Record<string, unknown>;
  const gameName = typeof metadata.gameName === "string" ? metadata.gameName : "";
  const rewritten = {
    ...record,
    manifest: {
      ...manifest,
      metadata: {
        ...metadata,
        gameId: newGameId,
        gameName: `${gameName}${IMPORTED_COPY_SUFFIX}`
      }
    }
  };
  return JSON.stringify(rewritten, null, 2);
}

// Every run of characters a file system may refuse: backslash, slash, colon, asterisk, question
// mark, double quote, angle brackets, pipe, and control characters U+0000-U+001F.
const UNSAFE_FILE_NAME_CHARACTERS = /[\\/:*?"<>|\x00-\x1f]+/gu;

/**
 * The file a backup is saved as: `<game name>.atlantis-hud-game.json`, with every run of
 * characters a file system may refuse replaced by one `-`, and surrounding whitespace trimmed; an
 * empty result falls back to `game`.
 */
export function backupFileName(gameName: string): string {
  const safeName = gameName.trim().replace(UNSAFE_FILE_NAME_CHARACTERS, "-") || "game";
  return `${safeName}.atlantis-hud-game.json`;
}
